"""Управление организациями пользователя."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from dependencies import get_current_user
from models import Organization, User

router = APIRouter(prefix="/organizations", tags=["organizations"])


class OrgCreate(BaseModel):
    name: str
    inn: str | None = None
    kpp: str | None = None
    oms_id: str | None = None
    connection_id: str | None = None
    suz_api_url: str | None = None
    true_api_url: str | None = None
    wb_api_key: str | None = None
    ozon_client_id: str | None = None
    ozon_api_key: str | None = None


class OrgResponse(BaseModel):
    id: str
    name: str
    inn: str | None
    kpp: str | None
    oms_id: str | None
    connection_id: str | None
    suz_api_url: str | None
    true_api_url: str | None
    is_active: bool
    created_at: str
    has_wb_key: bool = False
    has_ozon_key: bool = False


def _to_response(org: Organization) -> OrgResponse:
    return OrgResponse(
        id=str(org.id),
        name=org.name,
        inn=org.inn,
        kpp=org.kpp,
        oms_id=org.oms_id,
        connection_id=org.connection_id,
        suz_api_url=org.suz_api_url,
        true_api_url=org.true_api_url,
        is_active=org.is_active,
        created_at=org.created_at.isoformat(),
        has_wb_key=bool(org.wb_api_key),
        has_ozon_key=bool(org.ozon_client_id and org.ozon_api_key),
    )


@router.get("/", response_model=list[OrgResponse])
async def list_orgs(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[OrgResponse]:
    result = await db.scalars(
        select(Organization)
        .where(Organization.user_id == current_user.id)
        .order_by(Organization.created_at)
    )
    return [_to_response(o) for o in result.all()]


@router.post("/", response_model=OrgResponse, status_code=201)
async def create_org(
    data: OrgCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> OrgResponse:
    org = Organization(
        user_id=current_user.id,
        name=data.name,
        inn=data.inn,
        kpp=data.kpp,
        oms_id=data.oms_id,
        connection_id=data.connection_id,
        suz_api_url=data.suz_api_url,
        true_api_url=data.true_api_url,
        wb_api_key=data.wb_api_key,
        ozon_client_id=data.ozon_client_id,
        ozon_api_key=data.ozon_api_key,
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)
    return _to_response(org)


@router.patch("/{org_id}", response_model=OrgResponse)
async def update_org(
    org_id: UUID,
    data: OrgCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> OrgResponse:
    org = await db.get(Organization, org_id)
    if not org or org.user_id != current_user.id:
        raise HTTPException(404, "Организация не найдена")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(org, field, value)
    await db.commit()
    await db.refresh(org)
    return _to_response(org)


@router.delete("/{org_id}", status_code=204)
async def delete_org(
    org_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> None:
    org = await db.get(Organization, org_id)
    if not org or org.user_id != current_user.id:
        raise HTTPException(404, "Организация не найдена")
    await db.delete(org)
    await db.commit()
