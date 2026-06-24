from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from database import get_db_session
from dependencies import get_current_org, get_current_user
from models import ExtraFieldsTemplate, GtinExtraFields, Organization, User
from schemas import (
    ExtraFieldsTemplateCreate,
    ExtraFieldsTemplateListItem,
    ExtraFieldsTemplateResponse,
    GtinExtraFieldsBulkRequest,
    GtinExtraFieldsBulkResponse,
    GtinExtraFieldsClearFieldRequest,
    GtinExtraFieldsClearFieldResponse,
    GtinExtraFieldsCreate,
    GtinExtraFieldsImportRequest,
    GtinExtraFieldsImportResponse,
    GtinExtraFieldsListResponse,
    GtinExtraFieldsResponse,
    GtinExtraFieldsUpdate,
)
from services.gtin_utils import normalize_gtin, validate_gtin_length

router = APIRouter(prefix="/extra-fields", tags=["extra-fields"])

CLEARABLE_COLUMNS = frozenset({
    "name",
    "article",
    "size",
    "color",
    "barcode",
    "country",
    "brand",
    "composition",
    "edo_inn",
    "edo_kpp",
    "edo_address",
})


def _merge_extra_json(
    existing: dict | None,
    incoming: dict | None,
) -> dict | None:
    if incoming is None:
        return existing
    merged = dict(existing or {})
    for key, value in incoming.items():
        if value is None or (isinstance(value, str) and not value.strip()):
            merged.pop(key, None)
        else:
            merged[key] = value
    return merged or None


def _apply_extra_fields_upsert(
    record: GtinExtraFields,
    data: GtinExtraFieldsCreate,
) -> None:
    payload = data.model_dump(exclude={"gtin"})
    incoming_extra = payload.pop("extra", None)
    for key, value in payload.items():
        if value is not None:
            setattr(record, key, value)
    if incoming_extra is not None:
        record.extra = _merge_extra_json(record.extra, incoming_extra)


def _is_nonempty_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, dict):
        return len(value) > 0
    return True


def _nonempty_bulk_fields(fields: dict) -> dict:
    """Оставляет только непустые поля для массового применения."""
    result: dict = {}
    incoming_extra = fields.get("extra")
    for key, value in fields.items():
        if key == "extra":
            continue
        if _is_nonempty_value(value):
            result[key] = value.strip() if isinstance(value, str) else value
    if incoming_extra:
        merged_extra = {
            key: value
            for key, value in incoming_extra.items()
            if _is_nonempty_value(value)
        }
        if merged_extra:
            result["extra"] = merged_extra
    return result


def _merge_extra_json_bulk(
    existing: dict | None,
    incoming: dict,
) -> dict | None:
    """Мержит extra только по непустым ключам, не удаляя существующие."""
    merged = dict(existing or {})
    for key, value in incoming.items():
        if _is_nonempty_value(value):
            merged[key] = value
    return merged or None


def _apply_bulk_partial_update(
    record: GtinExtraFields,
    fields: dict,
) -> None:
    incoming_extra = fields.pop("extra", None)
    for key, value in fields.items():
        setattr(record, key, value)
    if incoming_extra is not None:
        record.extra = _merge_extra_json_bulk(record.extra, incoming_extra)


def _extra_fields_org_filter(org: Organization | None):
    if org:
        return GtinExtraFields.org_id == org.id
    return GtinExtraFields.org_id.is_(None)


def _parse_clear_field(field: str) -> tuple[str, str | None]:
    """Возвращает ('column', name) или ('extra', key)."""
    if field.startswith("extra."):
        key = field[len("extra.") :]
        if not key or not key.replace("_", "").isalnum():
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Некорректный extra-ключ: {field}",
            )
        return "extra", key
    if field in CLEARABLE_COLUMNS:
        return "column", field
    raise HTTPException(
        status.HTTP_400_BAD_REQUEST,
        detail=f"Неизвестное поле для очистки: {field}",
    )


def _clear_field_on_record(record: GtinExtraFields, field: str) -> bool:
    """Очищает одно поле; True если запись изменена."""
    kind, name = _parse_clear_field(field)
    if kind == "column":
        assert name is not None
        if getattr(record, name) is None:
            return False
        setattr(record, name, None)
        return True

    assert name is not None
    extra = dict(record.extra or {})
    if name not in extra:
        return False
    extra.pop(name)
    record.extra = extra or None
    return True


def _template_org_filter(org: Organization | None):
    if org:
        return ExtraFieldsTemplate.org_id == org.id
    return ExtraFieldsTemplate.org_id.is_(None)


def _normalize_template_fields(fields: dict) -> dict:
    """Оставляет только непустые поля шаблона (колонки и extra)."""
    return _nonempty_bulk_fields(fields)


@router.get("/templates", response_model=list[ExtraFieldsTemplateListItem])
async def list_extra_fields_templates(
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> list[ExtraFieldsTemplate]:
    q = (
        select(ExtraFieldsTemplate)
        .where(_template_org_filter(org))
        .order_by(ExtraFieldsTemplate.name.asc())
    )
    return list((await db.scalars(q)).all())


@router.post("/templates", response_model=ExtraFieldsTemplateResponse)
async def create_or_update_extra_fields_template(
    data: ExtraFieldsTemplateCreate,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> ExtraFieldsTemplate:
    fields = _normalize_template_fields(data.fields)
    if not fields:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Нет заполненных полей для сохранения в шаблон",
        )

    name = data.name.strip()
    existing = await db.scalar(
        select(ExtraFieldsTemplate).where(
            _template_org_filter(org),
            ExtraFieldsTemplate.name == name,
        )
    )
    if existing:
        existing.fields = fields
        await db.commit()
        await db.refresh(existing)
        return existing

    record = ExtraFieldsTemplate(
        name=name,
        fields=fields,
        org_id=org.id if org else None,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


@router.get("/templates/{template_id}", response_model=ExtraFieldsTemplateResponse)
async def get_extra_fields_template(
    template_id: UUID,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> ExtraFieldsTemplate:
    record = await db.scalar(
        select(ExtraFieldsTemplate).where(
            ExtraFieldsTemplate.id == template_id,
            _template_org_filter(org),
        )
    )
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Шаблон не найден")
    return record


@router.delete("/templates/{template_id}")
async def delete_extra_fields_template(
    template_id: UUID,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    record = await db.scalar(
        select(ExtraFieldsTemplate).where(
            ExtraFieldsTemplate.id == template_id,
            _template_org_filter(org),
        )
    )
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Шаблон не найден")
    await db.delete(record)
    await db.commit()
    return {"success": True}


@router.get("/", response_model=GtinExtraFieldsListResponse)
async def list_extra_fields(
    gtin: str | None = None,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> GtinExtraFieldsListResponse:
    q = select(GtinExtraFields)
    if org:
        q = q.where(GtinExtraFields.org_id == org.id)
    if gtin:
        q = q.where(GtinExtraFields.gtin == gtin)
    q = q.order_by(GtinExtraFields.created_at.desc())
    items = list((await db.scalars(q)).all())
    return GtinExtraFieldsListResponse(items=items, total=len(items))


@router.post("/", response_model=GtinExtraFieldsResponse)
async def create_or_update_extra_fields(
    data: GtinExtraFieldsCreate,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> GtinExtraFields:
    existing = await db.scalar(
        select(GtinExtraFields).where(GtinExtraFields.gtin == data.gtin)
    )
    if existing:
        _apply_extra_fields_upsert(existing, data)
        await db.commit()
        await db.refresh(existing)
        return existing
    record = GtinExtraFields(
        **data.model_dump(),
        org_id=org.id if org else None,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


@router.post("/bulk", response_model=GtinExtraFieldsBulkResponse)
async def bulk_create_or_update_extra_fields(
    data: GtinExtraFieldsBulkRequest,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> GtinExtraFieldsBulkResponse:
    fields = _nonempty_bulk_fields(data.fields.model_dump())
    if not fields:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Нет заполненных полей для применения",
        )

    unique_gtins = list(dict.fromkeys(data.gtins))
    existing_records = list(
        (
            await db.scalars(
                select(GtinExtraFields).where(GtinExtraFields.gtin.in_(unique_gtins))
            )
        ).all()
    )
    existing_by_gtin = {record.gtin: record for record in existing_records}

    created = 0
    updated = 0
    for gtin in unique_gtins:
        existing = existing_by_gtin.get(gtin)
        if existing:
            _apply_bulk_partial_update(existing, dict(fields))
            updated += 1
            continue
        record = GtinExtraFields(
            gtin=gtin,
            org_id=org.id if org else None,
        )
        _apply_bulk_partial_update(record, dict(fields))
        db.add(record)
        created += 1

    await db.commit()
    return GtinExtraFieldsBulkResponse(
        updated=updated,
        created=created,
        total=len(unique_gtins),
    )


@router.post("/clear-field", response_model=GtinExtraFieldsClearFieldResponse)
async def clear_extra_field(
    data: GtinExtraFieldsClearFieldRequest,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> GtinExtraFieldsClearFieldResponse:
    """Явная очистка одного поля у существующих записей (противоположно bulk)."""
    _parse_clear_field(data.field)

    unique_gtins = list(dict.fromkeys(data.gtins))
    existing_records = list(
        (
            await db.scalars(
                select(GtinExtraFields).where(
                    GtinExtraFields.gtin.in_(unique_gtins),
                    _extra_fields_org_filter(org),
                )
            )
        ).all()
    )

    cleared = 0
    for record in existing_records:
        if _clear_field_on_record(record, data.field):
            cleared += 1

    if cleared > 0:
        await db.commit()

    skipped = len(unique_gtins) - len(existing_records) + (len(existing_records) - cleared)
    return GtinExtraFieldsClearFieldResponse(cleared=cleared, skipped=skipped)


@router.post("/import", response_model=GtinExtraFieldsImportResponse)
async def import_extra_fields_rows(
    data: GtinExtraFieldsImportRequest,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> GtinExtraFieldsImportResponse:
    """Импорт строк Excel: семантика bulk — только непустые поля, пустые не затирают."""
    unique_rows: dict[str, dict] = {}
    skipped = 0

    for row in data.rows:
        gtin = normalize_gtin(row.gtin)
        if not gtin or validate_gtin_length(gtin):
            skipped += 1
            continue
        fields = _nonempty_bulk_fields(row.fields.model_dump())
        if not fields:
            skipped += 1
            continue
        unique_rows[gtin] = fields

    if not unique_rows:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Нет строк с корректным GTIN и заполненными полями",
        )

    gtins = list(unique_rows.keys())
    existing_records = list(
        (await db.scalars(select(GtinExtraFields).where(GtinExtraFields.gtin.in_(gtins)))).all()
    )
    existing_by_gtin = {record.gtin: record for record in existing_records}

    created = 0
    updated = 0
    for gtin, fields in unique_rows.items():
        existing = existing_by_gtin.get(gtin)
        if existing:
            _apply_bulk_partial_update(existing, dict(fields))
            updated += 1
            continue
        record = GtinExtraFields(
            gtin=gtin,
            org_id=org.id if org else None,
        )
        _apply_bulk_partial_update(record, dict(fields))
        db.add(record)
        created += 1

    await db.commit()
    return GtinExtraFieldsImportResponse(
        updated=updated,
        created=created,
        total=len(unique_rows),
        skipped=skipped,
    )


@router.patch("/{gtin}", response_model=GtinExtraFieldsResponse)
async def update_extra_fields(
    gtin: str,
    data: GtinExtraFieldsUpdate,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> GtinExtraFields:
    record = await db.scalar(
        select(GtinExtraFields).where(GtinExtraFields.gtin == gtin)
    )
    if not record:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="Доп. поля для GTIN не найдены",
        )
    payload = data.model_dump(exclude_none=True)
    incoming_extra = payload.pop("extra", None)
    for key, value in payload.items():
        setattr(record, key, value)
    if incoming_extra is not None:
        record.extra = _merge_extra_json(record.extra, incoming_extra)
    await db.commit()
    await db.refresh(record)
    return record


@router.delete("/{gtin}")
async def delete_extra_fields(
    gtin: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    record = await db.scalar(
        select(GtinExtraFields).where(GtinExtraFields.gtin == gtin)
    )
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Не найдено")
    await db.delete(record)
    await db.commit()
    return {"success": True}
