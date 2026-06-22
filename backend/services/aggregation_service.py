"""Сервис агрегации КИТУ."""

from __future__ import annotations

import base64

import json

import logging

import random

import time

from datetime import datetime, timezone

from uuid import UUID

from sqlalchemy import select

from sqlalchemy.ext.asyncio import AsyncSession

from models import AggregationDocument, AggregationStatus, Device, OperationLogStatus, OperationLogType
from services.journal_service import log_operation

from schemas import AggregationDocumentCreate

from services.suz_integration_service import (

    _normalize_suz_client_token,

    _suz_dispatch_httpx,

)

from services.token_service import get_active_token, get_true_api_token

from settings import get_settings



logger = logging.getLogger(__name__)





def _gs1_check_digit(digits: str) -> int:
    """
    Вычислить контрольную цифру GS1 для строки цифр.
    Алгоритм: чётные позиции (справа) × 3, нечётные × 1,
    сумма mod 10, контрольная = (10 - остаток) mod 10.
    """
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch)
        if i % 2 == 0:
            total += n * 3
        else:
            total += n * 1
    return (10 - (total % 10)) % 10


def generate_kitu_code(gcp: str = "460000000") -> str:
    """
    Генерировать SSCC код (18 цифр) для КИТУ.

    Структура SSCC:
    - 1 цифра: расширение (0)
    - 9 цифр: GCP (глобальный префикс компании)
    - 7 цифр: серийный номер
    - 1 цифра: контрольная (алгоритм GS1)

    Итого: 18 цифр
    """
    extension = "0"
    gcp_9 = (gcp + "000000000")[:9]
    timestamp = str(int(time.time()))[-4:]
    random_part = str(random.randint(0, 999)).zfill(3)
    serial = (timestamp + random_part)[:7]

    digits_17 = extension + gcp_9 + serial
    check = _gs1_check_digit(digits_17)

    sscc = digits_17 + str(check)
    assert len(sscc) == 18, f"SSCC должен быть 18 цифр, получено {len(sscc)}"
    return sscc





async def create_aggregation_draft(
    data: AggregationDocumentCreate,
    db: AsyncSession,
    org_id: UUID | None = None,
) -> AggregationDocument:
    kitu = data.kitu_code or generate_kitu_code()
    doc = AggregationDocument(
        kitu_code=kitu,
        product_group=data.product_group,
        marking_codes=data.marking_codes,
        status=AggregationStatus.DRAFT,
        org_id=org_id,
    )

    db.add(doc)

    await db.commit()

    await db.refresh(doc)

    return doc





def build_aggregation_document(

    kitu_code: str,

    marking_codes: list[str],

    product_group: str = "perfumery",

    participant_inn: str = "",

) -> dict:

    """

    Сформировать тело запроса для СУЗ API /api/v3/aggregation.

    Структура из официальной документации API СУЗ 3.0.

    """

    return {

        "productGroup": product_group,

        "participantId": participant_inn,

        "aggregationUnits": [

            {

                "aggregatedItemsCount": len(marking_codes),

                "aggregationType": "AGGREGATION",

                "aggregationUnitCapacity": len(marking_codes),

                "sntins": marking_codes,

                "unitSerialNumber": kitu_code,

            }

        ],

    }





async def get_aggregation_body_for_signing(

    doc_id: UUID,

    db: AsyncSession,

) -> tuple[AggregationDocument, str, str]:

    doc = await db.get(AggregationDocument, doc_id)

    if doc is None:

        raise LookupError("Документ не найден")



    device = await db.scalar(select(Device).limit(1))

    participant_inn = device.inn if device and device.inn else ""



    body_dict = build_aggregation_document(

        kitu_code=doc.kitu_code,

        marking_codes=doc.marking_codes,

        product_group=doc.product_group,

        participant_inn=participant_inn,

    )

    body_str = json.dumps(body_dict, ensure_ascii=False, separators=(",", ":"))

    body_b64 = base64.b64encode(body_str.encode("utf-8")).decode("utf-8")



    return doc, body_str, body_b64





async def send_aggregation_document(

    doc_id: UUID,

    signature: str,

    db: AsyncSession,

) -> AggregationDocument:

    doc = await db.get(AggregationDocument, doc_id)

    if doc is None:

        raise LookupError("Документ не найден")

    if doc.status not in (AggregationStatus.DRAFT, AggregationStatus.ERROR):

        raise ValueError(f"Нельзя отправить документ со статусом {doc.status}")



    settings = get_settings()



    token_raw = await get_active_token(db)

    token = _normalize_suz_client_token(token_raw or "")



    oms_id = settings.suz_oms_id or ""

    base_url = (settings.suz_api_base_url or "").rstrip("/")



    if not token:

        raise ValueError("Не задан clientToken СУЗ. Обновите токен в настройках.")

    if not oms_id:

        raise ValueError("Не задан OMS ID")



    device = await db.scalar(select(Device).limit(1))

    participant_inn = device.inn if device and device.inn else ""



    body_dict = build_aggregation_document(

        kitu_code=doc.kitu_code,

        marking_codes=doc.marking_codes,

        product_group=doc.product_group,

        participant_inn=participant_inn,

    )

    body_str = json.dumps(body_dict, ensure_ascii=False, separators=(",", ":"))



    url = f"{base_url}/api/v3/aggregation"

    params = {"omsId": oms_id}

    headers = {

        "clientToken": token,

        "Content-Type": "application/json",

        "Accept": "application/json",

        "X-Signature": signature.replace("\r", "").replace("\n", "").strip(),

    }



    logger.info(

        "Aggregation SUZ request: url=%s, omsId=%s, kitu=%s, codes=%d",

        url,

        oms_id,

        doc.kitu_code,

        len(doc.marking_codes),

    )



    doc.signature_value = headers["X-Signature"]

    doc.status = AggregationStatus.PENDING



    response, err = await _suz_dispatch_httpx(

        method="POST",

        url=url,

        headers=headers,

        params=params,

        content=body_str.encode("utf-8"),

    )



    if response is None:

        doc.status = AggregationStatus.ERROR

        doc.error_message = str(err)

        await db.commit()

        await log_operation(
            db,
            operation_type=OperationLogType.AGGREGATION_SENT,
            status=OperationLogStatus.ERROR,
            description="Ошибка агрегации КИТУ",
            related_id=str(doc.id),
            related_type="aggregation_document",
            codes_count=len(doc.marking_codes),
            error_message=str(err)[:500],
        )

        raise RuntimeError(f"Ошибка отправки: {err}")



    logger.info(

        "Aggregation SUZ response: status=%d, body=%s",

        response.status_code,

        response.text[:300],

    )



    if response.status_code in (200, 201, 202):

        try:

            resp_data = response.json()

            doc.document_id = str(

                resp_data.get("reportId")

                or resp_data.get("id")

                or ""

            ) or None

        except Exception:

            doc.document_id = None

        doc.status = AggregationStatus.ACCEPTED

        doc.sent_at = datetime.now(timezone.utc)

        doc.error_message = None

    else:

        doc.status = AggregationStatus.ERROR

        doc.error_message = response.text[:500]

        await db.commit()

        await log_operation(
            db,
            operation_type=OperationLogType.AGGREGATION_SENT,
            status=OperationLogStatus.ERROR,
            description="Ошибка агрегации КИТУ",
            related_id=str(doc.id),
            related_type="aggregation_document",
            codes_count=len(doc.marking_codes),
            error_message=response.text[:500],
        )

        raise RuntimeError(

            f"СУЗ отклонил агрегацию ({response.status_code}): {response.text[:300]}"

        )



    await db.commit()

    await db.refresh(doc)

    await log_operation(
        db,
        operation_type=OperationLogType.AGGREGATION_SENT,
        status=OperationLogStatus.SUCCESS,
        description=f"Агрегация КИТУ {doc.kitu_code}: {len(doc.marking_codes)} кодов",
        related_id=str(doc.id),
        related_type="aggregation_document",
        codes_count=len(doc.marking_codes),
        details={"kitu_code": doc.kitu_code, "document_id": doc.document_id},
    )

    return doc





async def list_aggregation_documents(
    db: AsyncSession,
    org_id: UUID | None = None,
) -> list[AggregationDocument]:
    q = select(AggregationDocument)
    if org_id:
        q = q.where(AggregationDocument.org_id == org_id)
    result = await db.scalars(q.order_by(AggregationDocument.created_at.desc()))
    return list(result.all())


def build_disaggregation_document(kitu_code: str) -> dict:
    """Документ расформирования упаковки (DISAGGREGATION_DOCUMENT)."""
    return {
        "uit_code": kitu_code,
        "doc_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"),
    }


async def get_disaggregation_body(
    doc_id: UUID,
    db: AsyncSession,
) -> tuple[AggregationDocument, str, str]:
    doc = await db.get(AggregationDocument, doc_id)
    if doc is None:
        raise LookupError("Документ не найден")
    body_dict = build_disaggregation_document(doc.kitu_code)
    body_json = json.dumps(body_dict, ensure_ascii=False, separators=(",", ":"))
    body_b64 = base64.b64encode(body_json.encode("utf-8")).decode("utf-8")
    return doc, body_json, body_b64


async def send_disaggregation(
    doc_id: UUID,
    signature: str,
    db: AsyncSession,
) -> AggregationDocument:
    """Расформировать упаковку — обратная агрегация через True API."""
    doc = await db.get(AggregationDocument, doc_id)
    if doc is None:
        raise LookupError("Документ агрегации не найден")
    if doc.status != AggregationStatus.ACCEPTED:
        raise ValueError("Можно расформировать только принятую упаковку")

    settings = get_settings()
    token = await get_true_api_token(db)
    base_url = (settings.true_api_base_url or "").rstrip("/")

    if not token:
        raise ValueError("Не настроен JWT токен True API")

    body_dict = build_disaggregation_document(doc.kitu_code)
    body_json = json.dumps(body_dict, ensure_ascii=False, separators=(",", ":"))
    body_b64 = base64.b64encode(body_json.encode("utf-8")).decode("utf-8")

    request_body = {
        "document_format": "MANUAL",
        "type": "DISAGGREGATION_DOCUMENT",
        "product_document": body_b64,
        "signature": signature.replace("\r", "").replace("\n", "").strip(),
    }

    url = f"{base_url}/api/v3/true-api/lk/documents/create"
    params = {"pg": doc.product_group}
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    body_str = json.dumps(request_body, ensure_ascii=False)

    logger.info(
        "Disaggregation request: url=%s, pg=%s, kitu=%s",
        url,
        doc.product_group,
        doc.kitu_code,
    )

    response, err = await _suz_dispatch_httpx(
        method="POST",
        url=url,
        headers=headers,
        params=params,
        content=body_str.encode("utf-8"),
    )

    if response is None:
        await log_operation(
            db,
            operation_type=OperationLogType.AGGREGATION_SENT,
            status=OperationLogStatus.ERROR,
            description=f"Ошибка расформирования КИТУ {doc.kitu_code}",
            related_id=str(doc.id),
            related_type="aggregation_document",
            codes_count=len(doc.marking_codes),
            error_message=str(err)[:500],
        )
        raise RuntimeError(f"Ошибка: {err}")

    logger.info(
        "Disaggregation response: status=%d, body=%s",
        response.status_code,
        response.text[:300],
    )

    if response.status_code in (200, 201, 202):
        doc.status = AggregationStatus.DRAFT
        doc.error_message = "Расформирована"
        doc.document_id = None
        doc.sent_at = None
        await db.commit()
        await db.refresh(doc)
        await log_operation(
            db,
            operation_type=OperationLogType.AGGREGATION_SENT,
            status=OperationLogStatus.SUCCESS,
            description=f"Расформирована упаковка КИТУ {doc.kitu_code}",
            related_id=str(doc.id),
            related_type="aggregation_document",
            codes_count=len(doc.marking_codes),
            details={"kitu_code": doc.kitu_code, "action": "disaggregation"},
        )
        return doc

    await log_operation(
        db,
        operation_type=OperationLogType.AGGREGATION_SENT,
        status=OperationLogStatus.ERROR,
        description=f"Ошибка расформирования КИТУ {doc.kitu_code}",
        related_id=str(doc.id),
        related_type="aggregation_document",
        codes_count=len(doc.marking_codes),
        error_message=response.text[:500],
    )
    raise RuntimeError(
        f"True API отклонил ({response.status_code}): {response.text[:200]}"
    )


