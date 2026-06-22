from __future__ import annotations
import json
import logging
import re
from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from models import OperationLogStatus, OperationLogType, UtilisationReport, UtilisationStatus
from services.journal_service import log_operation
from schemas import UtilisationReportCreate
from services.suz_integration_service import (
    _normalize_suz_client_token,
    _suz_dispatch_httpx,
)
from services.token_service import get_active_token
from settings import get_settings
logger = logging.getLogger(__name__)
def normalize_marking_code(code: str) -> str:
    gs = "\x1d"
    if gs in code:
        return code
    pattern = re.compile(
        r"^(01\d{14})"
        r"(21.+?)"
        r"(91[A-F0-9]{4})"
        r"(92.+)$",
        re.IGNORECASE,
    )
    m = pattern.match(code)
    if m:
        part1 = m.group(1) + m.group(2)
        part2 = m.group(3)
        part3 = m.group(4)
        return f"{part1}{gs}{part2}{gs}{part3}"
    idx_91 = code.find("91FFD0")
    if idx_91 == -1:
        for i in range(30, len(code) - 6):
            if code[i : i + 2] == "91" and code[i + 6 : i + 8] == "92":
                idx_91 = i
                break
    if idx_91 > 0:
        idx_92 = code.find("92", idx_91 + 4)
        if idx_92 > 0:
            return f"{code[:idx_91]}{gs}{code[idx_91:idx_92]}{gs}{code[idx_92:]}"
    return code
def normalize_codes_for_utilisation(codes: list[str]) -> list[str]:
    return [normalize_marking_code(code) for code in codes]
async def create_utilisation_draft(
    data: UtilisationReportCreate,
    db: AsyncSession,
    org_id: UUID | None = None,
) -> UtilisationReport:
    report = UtilisationReport(
        product_group=data.product_group,
        marking_codes=data.marking_codes,
        status=UtilisationStatus.DRAFT,
        org_id=org_id,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return report
def build_utilisation_body(
    marking_codes: list[str],
    product_group: str = "perfumery",
) -> dict:
    normalized_codes = normalize_codes_for_utilisation(marking_codes)
    return {
        "productGroup": product_group,
        "sntins": normalized_codes,
    }
def serialize_utilisation_body(body_dict: dict) -> str:
    return json.dumps(body_dict, ensure_ascii=False, separators=(",", ":"))
async def get_utilisation_body_for_signing(
    report_id: UUID,
    db: AsyncSession,
) -> tuple[UtilisationReport, str]:
    report = await db.get(UtilisationReport, report_id)
    if report is None:
        raise LookupError("Отчёт не найден")
    body_dict = build_utilisation_body(report.marking_codes, report.product_group)
    body_str = serialize_utilisation_body(body_dict)
    return report, body_str
async def send_utilisation_report(
    report_id: UUID,
    signature: str,
    db: AsyncSession,
) -> UtilisationReport:
    report = await db.get(UtilisationReport, report_id)
    if report is None:
        raise LookupError("Отчёт не найден")
    if report.status not in (UtilisationStatus.DRAFT, UtilisationStatus.ERROR):
        raise ValueError(f"Нельзя отправить отчёт со статусом {report.status}")
    settings = get_settings()
    token_raw = await get_active_token(db)
    token = _normalize_suz_client_token(token_raw or "")
    oms_id = settings.suz_oms_id or ""
    base_url = (settings.suz_api_base_url or "").rstrip("/")
    if not token:
        raise ValueError("Не задан clientToken СУЗ")
    if not oms_id:
        raise ValueError("Не задан OMS ID")
    body_dict = build_utilisation_body(report.marking_codes, report.product_group)
    body_str = serialize_utilisation_body(body_dict)
    url = f"{base_url}/api/v3/utilisation?omsId={oms_id}"
    headers = {
        "clientToken": token,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Signature": signature.replace("\r", "").replace("\n", "").strip(),
    }
    report.signature_value = headers["X-Signature"]
    report.status = UtilisationStatus.PENDING
    response, err = await _suz_dispatch_httpx(
        method="POST",
        url=url,
        headers=headers,
        params=None,
        content=body_str.encode("utf-8"),
    )
    if response is None:
        report.status = UtilisationStatus.ERROR
        report.error_message = str(err)
        await db.commit()
        await log_operation(
            db,
            operation_type=OperationLogType.UTILISATION_SENT,
            status=OperationLogStatus.ERROR,
            description="Ошибка ввода в оборот",
            related_id=str(report.id),
            related_type="utilisation_report",
            codes_count=len(report.marking_codes),
            error_message=str(err)[:500],
        )
        raise RuntimeError(f"Ошибка отправки отчёта: {err}")
    if response.status_code in (200, 201, 202):
        try:
            resp_data = response.json()
            report.report_id = str(
                resp_data.get("reportId")
                or resp_data.get("id")
                or resp_data.get("omsId")
                or ""
            ) or None
        except Exception:
            report.report_id = None
        report.status = UtilisationStatus.ACCEPTED
        report.sent_at = datetime.now(timezone.utc)
        report.error_message = None
    else:
        report.status = UtilisationStatus.ERROR
        report.error_message = response.text[:500]
        await db.commit()
        await log_operation(
            db,
            operation_type=OperationLogType.UTILISATION_SENT,
            status=OperationLogStatus.ERROR,
            description="Ошибка ввода в оборот",
            related_id=str(report.id),
            related_type="utilisation_report",
            codes_count=len(report.marking_codes),
            error_message=response.text[:500],
        )
        raise RuntimeError(
            f"СУЗ отклонил отчёт ({response.status_code}): {response.text[:200]}"
        )
    await db.commit()
    await db.refresh(report)
    await log_operation(
        db,
        operation_type=OperationLogType.UTILISATION_SENT,
        status=OperationLogStatus.SUCCESS,
        description=f"Ввод в оборот: {len(report.marking_codes)} кодов",
        related_id=str(report.id),
        related_type="utilisation_report",
        codes_count=len(report.marking_codes),
        details={"report_id": report.report_id},
    )
    return report
async def list_utilisation_reports(
    db: AsyncSession,
    org_id: UUID | None = None,
) -> list[UtilisationReport]:
    q = select(UtilisationReport)
    if org_id:
        q = q.where(UtilisationReport.org_id == org_id)
    result = await db.scalars(q.order_by(UtilisationReport.created_at.desc()))
    return list(result.all())
