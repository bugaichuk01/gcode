"""Сервис агрегации КИТУ."""

from __future__ import annotations

import base64

import json

import logging

import random

import time

from collections import Counter
from datetime import datetime, timezone
from typing import Any

from uuid import UUID

from sqlalchemy import select

from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    AggregationDocument,
    AggregationStatus,
    Device,
    OperationLogStatus,
    OperationLogType,
    ProductCard,
    ProductCardType,
)
from services.journal_service import log_operation

from schemas import AggregationDocumentCreate
from services.gtin_utils import normalize_gtin
from services.introduce_goods_service import extract_gtin_from_code

from services.suz_integration_service import (

    _normalize_suz_client_token,

    _suz_dispatch_httpx,

)

from services.token_service import get_active_token, get_true_api_token

from settings import get_settings



logger = logging.getLogger(__name__)

DEFAULT_KITU_GCP = "460000000"
MAX_KITU_BATCH_SIZE = 500
AGGREGATION_TYPE_KITU = "AGGREGATION"
AGGREGATION_TYPE_SET = "SETS_AGGREGATION"


def _is_bundle_card(card: ProductCard) -> bool:
    return card.is_set or card.type in (ProductCardType.BUNDLE, ProductCardType.SET)


def _format_gtin_counts(counts: Counter[str]) -> str:
    return ", ".join(f"{gtin}×{qty}" for gtin, qty in sorted(counts.items()))


def validate_set_composition(
    marking_codes: list[str],
    set_items: list[dict[str, Any]] | None,
    *,
    set_code: str | None = None,
    bundle_gtin: str | None = None,
) -> None:
    """
    Проверить, что вложенные КМ соответствуют set_items карточки набора в НК.

  GTIN вложений и их количество должны точно совпасть с карточкой.
    """
    if not set_items:
        raise ValueError("Карточка набора не содержит состав (set_items)")

    expected: Counter[str] = Counter()
    for item in set_items:
        gtin = normalize_gtin(str(item.get("gtin", "")))
        if not gtin:
            raise ValueError("В составе набора указан пустой GTIN")
        qty = int(item.get("quantity", 1))
        if qty < 1:
            raise ValueError(f"Некорректное количество для GTIN {gtin}")
        expected[gtin] += qty

    actual: Counter[str] = Counter()
    for code in marking_codes:
        gtin = extract_gtin_from_code(code)
        if not gtin:
            raise ValueError(
                f"Не удалось извлечь GTIN из кода маркировки: {code[:48]}…"
            )
        actual[normalize_gtin(gtin) or gtin] += 1

    if actual != expected:
        raise ValueError(
            "Состав вложений не соответствует карточке набора: "
            f"ожидается [{_format_gtin_counts(expected)}], "
            f"получено [{_format_gtin_counts(actual)}]"
        )

    if set_code and bundle_gtin:
        set_gtin = extract_gtin_from_code(set_code)
        bundle_norm = normalize_gtin(bundle_gtin)
        if set_gtin and bundle_norm and normalize_gtin(set_gtin) != bundle_norm:
            raise ValueError(
                "Код набора (unitSerialNumber) не соответствует GTIN карточки набора"
            )


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


def normalize_kitu_gcp(gcp: str) -> str:
    """Нормализовать GCP до 9 цифр (дополнение нулями справа)."""
    digits = "".join(ch for ch in gcp if ch.isdigit())
    if not digits:
        raise ValueError("GCP должен содержать хотя бы одну цифру")
    if len(digits) > 9:
        raise ValueError("GCP не может быть длиннее 9 цифр")
    return (digits + "000000000")[:9]


def validate_kitu_extension(extension: int) -> str:
    if extension < 0 or extension > 9:
        raise ValueError("Расширение SSCC должно быть от 0 до 9")
    return str(extension)


def verify_sscc_check_digit(sscc: str) -> bool:
    """Проверить контрольную цифру GS1 для 18-значного SSCC."""
    if len(sscc) != 18 or not sscc.isdigit():
        return False
    return int(sscc[-1]) == _gs1_check_digit(sscc[:-1])


def _build_sscc(extension: str, gcp_9: str, serial: str) -> str:
    digits_17 = extension + gcp_9 + serial
    check = _gs1_check_digit(digits_17)
    sscc = digits_17 + str(check)
    if len(sscc) != 18:
        raise ValueError(f"SSCC должен быть 18 цифр, получено {len(sscc)}")
    return sscc


def _random_serial() -> str:
    timestamp = str(int(time.time()))[-4:]
    random_part = str(random.randint(0, 999)).zfill(3)
    return (timestamp + random_part)[:7]


def generate_kitu_code(
    gcp: str = DEFAULT_KITU_GCP,
    extension: int = 0,
    *,
    serial: str | None = None,
) -> str:
    """
    Генерировать SSCC код (18 цифр) для КИТУ.

    Структура SSCC:
    - 1 цифра: расширение (0-9)
    - 9 цифр: GCP (глобальный префикс компании)
    - 7 цифр: серийный номер
    - 1 цифра: контрольная (алгоритм GS1)
    """
    ext_str = validate_kitu_extension(extension)
    gcp_9 = normalize_kitu_gcp(gcp)
    serial_7 = serial if serial is not None else _random_serial()
    if len(serial_7) != 7 or not serial_7.isdigit():
        raise ValueError("Серийный номер должен быть 7 цифр")
    return _build_sscc(ext_str, gcp_9, serial_7)


def generate_kitu_batch(
    *,
    gcp: str = DEFAULT_KITU_GCP,
    extension: int = 0,
    count: int = 1,
    units_per_kitu: int | None = None,
    unlimited: bool = False,
) -> list[dict[str, str | int | None]]:
    """
    Сгенерировать партию уникальных SSCC для КИТУ.

    GCP: пока передаётся в запросе (дефолт DEFAULT_KITU_GCP).
    В перспективе — поле organization_settings.sscc_gcp.
    """
    if count < 1:
        raise ValueError("Количество КИТУ должно быть не меньше 1")
    if count > MAX_KITU_BATCH_SIZE:
        raise ValueError(f"Максимум {MAX_KITU_BATCH_SIZE} КИТУ за один запрос")
    if unlimited:
        capacity: int | None = None
    else:
        if units_per_kitu is None or units_per_kitu < 1:
            raise ValueError("Укажите количество единиц на КИТУ или включите «без ограничений»")
        capacity = units_per_kitu

    ext_str = validate_kitu_extension(extension)
    gcp_9 = normalize_kitu_gcp(gcp)
    base_seed = int(time.time()) % 1_000_000
    used_serials: set[str] = set()
    items: list[dict[str, str | int | None]] = []

    for index in range(count):
        attempt = 0
        while True:
            serial_num = (base_seed + index * 7919 + attempt * 9973) % 10_000_000
            serial = str(serial_num).zfill(7)
            if serial not in used_serials:
                used_serials.add(serial)
                break
            attempt += 1
            if attempt > 100:
                raise RuntimeError("Не удалось сгенерировать уникальный серийный номер в партии")

        kitu_code = _build_sscc(ext_str, gcp_9, serial)
        items.append({
            "kitu_code": kitu_code,
            "units_capacity": capacity,
        })

    return items





async def create_aggregation_draft(
    data: AggregationDocumentCreate,
    db: AsyncSession,
    org_id: UUID | None = None,
) -> AggregationDocument:
    aggregation_type = str(data.aggregation_type or AGGREGATION_TYPE_KITU)

    if aggregation_type == AGGREGATION_TYPE_SET:
        if not data.kitu_code:
            raise ValueError("Укажите код набора (КИН) для unitSerialNumber")
        if not data.product_card_id:
            raise ValueError("Укажите карточку набора для проверки состава")
        card = await db.get(ProductCard, data.product_card_id)
        if card is None:
            raise LookupError("Карточка набора не найдена")
        if not _is_bundle_card(card):
            raise ValueError("Выбранная карточка не является набором")
        validate_set_composition(
            data.marking_codes,
            card.set_items,
            set_code=data.kitu_code,
            bundle_gtin=card.gtin,
        )
        unit_code = data.kitu_code
    else:
        unit_code = data.kitu_code or generate_kitu_code()

    doc = AggregationDocument(
        kitu_code=unit_code,
        product_group=data.product_group,
        marking_codes=data.marking_codes,
        units_capacity=data.units_capacity,
        aggregation_type=aggregation_type,
        product_card_id=data.product_card_id,
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
    aggregation_type: str = AGGREGATION_TYPE_KITU,
) -> dict:
    """
    Сформировать тело запроса для СУЗ API /api/v3/aggregation.

    Структура из официальной документации API СУЗ 3.0.
    Для КИТУ — aggregationType AGGREGATION, unitSerialNumber = SSCC.
    Для набора — aggregationType SETS_AGGREGATION, unitSerialNumber = код набора (КИН).
    """
    return {
        "productGroup": product_group,
        "participantId": participant_inn,
        "aggregationUnits": [
            {
                "aggregatedItemsCount": len(marking_codes),
                "aggregationType": aggregation_type,
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
        aggregation_type=doc.aggregation_type or AGGREGATION_TYPE_KITU,
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
        aggregation_type=doc.aggregation_type or AGGREGATION_TYPE_KITU,
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
        "Aggregation SUZ request: url=%s, omsId=%s, unit=%s, type=%s, codes=%d",
        url,
        oms_id,
        doc.kitu_code,
        doc.aggregation_type or AGGREGATION_TYPE_KITU,
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
        description=(
            f"Агрегация набора {doc.kitu_code}: {len(doc.marking_codes)} кодов"
            if (doc.aggregation_type or AGGREGATION_TYPE_KITU) == AGGREGATION_TYPE_SET
            else f"Агрегация КИТУ {doc.kitu_code}: {len(doc.marking_codes)} кодов"
        ),
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


