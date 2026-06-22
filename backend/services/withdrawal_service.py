from __future__ import annotations

import base64

import json

import logging

import re

from datetime import datetime, timezone

from uuid import UUID

from sqlalchemy import select

from sqlalchemy.ext.asyncio import AsyncSession

from models import OperationLogStatus, OperationLogType, WithdrawalReport, WithdrawalStatus

from services.journal_service import log_operation

from schemas import WithdrawalReportCreate

from services.suz_integration_service import _suz_dispatch_httpx

from services.token_service import get_true_api_token

from services.utilisation_service import normalize_marking_code

from settings import get_settings

logger = logging.getLogger(__name__)



_UUID_PATTERN = re.compile(

    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",

    re.IGNORECASE,

)





def _parse_true_api_document_id(response_text: str) -> str | None:

    try:

        body = response_text.strip().strip('"')

        if _UUID_PATTERN.match(body):

            return body

        resp_data = json.loads(response_text)

        return str(

            resp_data.get("id")

            or resp_data.get("documentId")

            or resp_data.get("document_id")

            or ""

        ) or None

    except Exception:

        raw = response_text.strip().strip('"')

        return raw if len(raw) == 36 else None





async def create_withdrawal_draft(

    data: WithdrawalReportCreate,

    db: AsyncSession,

    org_id: UUID | None = None,

) -> WithdrawalReport:

    report = WithdrawalReport(

        withdrawal_type=data.withdrawal_type,

        product_group=data.product_group,

        marking_codes=data.marking_codes,

        status=WithdrawalStatus.DRAFT,

        org_id=org_id,

    )

    db.add(report)

    await db.commit()

    await db.refresh(report)

    return report





def build_withdrawal_document(

    marking_codes: list[str],

    withdrawal_type: str = "SOLD",

    primary_document_type: str = "OTHER",

    primary_document_number: str | None = None,

    primary_document_date: str | None = None,

    price: float | None = None,

    action_date: str | None = None,

) -> dict:

    """

    Структура документа LK_RECEIPT для True API.



    Поля согласно официальной документации True API:

    - action_date: дата операции ISO 8601

    - primary_document_type: тип первичного документа (OTHER, INVOICE, etc.)

    - primary_document_number: номер документа

    - primary_document_date: дата документа yyyy-MM-dd

    - withdrawal_type: причина вывода (SOLD, DISTANCE_SOLD, DAMAGE_LOSS, etc.)

    - cises: список кодов маркировки

    """

    now = datetime.now(timezone.utc)

    normalized_codes = [normalize_marking_code(c) for c in marking_codes]

    doc = {

        "action_date": action_date or now.strftime("%Y-%m-%dT%H:%M:%S"),

        "primary_document_type": primary_document_type,

        "primary_document_number": primary_document_number or now.strftime("%Y%m%d%H%M%S"),

        "primary_document_date": primary_document_date or now.strftime("%Y-%m-%d"),

        "withdrawal_type": withdrawal_type,

        "cises": normalized_codes,

    }

    return doc





async def get_withdrawal_body_for_signing(

    report_id: UUID,

    db: AsyncSession,

) -> tuple[WithdrawalReport, str, str]:

    report = await db.get(WithdrawalReport, report_id)

    if report is None:

        raise LookupError("Отчёт не найден")



    action_date = report.action_date or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    if not report.action_date:

        report.action_date = action_date

        await db.commit()



    doc = build_withdrawal_document(

        marking_codes=report.marking_codes,

        withdrawal_type=report.withdrawal_type,

        primary_document_type="OTHER",

        primary_document_number=report.primary_document_number,

        primary_document_date=report.primary_document_date,

        price=report.price,

        action_date=action_date,

    )

    doc_json = json.dumps(doc, ensure_ascii=True, separators=(",", ":"))

    doc_b64 = base64.b64encode(doc_json.encode("utf-8")).decode("utf-8")

    return report, doc_json, doc_b64





async def send_withdrawal_report(

    report_id: UUID,

    signature: str,

    db: AsyncSession,

) -> WithdrawalReport:

    report = await db.get(WithdrawalReport, report_id)

    if report is None:

        raise LookupError("Отчёт не найден")

    if report.status not in (WithdrawalStatus.DRAFT, WithdrawalStatus.ERROR):

        raise ValueError(f"Нельзя отправить документ со статусом {report.status}")

    settings = get_settings()

    token = await get_true_api_token(db)

    base_url = (settings.true_api_base_url or "").rstrip("/")

    if not token:

        raise ValueError("Не настроен JWT токен True API. Обновите токен в настройках.")



    action_date = report.action_date or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    if not report.action_date:

        report.action_date = action_date



    doc = build_withdrawal_document(

        marking_codes=report.marking_codes,

        withdrawal_type=report.withdrawal_type,

        primary_document_type="OTHER",

        primary_document_number=report.primary_document_number,

        primary_document_date=report.primary_document_date,

        price=report.price,

        action_date=action_date,

    )

    doc_json = json.dumps(doc, ensure_ascii=True, separators=(",", ":"))

    doc_b64 = base64.b64encode(doc_json.encode("utf-8")).decode("utf-8")

    request_body = {

        "document_format": "MANUAL",

        "type": "LK_RECEIPT",

        "product_document": doc_b64,

        "signature": signature,

    }

    url = f"{base_url}/api/v3/true-api/lk/documents/create"

    params = {"pg": report.product_group}

    headers = {

        "Authorization": f"Bearer {token}",

        "Content-Type": "application/json",

        "Accept": "application/json",

    }

    body_str = json.dumps(request_body, ensure_ascii=False)

    logger.info(

        "Withdrawal request: url=%s, pg=%s, codes=%d",

        url,

        report.product_group,

        len(report.marking_codes),

    )

    report.signature_value = signature.replace("\r", "").replace("\n", "").strip()

    report.status = WithdrawalStatus.PENDING

    response, err = await _suz_dispatch_httpx(

        method="POST",

        url=url,

        headers=headers,

        params=params,

        content=body_str.encode("utf-8"),

    )

    if response is None:

        report.status = WithdrawalStatus.ERROR

        report.error_message = str(err)

        await db.commit()

        await log_operation(

            db,

            operation_type=OperationLogType.WITHDRAWAL_SENT,

            status=OperationLogStatus.ERROR,

            description="Ошибка вывода из оборота",

            related_id=str(report.id),

            related_type="withdrawal_report",

            codes_count=len(report.marking_codes),

            error_message=str(err)[:500],

        )

        raise RuntimeError(f"Ошибка отправки: {err}")

    logger.info(

        "Withdrawal response: status=%d, body=%s",

        response.status_code,

        response.text[:300],

    )

    if response.status_code in (200, 201, 202):

        report.document_id = _parse_true_api_document_id(response.text)

        report.status = WithdrawalStatus.ACCEPTED

        report.sent_at = datetime.now(timezone.utc)

        report.error_message = None

    else:

        report.status = WithdrawalStatus.ERROR

        report.error_message = response.text[:500]

        await db.commit()

        await log_operation(

            db,

            operation_type=OperationLogType.WITHDRAWAL_SENT,

            status=OperationLogStatus.ERROR,

            description="Ошибка вывода из оборота",

            related_id=str(report.id),

            related_type="withdrawal_report",

            codes_count=len(report.marking_codes),

            error_message=response.text[:500],

        )

        raise RuntimeError(

            f"True API отклонил документ ({response.status_code}): {response.text[:300]}"

        )

    await db.commit()

    await db.refresh(report)

    await log_operation(

        db,

        operation_type=OperationLogType.WITHDRAWAL_SENT,

        status=OperationLogStatus.SUCCESS,

        description=(

            f"Вывод из оборота: {len(report.marking_codes)} кодов, "

            f"причина: {report.withdrawal_type}"

        ),

        related_id=str(report.id),

        related_type="withdrawal_report",

        codes_count=len(report.marking_codes),

        details={

            "withdrawal_type": report.withdrawal_type,

            "document_id": report.document_id,

        },

    )

    return report





async def list_withdrawal_reports(

    db: AsyncSession,

    org_id: UUID | None = None,

) -> list[WithdrawalReport]:

    q = select(WithdrawalReport)

    if org_id:

        q = q.where(WithdrawalReport.org_id == org_id)

    result = await db.scalars(q.order_by(WithdrawalReport.created_at.desc()))

    return list(result.all())

