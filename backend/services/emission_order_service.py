from __future__ import annotations
import logging
from typing import Any
from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from models import (
    Device,
    DocumentUPD,
    EmissionOrder,
    EmissionOrderStatus,
    OperationLogStatus,
    OperationLogType,
    ProductCard,
)
from services.journal_service import log_operation
from schemas import EmissionOrderCreate
from services.suz_integration_service import (
    SuzIntegrationError,
    build_suz_close_order_body,
    build_suz_create_order_body,
    close_suz_order,
    dumps_suz_request_body,
    fetch_suz_order_codes,
    fetch_suz_orders_raw,
    map_suz_status_to_emission,
    release_method_options_for_gtin,
    submit_suz_emission_order,
)
from services.token_service import get_active_token
from services.utilisation_service import normalize_codes_for_utilisation
from settings import Settings, get_settings
logger = logging.getLogger(__name__)


def _resolve_product_group(explicit: str | None, settings: Settings) -> str:
    product_group = (explicit or "").strip() or (settings.suz_product_group or "").strip()
    if not product_group:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Не задана товарная группа. Укажите product_group или настройте SUZ_PRODUCT_GROUP в .env",
        )
    return product_group


_SUZ_TRANSPORT_DIAG_HINT = (
    " Подробнее (TLS/DNS, без вашего clientToken): GET /api/v1/emission-orders/diagnostics/connectivity."
)
def _gtin_variants(raw: str | None) -> set[str]:
    if not raw:
        return set()
    digits = "".join(c for c in str(raw) if c.isdigit())
    if not digits:
        return set()
    out = {digits}
    if len(digits) <= 14:
        out.add(digits.zfill(14))
    stripped = digits.lstrip("0") or "0"
    out.add(stripped)
    if len(stripped) <= 14:
        out.add(stripped.zfill(14))
    return {x for x in out if x}
def _normalize_gtin14_for_suz(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = "".join(c for c in str(raw) if c.isdigit())
    if not digits:
        return None
    if len(digits) > 14:
        digits = digits[-14:]
    return digits.zfill(14)
async def _resolve_product_card_by_gtin(db: AsyncSession, gtin: str | None) -> ProductCard | None:
    variants = _gtin_variants(gtin)
    if not variants:
        return None
    result = await db.scalars(select(ProductCard).where(ProductCard.gtin.in_(variants)))
    cards = list(result.all())
    return cards[0] if cards else None


async def resolve_product_card_by_gtin(db: AsyncSession, gtin: str | None) -> ProductCard | None:
    return await _resolve_product_card_by_gtin(db, gtin)
async def _get_suz_token(db: AsyncSession) -> str | None:
    return await get_active_token(db)
async def _resolve_oms_for_suz(db: AsyncSession) -> str:
    settings = get_settings()
    oms = (settings.suz_oms_id or "").strip()
    if oms:
        return oms
    dev_result = await db.scalars(select(Device).order_by(Device.created_at.asc()).limit(1))
    device = dev_result.first()
    if device:
        oms = device.oms_id.strip()
        if oms:
            logger.debug("_resolve_oms_for_suz: omsId из устройства в БД: %s", oms)
            return oms
    logger.warning(
        "_resolve_oms_for_suz: omsId не найден ни в SUZ_OMS_ID, ни в таблице devices"
    )
    return (settings.suz_oms_id or "").strip()
async def create_order(
    data: EmissionOrderCreate,
    db: AsyncSession,
    org_id: UUID | None = None,
) -> EmissionOrder:
    product_card = await db.get(ProductCard, data.product_card_id)
    if product_card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Карточка товара не найдена")
    from_override = _normalize_gtin14_for_suz(data.gtin.strip() if data.gtin else None)
    from_card = _normalize_gtin14_for_suz(product_card.gtin)
    order_gtin = from_override or from_card
    rmt = (data.release_method_type or "").strip().upper() or None
    settings = get_settings()
    order = EmissionOrder(
        product_card_id=data.product_card_id,
        gtin=order_gtin,
        quantity=data.quantity,
        status=EmissionOrderStatus.CREATED,
        suz_order_id=data.suz_order_id,
        release_method_type=rmt,
        production_order_id=data.production_order_id,
        payment_type=data.payment_type,
        product_group=_resolve_product_group(data.product_group, settings),
        org_id=org_id,
    )
    db.add(order)
    await db.commit()
    await db.refresh(order)
    await log_operation(
        db,
        operation_type=OperationLogType.ORDER_CREATED,
        status=OperationLogStatus.SUCCESS,
        description=f"Создан заказ СУЗ: {data.quantity} кодов",
        related_id=str(order.id),
        related_type="emission_order",
        codes_count=data.quantity,
        gtin=order_gtin,
    )
    return order
async def get_orders(
    db: AsyncSession,
    org_id: UUID | None = None,
) -> list[EmissionOrder]:
    q = select(EmissionOrder)
    if org_id:
        q = q.where(EmissionOrder.org_id == org_id)
    result = await db.scalars(q.order_by(EmissionOrder.created_at.desc()))
    return list(result.all())
async def list_marking_codes_for_print(
    db: AsyncSession,
    org_id: UUID | None = None,
) -> list[str]:
    seen: dict[str, None] = {}
    order_q = select(EmissionOrder)
    upd_q = select(DocumentUPD)
    if org_id:
        order_q = order_q.where(EmissionOrder.org_id == org_id)
        upd_q = upd_q.where(DocumentUPD.org_id == org_id)
    for order in (await db.scalars(order_q)).all():
        for c in order.suz_marking_codes or []:
            s = str(c).strip()
            if s:
                seen.setdefault(s, None)
    for doc in (await db.scalars(upd_q)).all():
        for c in doc.marking_codes or []:
            s = str(c).strip()
            if s:
                seen.setdefault(s, None)
    return sorted(seen.keys())
async def list_all_marking_codes(
    db: AsyncSession,
    gtin: str | None = None,
    order_id: str | None = None,
    search: str | None = None,
    limit: int = 100,
    offset: int = 0,
    org_id: UUID | None = None,
) -> dict:
    q = select(EmissionOrder)
    if org_id:
        q = q.where(EmissionOrder.org_id == org_id)
    orders = (await db.scalars(q.order_by(EmissionOrder.created_at.desc()))).all()
    items = []
    for order in orders:
        if not order.suz_marking_codes:
            continue
        if order_id and str(order.id) != order_id:
            continue
        if gtin and order.gtin != gtin:
            continue
        for code in order.suz_marking_codes:
            if search and search.lower() not in code.lower():
                continue
            items.append({
                "code": code,
                "gtin": order.gtin,
                "order_id": str(order.id),
                "suz_order_id": order.suz_order_id,
                "quantity_total": len(order.suz_marking_codes),
                "created_at": order.created_at,
            })
    total = len(items)
    return {
        "items": items[offset : offset + limit],
        "total": total,
    }
async def update_order_status(order_id: UUID, status_value: str, db: AsyncSession) -> EmissionOrder:
    order = await db.get(EmissionOrder, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Заказ на эмиссию не найден")
    try:
        next_status = EmissionOrderStatus(status_value)
    except ValueError as exc:
        allowed_statuses = ", ".join(s.value for s in EmissionOrderStatus)
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Некорректный статус. Допустимые значения: {allowed_statuses}",
        ) from exc
    order.status = next_status
    await db.commit()
    await db.refresh(order)
    return order
async def merge_orders(order_ids: list[UUID], db: AsyncSession) -> EmissionOrder:
    unique_order_ids = list(dict.fromkeys(order_ids))
    if len(unique_order_ids) < 2:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Для объединения необходимо минимум два разных заказа",
        )
    result = await db.scalars(select(EmissionOrder).where(EmissionOrder.id.in_(unique_order_ids)))
    orders = list(result.all())
    if len(orders) != len(unique_order_ids):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Один или несколько заказов не найдены")
    if any(o.product_card_id is None for o in orders):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Объединять можно только заказы с привязанной карточкой товара (подтяните GTIN или выберите карточку вручную).",
        )
    first_product_card_id = orders[0].product_card_id
    if any(order.product_card_id != first_product_card_id for order in orders):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Нельзя объединить заказы разных карточек товара",
        )
    if any(order.status != EmissionOrderStatus.CREATED for order in orders):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Объединять можно только заказы со статусом created",
        )
    merged_order = EmissionOrder(
        product_card_id=first_product_card_id,
        gtin=orders[0].gtin,
        quantity=sum(order.quantity for order in orders),
        status=EmissionOrderStatus.CREATED,
    )
    db.add(merged_order)
    for order in orders:
        await db.delete(order)
    await db.commit()
    await db.refresh(merged_order)
    return merged_order
async def sync_orders_from_suz(db: AsyncSession) -> dict[str, int]:
    oms = await _resolve_oms_for_suz(db)
    token = await _get_suz_token(db)
    try:
        rows, _url = await fetch_suz_orders_raw(
            oms_id=oms if oms else None,
            token_override=token,
        )
    except SuzIntegrationError as exc:
        logger.error("sync_orders_from_suz: СУЗ вернул ошибку: %s", exc, exc_info=True)
        hint = _SUZ_TRANSPORT_DIAG_HINT if exc.suggest_transport_diagnostics else ""
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=f"{exc}{hint}",
        ) from exc
    inserted = 0
    updated = 0
    for row in rows:
        suz_oid = row["order_id"]
        gtin: str | None = row.get("gtin")
        qty = int(row["quantity"])
        st = EmissionOrderStatus(
            row.get("emission_status") or map_suz_status_to_emission(row.get("status_raw") or "")
        )
        card = await _resolve_product_card_by_gtin(db, gtin)
        raw_codes = row.get("marking_codes")
        suz_codes: list[str] = (
            [str(c).strip() for c in raw_codes if str(c).strip()]
            if isinstance(raw_codes, list)
            else []
        )
        existing = await db.scalar(select(EmissionOrder).where(EmissionOrder.suz_order_id == suz_oid))
        if existing:
            existing.quantity = qty
            existing.status = st
            existing.gtin = gtin
            if card:
                existing.product_card_id = card.id
            if suz_codes:
                existing.suz_marking_codes = normalize_codes_for_utilisation(suz_codes)
            updated += 1
        else:
            db.add(
                EmissionOrder(
                    product_card_id=card.id if card else None,
                    gtin=gtin,
                    quantity=qty,
                    status=st,
                    suz_order_id=suz_oid,
                    suz_marking_codes=normalize_codes_for_utilisation(suz_codes),
                )
            )
            inserted += 1
    await db.commit()
    return {"inserted": inserted, "updated": updated, "total_remote": len(rows)}
async def patch_order_gtin(order_id: UUID, gtin_plain: str, db: AsyncSession) -> EmissionOrder:
    order = await db.get(EmissionOrder, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Заказ на эмиссию не найден")
    if order.suz_order_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Нельзя изменить GTIN после отправки заказа в СУЗ.",
        )
    if order.status != EmissionOrderStatus.CREATED:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail='GTIN можно задать только для заказа со статусом «создан» (created).',
        )
    gtin14 = _normalize_gtin14_for_suz(gtin_plain.strip())
    if not gtin14:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Некорректный формат GTIN.")
    order.gtin = gtin14
    await db.commit()
    await db.refresh(order)
    return order
async def _resolve_order_gtin_and_oms(
    order: EmissionOrder,
    db: AsyncSession,
) -> tuple[str, str]:
    gtin_raw: str | None = order.gtin.strip() if (order.gtin and str(order.gtin).strip()) else None
    if not gtin_raw and order.product_card_id:
        card = await db.get(ProductCard, order.product_card_id)
        if card is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Карточка товара для заказа не найдена")
        gtin_raw = card.gtin.strip() if card.gtin else None
    gtin14 = _normalize_gtin14_for_suz(gtin_raw)
    if not gtin14:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Для отправки в СУЗ нужен корректный GTIN (14 цифр).",
        )
    oms = await _resolve_oms_for_suz(db)
    if not oms.strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Не задан OMS ID: укажите SUZ_OMS_ID в .env или добавьте устройство.",
        )
    return gtin14, oms.strip()
async def prepare_suz_order_send_payload(
    order_id: UUID,
    db: AsyncSession,
    *,
    release_method_type: str | None = None,
    producer: str | None = None,
) -> dict[str, Any]:
    order = await db.get(EmissionOrder, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Заказ на эмиссию не найден")
    gtin14, _oms = await _resolve_order_gtin_and_oms(order, db)
    settings = get_settings()
    default_rmt, allowed = release_method_options_for_gtin(gtin14)
    stored_rmt = (order.release_method_type or "").strip().upper() or None
    body = build_suz_create_order_body(
        settings,
        product_group=_resolve_product_group(order.product_group, settings),
        gtin14=gtin14,
        quantity=int(order.quantity),
        production_order_id=order.production_order_id,
        release_method_type=release_method_type or stored_rmt or default_rmt,
        producer=producer,
        payment_type=order.payment_type,
    )
    rmt = str(body.get("attributes", {}).get("releaseMethodType", default_rmt))
    products = body.get("products") or []
    first_product = products[0] if products else {}
    template_id = int(first_product.get("templateId") or settings.suz_marking_template_id)
    return {
        "body": body,
        "body_string": dumps_suz_request_body(body),
        "release_method_type": rmt,
        "allowed_release_method_types": allowed,
        "gtin": gtin14,
        "product_group": str(body.get("productGroup", "")),
        "template_id": template_id,
    }
async def create_suz_order_via_proxy(
    *,
    body_string: str,
    signature: str,
    db: AsyncSession,
    local_order_id: UUID | None = None,
) -> tuple[EmissionOrder | None, str, dict[str, Any]]:
    if local_order_id is not None:
        order = await db.get(EmissionOrder, local_order_id)
        if order is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Локальный заказ не найден")
        if order.suz_order_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Заказ уже отправлен в СУЗ.",
            )
    oms = await _resolve_oms_for_suz(db)
    if not oms.strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Не задан OMS ID: укажите SUZ_OMS_ID в .env или добавьте устройство.",
        )
    token = await _get_suz_token(db)
    try:
        remote_oid, payload = await submit_suz_emission_order(
            oms_id=oms.strip(),
            body_string=body_string,
            x_signature=signature,
            token_override=token,
        )
    except SuzIntegrationError as exc:
        hint = _SUZ_TRANSPORT_DIAG_HINT if exc.suggest_transport_diagnostics else ""
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=f"{exc}{hint}") from exc
    order: EmissionOrder | None = None
    if local_order_id is not None:
        order = await db.get(EmissionOrder, local_order_id)
        assert order is not None
        order.suz_order_id = remote_oid
        order.status = EmissionOrderStatus.PENDING
        await db.commit()
        await db.refresh(order)
    return order, remote_oid, payload
async def send_order_to_suz(
    order_id: UUID,
    db: AsyncSession,
    *,
    body_string: str,
    signature: str,
) -> tuple[EmissionOrder, str, dict[str, Any]]:
    order = await db.get(EmissionOrder, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Заказ на эмиссию не найден")
    if order.suz_order_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Заказ уже связан с СУЗ (указан идентификатор удалённого заказа).",
        )
    if order.status != EmissionOrderStatus.CREATED:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail='Отправить в СУЗ можно только заказ со статусом «создан» (created).',
        )
    _gtin14, oms = await _resolve_order_gtin_and_oms(order, db)
    if not (body_string or "").strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Нужно body_string — та же строка JSON, которую подписали в браузере.",
        )
    token = await _get_suz_token(db)
    try:
        remote_oid, payload = await submit_suz_emission_order(
            oms_id=oms,
            body_string=body_string,
            x_signature=signature,
            token_override=token,
        )
    except SuzIntegrationError as exc:
        hint = _SUZ_TRANSPORT_DIAG_HINT if exc.suggest_transport_diagnostics else ""
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=f"{exc}{hint}",
        ) from exc
    order.gtin = _gtin14
    order.suz_order_id = remote_oid
    order.status = EmissionOrderStatus.PENDING
    await db.commit()
    await db.refresh(order)
    await log_operation(
        db,
        operation_type=OperationLogType.ORDER_SENT,
        status=OperationLogStatus.SUCCESS,
        description=f"Заказ отправлен в СУЗ: {remote_oid}",
        related_id=str(order.id),
        related_type="emission_order",
        codes_count=int(order.quantity),
        gtin=_gtin14,
        details={"suz_order_id": remote_oid},
    )
    return order, remote_oid, payload
async def download_order_codes(
    order_id: UUID,
    db: AsyncSession,
) -> tuple[EmissionOrder, list[str]]:
    order = await db.get(EmissionOrder, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Заказ не найден")
    if not order.suz_order_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Заказ ещё не отправлен в СУЗ")
    if not order.gtin:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="GTIN не указан")
    if order.status not in (EmissionOrderStatus.AVAILABLE,):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Заказ в статусе {order.status.value}, скачивание недоступно",
        )
    all_codes: list[str] = []
    last_block_id = 0
    token = await _get_suz_token(db)
    while True:
        try:
            block = await fetch_suz_order_codes(
                order_id=order.suz_order_id,
                gtin=order.gtin,
                quantity=min(150_000, int(order.quantity)),
                last_block_id=last_block_id,
                token_override=token,
            )
        except SuzIntegrationError as e:
            if "3390" in str(e) or "EXHAUSTED" in str(e):
                order.status = EmissionOrderStatus.EXHAUSTED
                await db.commit()
                await db.refresh(order)
                return order, list(order.suz_marking_codes or [])
            raise
        if not block:
            break
        all_codes.extend(block)
        last_block_id += 1
        if len(all_codes) >= int(order.quantity):
            break
    existing = set(order.suz_marking_codes or [])
    merged = list(existing | set(all_codes))
    order.suz_marking_codes = normalize_codes_for_utilisation(merged)
    if len(merged) >= int(order.quantity):
        order.status = EmissionOrderStatus.EXHAUSTED
    await db.commit()
    await db.refresh(order)
    codes_count = len(all_codes) if all_codes else len(merged)
    await log_operation(
        db,
        operation_type=OperationLogType.ORDER_CODES_DOWNLOADED,
        status=OperationLogStatus.SUCCESS,
        description=f"Скачано {codes_count} кодов маркировки",
        related_id=str(order.id),
        related_type="emission_order",
        codes_count=codes_count,
        gtin=order.gtin,
    )
    return order, merged
async def close_order(
    order_id: UUID,
    db: AsyncSession,
    *,
    signature: str,
) -> EmissionOrder:
    order = await db.get(EmissionOrder, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Заказ не найден")
    if not order.suz_order_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Заказ не отправлен в СУЗ")
    body_string = dumps_suz_request_body(build_suz_close_order_body(order.suz_order_id))
    token = await _get_suz_token(db)
    try:
        await close_suz_order(
            body_string=body_string,
            x_signature=signature,
            token_override=token,
        )
    except SuzIntegrationError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    order.status = EmissionOrderStatus.CLOSED
    await db.commit()
    await db.refresh(order)
    await log_operation(
        db,
        operation_type=OperationLogType.ORDER_CLOSED,
        status=OperationLogStatus.SUCCESS,
        description=f"Заказ закрыт: {order.suz_order_id}",
        related_id=str(order.id),
        related_type="emission_order",
        gtin=order.gtin,
        details={"suz_order_id": order.suz_order_id},
    )
    return order
