import io
from typing import Annotated
from uuid import UUID
import openpyxl
from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db_session
from dependencies import get_current_org, get_current_user
from models import GeneratedGtin, Organization, ProductCard, ProductCardStatus, User
from schemas import (
    ProductCardCreate,
    ProductCardListResponse,
    ProductCardResponse,
    ProductCardUpdate,
)
from services import product_card_service
from services.product_groups import (
    GISMT_TO_PRODUCT_GROUP,
    PRODUCT_GROUP_LABELS,
    PRODUCT_GROUP_TO_TNVED,
)
router = APIRouter(prefix="/product-cards", tags=["National Catalog"])


async def _fetch_tnved_groups_from_nk() -> list[dict]:
    """Получить листовые категории НК с реальными ТНВЭД по доступным gismt_codes."""
    from services.national_catalog_integration_service import _extract_base_url
    from settings import get_settings
    import httpx

    settings = get_settings()
    params: dict[str, str] = {}
    headers = {"Accept": "application/json"}
    if settings.national_catalog_api_key:
        params["apikey"] = settings.national_catalog_api_key
    elif settings.national_catalog_auth_token:
        headers["Authorization"] = f"Bearer {settings.national_catalog_auth_token}"

    base_url = _extract_base_url(settings.national_catalog_send_url or "")
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(
            f"{base_url}/v3/categories",
            params=params,
            headers=headers,
        )
    if response.status_code != 200:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=f"НК недоступен: {response.status_code}",
        )

    all_categories = response.json()
    if isinstance(all_categories, dict):
        all_categories = (
            all_categories.get("result")
            or all_categories.get("categories")
            or all_categories.get("items")
            or []
        )

    available_gismt_codes: set[int] = set()
    for cat in all_categories:
        for code in cat.get("gismt_codes") or []:
            available_gismt_codes.add(int(code))

    result: list[dict] = []
    seen: set[str] = set()

    for gismt_code in sorted(available_gismt_codes):
        product_group = GISMT_TO_PRODUCT_GROUP.get(gismt_code, "other")
        tnved_codes = PRODUCT_GROUP_TO_TNVED.get(product_group, [])
        if not tnved_codes:
            continue

        leaf_categories = [
            cat for cat in all_categories
            if (
                cat.get("category_active")
                and gismt_code in (cat.get("gismt_codes") or [])
                and not any(
                    c.get("cat_parent_id") == cat.get("cat_id")
                    for c in all_categories
                    if c.get("category_active")
                )
            )
        ]
        if not leaf_categories:
            leaf_categories = [
                cat for cat in all_categories
                if (
                    cat.get("category_active")
                    and gismt_code in (cat.get("gismt_codes") or [])
                )
            ]

        for cat in leaf_categories:
            cat_id = cat.get("cat_id")
            cat_name = cat.get("cat_name", "")
            for tnved in tnved_codes:
                key = f"{cat_id}_{tnved}"
                if key in seen:
                    continue
                seen.add(key)
                result.append({
                    "cat_id": cat_id,
                    "cat_name": cat_name,
                    "tnved": tnved,
                    "gismt_code": gismt_code,
                    "label": f"{tnved} — {cat_name}",
                    "product_group": product_group,
                })

    result.sort(key=lambda x: (x["product_group"], x["tnved"]))
    return result
@router.post("/", response_model=ProductCardResponse, status_code=status.HTTP_201_CREATED)
async def create_product_card(
    data: ProductCardCreate,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> ProductCardResponse:
    return await product_card_service.create_card(
        data, db, org_id=org.id if org else None
    )
@router.get("/", response_model=ProductCardListResponse)
async def list_product_cards(
    gtin: str | None = None,
    status: str | None = None,
    limit: int = 500,
    offset: int = 0,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> ProductCardListResponse:
    items, total = await product_card_service.list_cards(
        db,
        gtin=gtin,
        status=status,
        limit=limit,
        offset=offset,
        org_id=org.id if org else None,
    )
    return ProductCardListResponse(
        items=[ProductCardResponse.model_validate(c) for c in items],
        total=total,
        limit=limit,
        offset=offset,
    )
@router.post("/import-excel", response_model=dict)
async def import_cards_from_excel(
    file: UploadFile = File(...),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    fname = file.filename or ""
    if not (fname.lower().endswith(".xlsx") or fname.lower().endswith(".csv")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Только .xlsx или .csv")
    body = await file.read()
    return await product_card_service.import_cards_from_file(fname, body, db)
@router.get("/export-excel")
async def export_cards_excel(
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> StreamingResponse:
    cards, _ = await product_card_service.list_cards(
        db, limit=10_000, offset=0, org_id=org.id if org else None
    )
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Карточки НК"
    headers = [
        "GTIN",
        "Наименование",
        "Тип",
        "ТН ВЭД",
        "Статус",
        "Бренд",
        "Цвет",
        "Размер",
        "Состав",
        "Страна",
        "Вид изделия",
        "Артикул",
        "Статус НК",
        "Дата создания",
    ]
    ws.append(headers)
    for card in cards:
        ws.append([
            card.gtin or "",
            card.name,
            card.type.value,
            card.tn_ved,
            card.status.value,
            card.brand or "",
            card.color or "",
            card.size or "",
            card.composition or "",
            card.country or "",
            card.product_kind or "",
            card.model_article or "",
            card.national_catalog_feed_status or "",
            card.created_at.strftime("%Y-%m-%d %H:%M") if card.created_at else "",
        ])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=product_cards.xlsx"},
    )
@router.post("/bulk-delete", response_model=dict)
async def bulk_delete_cards(
    card_ids: Annotated[list[UUID], Body()],
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    return await product_card_service.bulk_delete_cards(card_ids, db)
@router.post("/generate-gtin", response_model=dict)
async def generate_gtin(
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    gtin = product_card_service.generate_gtin()
    pool_entry = GeneratedGtin(gtin=gtin, is_used=False, org_id=org.id if org else None)
    db.add(pool_entry)
    await db.commit()
    return {"gtin": gtin}


@router.get("/available-gtins")
async def get_available_gtins(
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Неиспользованные сгенерированные GTIN (ТЗ — переиспользование)."""
    from sqlalchemy import select

    q = select(GeneratedGtin).where(GeneratedGtin.is_used == False)  # noqa: E712
    if org:
        q = q.where(GeneratedGtin.org_id == org.id)
    result = await db.scalars(q.limit(20))
    return {"gtins": [g.gtin for g in result.all()]}


@router.get("/attributes-for-tnved")
async def get_attributes_for_tnved(
    tnved: str,
    cat_id: int | None = None,
    _: User = Depends(get_current_user),
) -> dict:
    from services.national_catalog_integration_service import (
        _active_cat_ids_from_categories,
        _fetch_categories_by_tnved,
        _fetch_optional_attrs,
        _fetch_required_attrs,
    )
    from settings import get_settings
    import httpx
    settings = get_settings()
    if not settings.national_catalog_send_url:
        return {"attrs": [], "optional_attrs": [], "categories": [], "error": "НК не настроен"}
    params: dict[str, str] = {}
    headers = {"Content-Type": "application/json; charset=utf-8"}
    if settings.national_catalog_api_key:
        params["apikey"] = settings.national_catalog_api_key
    elif settings.national_catalog_auth_token:
        headers["Authorization"] = f"Bearer {settings.national_catalog_auth_token}"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            categories: list = []
            active_cat_ids: list[int] = []
            try:
                categories = await _fetch_categories_by_tnved(
                    client=client,
                    send_url=settings.national_catalog_send_url,
                    auth_params=params,
                    headers=headers,
                    tnved=tnved,
                )
                active_cat_ids = _active_cat_ids_from_categories(categories)
            except Exception:
                if cat_id:
                    active_cat_ids = [cat_id]
                else:
                    raise
            mandatory_attrs, resolved_cat_id = await _fetch_required_attrs(
                client=client,
                send_url=settings.national_catalog_send_url,
                auth_params=params,
                headers=headers,
                tnved=tnved,
                cat_id=cat_id,
                active_cat_ids=active_cat_ids,
            )
            optional_attrs = await _fetch_optional_attrs(
                client=client,
                send_url=settings.national_catalog_send_url,
                auth_params=params,
                headers=headers,
                tnved=tnved,
                cat_id=cat_id or resolved_cat_id,
                active_cat_ids=active_cat_ids,
            )
        return {
            "attrs": mandatory_attrs,
            "optional_attrs": optional_attrs,
            "categories": categories,
            "active_cat_ids": active_cat_ids,
            "resolved_cat_id": resolved_cat_id,
        }
    except Exception as e:
        return {"attrs": [], "optional_attrs": [], "categories": [], "error": str(e)}
@router.get("/tnved-groups")
async def get_tnved_groups(
    _: User = Depends(get_current_user),
) -> list[dict]:
    """ТНВЭД-группы участника: реальные коды ТНВЭД + cat_id из НК."""
    return await _fetch_tnved_groups_from_nk()


@router.get("/available-product-groups")
async def get_available_product_groups(
    _: User = Depends(get_current_user),
) -> list[dict]:
    """Товарные группы СУЗ, доступные участнику по данным НК."""
    tnved_groups = await _fetch_tnved_groups_from_nk()
    seen: set[str] = set()
    result: list[dict] = []
    for item in tnved_groups:
        pg = item.get("product_group")
        if pg and pg != "other" and pg not in seen:
            seen.add(pg)
            result.append({
                "value": pg,
                "label": PRODUCT_GROUP_LABELS.get(pg, pg),
            })
    return result


@router.post("/{card_id}/archive", response_model=ProductCardResponse)
async def archive_card(
    card_id: UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ProductCardResponse:
    """Отправить карточку в архив (для опубликованных)."""
    card = await product_card_service.archive_card(card_id, db)
    if card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Карточка не найдена")
    return card


@router.post("/{card_id}/unarchive", response_model=ProductCardResponse)
async def unarchive_card(
    card_id: UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ProductCardResponse:
    """Восстановить карточку из архива (переводит в черновик)."""
    card = await product_card_service.unarchive_card(card_id, db)
    if card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Карточка не найдена")
    return card


@router.post("/{card_id}/refresh-from-nk", response_model=ProductCardResponse)
async def refresh_from_nk(
    card_id: UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ProductCardResponse:
    """«Нашли ошибку» — обновить данные карточки из НК."""
    return await product_card_service.refresh_card_from_nk(card_id, db)


@router.get("/{card_id}", response_model=ProductCardResponse)
async def get_product_card(
    card_id: UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ProductCardResponse:
    card = await product_card_service.get_card(card_id, db)
    if card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Карточка товара не найдена")
    return card
@router.patch("/{card_id}", response_model=ProductCardResponse)
async def update_product_card(
    card_id: UUID,
    data: ProductCardUpdate,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ProductCardResponse:
    card = await product_card_service.update_card(card_id, data, db)
    if card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Карточка не найдена")
    return card
@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product_card(
    card_id: UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> None:
    deleted = await product_card_service.delete_card(card_id, db)
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Карточка товара не найдена")
@router.post("/{card_id}/copy", response_model=ProductCardResponse, status_code=status.HTTP_201_CREATED)
async def copy_product_card(
    card_id: UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ProductCardResponse:
    card = await product_card_service.create_similar_card(card_id, db)
    if card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Карточка товара не найдена")
    return card
@router.post("/{card_id}/sync-feed-status", response_model=ProductCardResponse)
async def sync_product_card_feed_status(
    card_id: UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ProductCardResponse:
    return await product_card_service.sync_card_feed_status(card_id, db)
@router.post("/{card_id}/send-to-nk", response_model=ProductCardResponse)
async def send_card_to_nk(
    card_id: UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ProductCardResponse:
    return await product_card_service.send_card_to_nk(card_id, db)
