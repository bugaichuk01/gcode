from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from dependencies import get_current_org, get_current_user
from models import GtinExtraFields, Organization, User
from schemas import (
    GtinExtraFieldsCreate,
    GtinExtraFieldsListResponse,
    GtinExtraFieldsResponse,
    GtinExtraFieldsUpdate,
)

router = APIRouter(prefix="/extra-fields", tags=["extra-fields"])


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
