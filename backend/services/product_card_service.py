from __future__ import annotations
import csv
import io
import json
import logging
import random
from uuid import UUID
import openpyxl
from fastapi import HTTPException
from starlette import status as http_status
from fastapi import status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from models import GeneratedGtin, ProductCard, ProductCardStatus, ProductCardType
from schemas import ProductCardCreate, ProductCardUpdate
from services.gtin_utils import normalize_gtin
from services.national_catalog_integration_service import (
    NationalCatalogIntegrationError,
    _extract_assigned_gtin,
    fetch_feed_status,
    fetch_product_from_nk,
    send_product_card,
)
logger = logging.getLogger(__name__)
_FEED_STATUS_TO_CARD_STATUS: dict[str, ProductCardStatus] = {
    "Draft": ProductCardStatus.DRAFT,
    "Processing": ProductCardStatus.SENT,
    "Received": ProductCardStatus.SENT,
    "Checking": ProductCardStatus.SENT,
    "Moderation": ProductCardStatus.SENT,
    "Moderated": ProductCardStatus.AWAITING_SIGN,
    "Approved": ProductCardStatus.AWAITING_SIGN,
    "Ready": ProductCardStatus.AWAITING_SIGN,
    "ReadyToSign": ProductCardStatus.AWAITING_SIGN,
    "Signed": ProductCardStatus.PUBLISHED,
    "Published": ProductCardStatus.PUBLISHED,
    "Rejected": ProductCardStatus.DRAFT,
    "Error": ProductCardStatus.DRAFT,
    "Declined": ProductCardStatus.DRAFT,
}


def _map_feed_status(feed_status: str | None) -> ProductCardStatus | None:
    """Маппинг статуса НК → статус карточки. Регистронезависимо."""
    if not feed_status:
        return None
    if feed_status in _FEED_STATUS_TO_CARD_STATUS:
        return _FEED_STATUS_TO_CARD_STATUS[feed_status]
    fs_lower = feed_status.strip().lower()
    for key, val in _FEED_STATUS_TO_CARD_STATUS.items():
        if key.lower() == fs_lower:
            return val
    logger.warning("Неизвестный feed-status от НК: %r", feed_status)
    return None


def _resolve_card_status_from_feed(
    feed_status: str | None,
    remote_status: str | None = None,
    *,
    default_on_unknown: ProductCardStatus | None = None,
) -> ProductCardStatus | None:
    mapped = _map_feed_status(feed_status)
    if mapped:
        return mapped
    if remote_status == "published":
        return ProductCardStatus.PUBLISHED
    return default_on_unknown
_CARD_STRING_FIELDS = (
    "brand",
    "color",
    "size",
    "size_type",
    "composition",
    "country",
    "gender",
    "product_kind",
    "regulation",
    "tn_ved_code",
    "tn_ved_group",
    "model_article_type",
    "model_article",
)
def _optional_str(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None
def _normalize_gtin_field(value: str | None) -> str | None:
    if value is None:
        return None
    return normalize_gtin(value)
def _attrs_from_create(data: ProductCardCreate) -> dict:
    return {
        "type": data.type,
        "tn_ved": data.tn_ved.strip(),
        "gtin": _normalize_gtin_field(_optional_str(data.gtin)),
        "name": data.name.strip(),
        "status": ProductCardStatus.DRAFT,
        "brand": _optional_str(data.brand),
        "color": _optional_str(data.color),
        "size": _optional_str(data.size),
        "size_type": _optional_str(data.size_type),
        "composition": _optional_str(data.composition),
        "country": _optional_str(data.country),
        "gender": _optional_str(data.gender),
        "product_kind": _optional_str(data.product_kind),
        "regulation": _optional_str(data.regulation),
        "tn_ved_code": _optional_str(data.tn_ved_code),
        "tn_ved_group": _optional_str(data.tn_ved_group),
        "model_article_type": _optional_str(data.model_article_type),
        "model_article": _optional_str(data.model_article),
        "custom_name": data.custom_name,
        "is_set": data.is_set,
        "set_items": [item.model_dump() for item in data.set_items] if data.set_items else None,
        "extra_attrs": data.extra_attrs,
    }
def _copy_card_fields(source: ProductCard) -> dict:
    return {
        "type": source.type,
        "tn_ved": source.tn_ved,
        "gtin": source.gtin,
        "name": source.name,
        "status": ProductCardStatus.DRAFT,
        "brand": source.brand,
        "color": source.color,
        "size": source.size,
        "size_type": source.size_type,
        "composition": source.composition,
        "country": source.country,
        "gender": source.gender,
        "product_kind": source.product_kind,
        "regulation": source.regulation,
        "tn_ved_code": source.tn_ved_code,
        "tn_ved_group": source.tn_ved_group,
        "model_article_type": source.model_article_type,
        "model_article": source.model_article,
        "custom_name": source.custom_name,
        "is_set": source.is_set,
        "set_items": source.set_items,
        "extra_attrs": source.extra_attrs,
    }
def generate_gtin() -> str:
    prefix = "046"
    body = "".join(str(random.randint(0, 9)) for _ in range(10))
    gtin_no_check = prefix + body
    total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(gtin_no_check))
    check = (10 - (total % 10)) % 10
    return gtin_no_check + str(check)
def _resolve_cat_id(data: ProductCardCreate) -> int | None:
    if data.cat_id is not None:
        return data.cat_id
    if data.extra_attrs and isinstance(data.extra_attrs, dict):
        raw = data.extra_attrs.get("nk_cat_id")
        if isinstance(raw, int) and raw > 0:
            return raw
        if isinstance(raw, str) and raw.isdigit():
            return int(raw)
    return None
# Поля заблокированные для редактирования по статусам
# (по ТЗ Национального каталога)

# Поля считающиеся "обязательными для маркировки" — блокируются после публикации
_REQUIRED_MARKING_FIELDS = {
    "tn_ved", "tn_ved_code", "tn_ved_group", "gtin", "brand", "type",
}

# Поля всегда блокируемые в черновике (по ТЗ — только через техподдержку ЧЗ)
_DRAFT_LOCKED_FIELDS = {
    "brand",      # Бренд — только через техподдержку
    "tn_ved",     # 4-значный ТНВЭД — только через техподдержку
}


def _check_edit_allowed(card: ProductCard, data: ProductCardUpdate) -> None:
    """
    Проверить что редактирование разрешено по статусу карточки.
    Бросает HTTPException если нарушены правила ТЗ.
    """
    card_status = card.status
    changed = set(data.model_dump(exclude_none=True).keys())

    # Архив — редактирование запрещено
    if card_status == ProductCardStatus.ARCHIVED:
        raise HTTPException(
            http_status.HTTP_400_BAD_REQUEST,
            detail="Карточка в архиве. Редактирование недоступно. "
                   "Восстановите карточку из архива для редактирования.",
        )

    # Черновик — нельзя менять brand и 4-значный tn_ved
    if card_status == ProductCardStatus.DRAFT:
        locked = changed & _DRAFT_LOCKED_FIELDS
        if locked:
            field_names = {"brand": "Бренд", "tn_ved": "Код ТН ВЭД (4-значный)"}
            blocked = [field_names.get(f, f) for f in locked]
            raise HTTPException(
                http_status.HTTP_400_BAD_REQUEST,
                detail=f"Поля {', '.join(blocked)} нельзя изменить даже в черновике. "
                       "Эти поля меняются только через техподдержку Честного Знака.",
            )

    # Опубликована — только необязательные атрибуты
    elif card_status == ProductCardStatus.PUBLISHED:
        locked = changed & _REQUIRED_MARKING_FIELDS
        if locked:
            raise HTTPException(
                http_status.HTTP_400_BAD_REQUEST,
                detail="Опубликованная карточка: обязательные для маркировки поля "
                       "(бренд, ТН ВЭД, GTIN, тип) заблокированы. "
                       "Можно менять только необязательные атрибуты. "
                       "Для изменения обязательных полей обратитесь в техподдержку НКМТ "
                       "(support@national-catalog.ru).",
            )

    # Ожидает подписания — только отмеченные модератором поля
    # (в нашей реализации модератор не отмечает поля через API,
    #  поэтому разрешаем редактирование необязательных, блокируем обязательные)
    elif card_status == ProductCardStatus.AWAITING_SIGN:
        locked = changed & _REQUIRED_MARKING_FIELDS
        if locked:
            raise HTTPException(
                http_status.HTTP_400_BAD_REQUEST,
                detail="Карточка ожидает подписания. Обязательные поля заблокированы. "
                       "Для изменения верните карточку в черновик.",
            )


def _resolve_cat_id_for_update(data: ProductCardUpdate, card: ProductCard) -> int | None:
    if hasattr(data, "cat_id") and data.cat_id:
        return data.cat_id
    if data.extra_attrs and isinstance(data.extra_attrs, dict):
        raw = data.extra_attrs.get("nk_cat_id")
        if isinstance(raw, int) and raw > 0:
            return raw
        if isinstance(raw, str) and raw.isdigit():
            return int(raw)
    if card.extra_attrs and isinstance(card.extra_attrs, dict):
        raw = card.extra_attrs.get("nk_cat_id")
        if isinstance(raw, int) and raw > 0:
            return raw
        if isinstance(raw, str) and raw.isdigit():
            return int(raw)
    return None
def _card_nk_snapshot(card: ProductCard) -> dict:
    return {
        "id": str(card.id),
        "type": card.type.value if hasattr(card.type, "value") else card.type,
        "tn_ved": card.tn_ved,
        "gtin": card.gtin,
        "name": card.name,
        "brand": card.brand,
        "color": card.color,
        "size": card.size,
        "size_type": card.size_type,
        "composition": card.composition,
        "country": card.country,
        "gender": card.gender,
        "product_kind": card.product_kind,
        "regulation": card.regulation,
        "tn_ved_code": card.tn_ved_code,
        "tn_ved_group": card.tn_ved_group,
        "model_article_type": card.model_article_type,
        "model_article": card.model_article,
        "custom_name": card.custom_name,
        "is_set": card.is_set,
        "set_items": card.set_items,
        "extra_attrs": card.extra_attrs,
    }
async def create_card(
    data: ProductCardCreate,
    db: AsyncSession,
    org_id: UUID | None = None,
) -> ProductCard:
    cat_id = _resolve_cat_id(data)
    logger.info(
        "create_card: входные данные: %s, cat_id=%s",
        json.dumps(data.model_dump(), ensure_ascii=False, default=str),
        cat_id,
    )
    try:
        card = ProductCard(**_attrs_from_create(data), org_id=org_id)
        db.add(card)
        await db.commit()
        await db.refresh(card)
        logger.info(
            "create_card: карточка сохранена локально: %s",
            json.dumps(_card_nk_snapshot(card), ensure_ascii=False, default=str),
        )
    except Exception:
        logger.exception("create_card: ошибка при локальном сохранении карточки")
        raise
    try:
        logger.info(
            "create_card: отправка в НК — card_id=%s, cat_id=%s, payload=%s",
            card.id,
            cat_id,
            json.dumps(_card_nk_snapshot(card), ensure_ascii=False, default=str),
        )
        submission_result = await send_product_card(card, cat_id)
        logger.info(
            "НК submission result: remote_status=%s, feed_id=%s, feed_status=%s, payload=%s",
            submission_result.remote_status,
            submission_result.feed_id,
            submission_result.feed_status,
            str(submission_result.feed_payload)[:500],
        )
        logger.info(
            "create_card: ответ от НК — card_id=%s, feed_id=%s, feed_status=%s, "
            "remote_status=%s, feed_payload=%s",
            card.id,
            submission_result.feed_id,
            submission_result.feed_status,
            submission_result.remote_status,
            json.dumps(submission_result.feed_payload, ensure_ascii=False, default=str)
            if submission_result.feed_payload is not None
            else None,
        )
    except NationalCatalogIntegrationError as exc:
        logger.exception(
            "create_card: NationalCatalogIntegrationError при отправке в НК, card_id=%s",
            card.id,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Карточка создана локально, но не отправлена в Национальный каталог: {exc}",
        ) from exc
    except Exception:
        logger.exception(
            "create_card: неожиданная ошибка при отправке в НК, card_id=%s",
            card.id,
        )
        raise
    try:
        card.national_catalog_feed_id = submission_result.feed_id
        card.national_catalog_feed_status = submission_result.feed_status
        card.national_catalog_feed_payload = submission_result.feed_payload
        card.status = _resolve_card_status_from_feed(
            submission_result.feed_status,
            submission_result.remote_status,
            default_on_unknown=ProductCardStatus.SENT,
        ) or ProductCardStatus.SENT
        if (
            card.type == ProductCardType.TECH_CARD
            and not card.gtin
            and getattr(submission_result, "assigned_gtin", None)
        ):
            card.gtin = submission_result.assigned_gtin
            logger.info("Тех.карточке присвоен GTIN от НК: %s", card.gtin)
        await db.commit()
        await db.refresh(card)
        logger.info(
            "create_card: карточка обновлена после ответа НК — card_id=%s, status=%s",
            card.id,
            card.status.value if hasattr(card.status, "value") else card.status,
        )
        if card.gtin:
            await db.execute(
                update(GeneratedGtin)
                .where(GeneratedGtin.gtin == card.gtin)
                .values(is_used=True)
            )
            await db.commit()
            await db.refresh(card)
    except Exception:
        logger.exception(
            "create_card: ошибка при сохранении результата от НК, card_id=%s",
            card.id,
        )
        raise
    return card
async def update_card(
    card_id: UUID,
    data: ProductCardUpdate,
    db: AsyncSession,
) -> ProductCard | None:
    card = await db.get(ProductCard, card_id)
    if card is None:
        return None

    # Проверка прав на редактирование по статусу (ТЗ)
    _check_edit_allowed(card, data)

    for field, value in data.model_dump(exclude_none=True).items():
        if field in _CARD_STRING_FIELDS and isinstance(value, str):
            value = _optional_str(value)
        if field == "name" and isinstance(value, str):
            value = value.strip()
        if field == "tn_ved" and isinstance(value, str):
            value = value.strip()
        if field == "gtin" and isinstance(value, str):
            value = _normalize_gtin_field(_optional_str(value))
        if field == "set_items" and value is not None:
            value = [item if isinstance(item, dict) else item.model_dump() for item in value]
        setattr(card, field, value)
    await db.commit()
    await db.refresh(card)
    return card
async def send_card_to_nk(card_id: UUID, db: AsyncSession) -> ProductCard:
    card = await db.get(ProductCard, card_id)
    if card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Карточка не найдена")
    cat_id = _resolve_cat_id_for_update(ProductCardUpdate(), card)
    try:
        result = await send_product_card(card, cat_id)
    except NationalCatalogIntegrationError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    card.national_catalog_feed_id = result.feed_id
    card.national_catalog_feed_status = result.feed_status
    card.national_catalog_feed_payload = result.feed_payload
    mapped = _map_feed_status(result.feed_status)
    if mapped:
        card.status = mapped
    elif result.remote_status == "published":
        card.status = ProductCardStatus.PUBLISHED
    elif result.feed_id:
        card.status = ProductCardStatus.SENT
    if (
        card.type == ProductCardType.TECH_CARD
        and not card.gtin
        and getattr(result, "assigned_gtin", None)
    ):
        card.gtin = result.assigned_gtin
        logger.info("Тех.карточке присвоен GTIN от НК: %s", card.gtin)
    await db.commit()
    await db.refresh(card)
    return card
async def get_cards(db: AsyncSession, gtin: str | None = None) -> list[ProductCard]:
    items, _ = await list_cards(db, gtin=gtin, limit=10_000, offset=0)
    return items
async def list_cards(
    db: AsyncSession,
    *,
    gtin: str | None = None,
    status: str | None = None,
    limit: int = 500,
    offset: int = 0,
    org_id: UUID | None = None,
) -> tuple[list[ProductCard], int]:
    filters = []
    if org_id:
        filters.append(ProductCard.org_id == org_id)
    if gtin:
        filters.append(ProductCard.gtin == gtin.strip())
    if status and status != "all":
        filters.append(ProductCard.status == status)
    count_query = select(func.count()).select_from(ProductCard)
    query = select(ProductCard).order_by(ProductCard.created_at.desc())
    for clause in filters:
        count_query = count_query.where(clause)
        query = query.where(clause)
    total = int(await db.scalar(count_query) or 0)
    result = await db.scalars(query.limit(limit).offset(offset))
    return list(result.all()), total
async def get_card(card_id: UUID, db: AsyncSession) -> ProductCard | None:
    return await db.get(ProductCard, card_id)
async def archive_card(card_id: UUID, db: AsyncSession) -> ProductCard | None:
    """Отправить карточку в архив."""
    card = await db.get(ProductCard, card_id)
    if card is None:
        return None
    card.status = ProductCardStatus.ARCHIVED
    await db.commit()
    await db.refresh(card)
    return card


async def unarchive_card(card_id: UUID, db: AsyncSession) -> ProductCard | None:
    """Восстановить из архива — перевести в черновик."""
    card = await db.get(ProductCard, card_id)
    if card is None:
        return None
    if card.status == ProductCardStatus.ARCHIVED:
        card.status = ProductCardStatus.DRAFT
    await db.commit()
    await db.refresh(card)
    return card


async def delete_card(card_id: UUID, db: AsyncSession) -> bool:
    card = await db.get(ProductCard, card_id)
    if card is None:
        return False
    if card.status == ProductCardStatus.PUBLISHED:
        raise HTTPException(
            http_status.HTTP_400_BAD_REQUEST,
            detail="Опубликованную карточку нельзя удалить. "
                   "Используйте «Отправить в архив».",
        )
    await db.delete(card)
    await db.commit()
    return True


async def bulk_delete_cards(card_ids: list[UUID], db: AsyncSession) -> dict:
    deleted = 0
    archived = 0
    skipped = 0
    for card_id in card_ids:
        card = await db.get(ProductCard, card_id)
        if not card:
            skipped += 1
            continue
        if card.status == ProductCardStatus.PUBLISHED:
            card.status = ProductCardStatus.ARCHIVED
            archived += 1
        else:
            await db.delete(card)
            deleted += 1
    await db.commit()
    return {"deleted": deleted, "archived": archived, "skipped": skipped}
def _parse_import_rows(filename: str, content: bytes) -> list[dict[str, object]]:
    cards_data: list[dict[str, object]] = []
    if filename.lower().endswith(".xlsx"):
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True)
        ws = wb.active
        headers: list[str] | None = None
        for row in ws.iter_rows(values_only=True):
            if headers is None:
                headers = [str(h).strip().lower() if h else "" for h in row]
                continue
            if not any(row):
                continue
            cards_data.append(dict(zip(headers, row)))
        wb.close()
        return cards_data
    if filename.lower().endswith(".csv"):
        text = content.decode("utf-8-sig", errors="replace")
        reader = csv.DictReader(io.StringIO(text))
        for row in reader:
            normalized = {str(k).strip().lower(): v for k, v in row.items() if k}
            if any(normalized.values()):
                cards_data.append(normalized)
        return cards_data
    return cards_data
async def import_cards_from_file(
    filename: str,
    content: bytes,
    db: AsyncSession,
) -> dict:
    cards_data = _parse_import_rows(filename, content)
    created = 0
    skipped = 0
    sent_to_nk = 0
    errors: list[str] = []
    for row in cards_data:
        try:
            name = str(row.get("name") or row.get("наименование") or "").strip()
            tn_ved = str(row.get("tn_ved") or row.get("тнвэд") or row.get("tn ved") or "").strip()
            gtin_cell = row.get("gtin")
            if isinstance(gtin_cell, (int, float)) and not isinstance(gtin_cell, bool):
                gtin_raw = str(int(gtin_cell))
            else:
                gtin_raw = str(gtin_cell or "").strip()
                if "." in gtin_raw and gtin_raw.replace(".", "", 1).isdigit():
                    gtin_raw = gtin_raw.split(".", 1)[0]
            gtin = _normalize_gtin_field(gtin_raw) if gtin_raw else None
            if not name or not tn_ved:
                skipped += 1
                continue
            card = ProductCard(
                type=ProductCardType.TECH_CARD,
                tn_ved=tn_ved,
                gtin=gtin,
                name=name,
                status=ProductCardStatus.DRAFT,
                brand=str(row.get("brand") or row.get("бренд") or "").strip() or None,
                color=str(row.get("color") or row.get("цвет") or "").strip() or None,
                size=str(row.get("size") or row.get("размер") or "").strip() or None,
                country=str(row.get("country") or row.get("страна") or "").strip() or None,
            )
            db.add(card)
            await db.flush()
            try:
                result = await send_product_card(card, None)
                card.national_catalog_feed_id = result.feed_id
                card.national_catalog_feed_status = result.feed_status
                card.national_catalog_feed_payload = result.feed_payload
                card.status = (
                    _resolve_card_status_from_feed(
                        result.feed_status,
                        result.remote_status,
                        default_on_unknown=ProductCardStatus.SENT,
                    )
                    or ProductCardStatus.SENT
                )
                sent_to_nk += 1
            except NationalCatalogIntegrationError:
                pass
            created += 1
        except Exception as exc:
            errors.append(str(exc))
            skipped += 1
    await db.commit()
    return {
        "created": created,
        "sent_to_nk": sent_to_nk,
        "skipped": skipped,
        "errors": errors[:10],
    }
async def create_similar_card(card_id: UUID, db: AsyncSession) -> ProductCard | None:
    source_card = await db.get(ProductCard, card_id)
    if source_card is None:
        return None
    copied_card = ProductCard(
        **_copy_card_fields(source_card),
        name=f"(Копия) {source_card.name}",
    )
    db.add(copied_card)
    await db.commit()
    await db.refresh(copied_card)
    return copied_card
async def refresh_card_from_nk(card_id: UUID, db: AsyncSession) -> ProductCard:
    """
    «Нашли ошибку» — обновить данные карточки из НК.
    Подтягивает актуальный статус, GTIN, good_id из НК.
    """
    card = await db.get(ProductCard, card_id)
    if card is None:
        raise HTTPException(http_status.HTTP_404_NOT_FOUND, detail="Карточка не найдена")

    from settings import get_settings

    settings = get_settings()
    headers = {"Content-Type": "application/json; charset=utf-8"}
    auth_params: dict[str, str] = {}
    if settings.national_catalog_api_key:
        auth_params["apikey"] = settings.national_catalog_api_key
    elif settings.national_catalog_auth_token:
        headers["Authorization"] = f"Bearer {settings.national_catalog_auth_token}"

    if card.national_catalog_feed_id:
        feed_status, feed_payload = await fetch_feed_status(
            feed_id=card.national_catalog_feed_id,
            settings_send_url=settings.national_catalog_send_url,
            auth_params=auth_params,
            headers=headers,
            supplier_key=settings.national_catalog_supplier_key,
            timeout_seconds=settings.national_catalog_timeout_seconds,
        )
        card.national_catalog_feed_status = feed_status
        card.national_catalog_feed_payload = feed_payload
        mapped = _map_feed_status(feed_status)
        if mapped:
            card.status = mapped
        if card.type == ProductCardType.TECH_CARD and not card.gtin and feed_payload:
            assigned = _extract_assigned_gtin(feed_payload)
            if assigned:
                card.gtin = assigned

    if card.gtin:
        product = await fetch_product_from_nk(
            gtin=card.gtin,
            good_id=None,
            settings_send_url=settings.national_catalog_send_url,
            auth_params=auth_params,
            headers=headers,
            timeout_seconds=settings.national_catalog_timeout_seconds,
        )
        if product:
            nk_status = product.get("good_status")
            if nk_status:
                mapped = _map_feed_status(str(nk_status))
                if mapped:
                    card.status = mapped
            payload = dict(card.national_catalog_feed_payload or {})
            payload["nk_product"] = product
            card.national_catalog_feed_payload = payload

    await db.commit()
    await db.refresh(card)
    return card


async def sync_card_feed_status(card_id: UUID, db: AsyncSession) -> ProductCard:
    card = await db.get(ProductCard, card_id)
    if card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Карточка товара не найдена")
    if not card.national_catalog_feed_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Для карточки отсутствует feed_id. Сначала отправьте карточку в Национальный каталог.",
        )
    from settings import get_settings
    settings = get_settings()
    headers: dict[str, str] = {"Content-Type": "application/json; charset=utf-8"}
    auth_params: dict[str, str] = {}
    if settings.national_catalog_api_key:
        auth_params["apikey"] = settings.national_catalog_api_key
    elif settings.national_catalog_auth_token:
        headers["Authorization"] = f"Bearer {settings.national_catalog_auth_token}"
    else:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не настроена авторизация НК (NATIONAL_CATALOG_API_KEY/NATIONAL_CATALOG_AUTH_TOKEN).",
        )
    feed_status, feed_payload = await fetch_feed_status(
        feed_id=card.national_catalog_feed_id,
        settings_send_url=settings.national_catalog_send_url,
        auth_params=auth_params,
        headers=headers,
        supplier_key=settings.national_catalog_supplier_key,
        timeout_seconds=settings.national_catalog_timeout_seconds,
    )
    card.national_catalog_feed_status = feed_status
    card.national_catalog_feed_payload = feed_payload
    if card.type == ProductCardType.TECH_CARD and not card.gtin and feed_payload:
        from services.national_catalog_integration_service import _extract_assigned_gtin

        assigned = _extract_assigned_gtin(feed_payload)
        if assigned:
            card.gtin = assigned
            logger.info("sync: тех.карточке присвоен GTIN от НК: %s", card.gtin)
    mapped = _map_feed_status(feed_status)
    if mapped:
        card.status = mapped
    await db.commit()
    await db.refresh(card)
    return card
