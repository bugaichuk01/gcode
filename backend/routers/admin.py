"""Административная панель."""
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from database import get_db_session
from dependencies import require_admin
from models import (
    AggregationDocument,
    DocumentUPD,
    EmissionOrder,
    OperationLog,
    Organization,
    ReturnDocument,
    SuzToken,
    User,
    UserRole,
    UserStatus,
    UtilisationReport,
    WithdrawalReport,
)
from services.auth_service import get_password_hash, get_user_by_username

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/dashboard")
async def get_dashboard(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Главный дашборд с общей статистикой."""
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    total_users = await db.scalar(select(func.count()).select_from(User)) or 0
    active_users = (
        await db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.status == UserStatus.ACTIVE)
        )
        or 0
    )
    blocked_users = total_users - active_users
    new_users_week = (
        await db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.created_at >= week_ago)
        )
        or 0
    )

    total_orgs = (
        await db.scalar(select(func.count()).select_from(Organization)) or 0
    )
    active_orgs = (
        await db.scalar(
            select(func.count())
            .select_from(Organization)
            .where(Organization.is_active == True)
        )
        or 0
    )

    ops_today = (
        await db.scalar(
            select(func.count())
            .select_from(OperationLog)
            .where(OperationLog.created_at >= today)
        )
        or 0
    )
    ops_week = (
        await db.scalar(
            select(func.count())
            .select_from(OperationLog)
            .where(OperationLog.created_at >= week_ago)
        )
        or 0
    )
    ops_month = (
        await db.scalar(
            select(func.count())
            .select_from(OperationLog)
            .where(OperationLog.created_at >= month_ago)
        )
        or 0
    )
    errors_today = (
        await db.scalar(
            select(func.count())
            .select_from(OperationLog)
            .where(
                and_(
                    OperationLog.created_at >= today,
                    OperationLog.status == "error",
                )
            )
        )
        or 0
    )

    total_codes = (
        await db.scalar(select(func.count()).select_from(EmissionOrder)) or 0
    )
    withdrawals = (
        await db.scalar(
            select(func.count())
            .select_from(WithdrawalReport)
            .where(WithdrawalReport.status == "accepted")
        )
        or 0
    )

    activity = []
    for i in range(6, -1, -1):
        day_start = today - timedelta(days=i)
        day_end = day_start + timedelta(days=1)
        count = (
            await db.scalar(
                select(func.count())
                .select_from(OperationLog)
                .where(
                    and_(
                        OperationLog.created_at >= day_start,
                        OperationLog.created_at < day_end,
                    )
                )
            )
            or 0
        )
        activity.append({"date": day_start.strftime("%d.%m"), "count": count})

    top_ops_result = await db.execute(
        select(OperationLog.operation_type, func.count().label("cnt"))
        .where(OperationLog.created_at >= month_ago)
        .group_by(OperationLog.operation_type)
        .order_by(func.count().desc())
        .limit(5)
    )
    top_ops = [{"type": row[0], "count": row[1]} for row in top_ops_result.all()]

    recent_errors_result = await db.scalars(
        select(OperationLog)
        .where(OperationLog.status == "error")
        .order_by(OperationLog.created_at.desc())
        .limit(5)
    )
    recent_errors = [
        {
            "id": str(e.id),
            "operation_type": e.operation_type,
            "error_message": e.error_message,
            "created_at": e.created_at.isoformat(),
        }
        for e in recent_errors_result.all()
    ]

    return {
        "users": {
            "total": total_users,
            "active": active_users,
            "blocked": blocked_users,
            "new_week": new_users_week,
        },
        "organizations": {"total": total_orgs, "active": active_orgs},
        "operations": {
            "today": ops_today,
            "week": ops_week,
            "month": ops_month,
            "errors_today": errors_today,
        },
        "codes": {
            "total_orders": total_codes,
            "withdrawals_accepted": withdrawals,
        },
        "activity_chart": activity,
        "top_operations": top_ops,
        "recent_errors": recent_errors,
    }


@router.get("/users")
async def list_users(
    search: str | None = Query(None),
    role: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    filters = []
    if search:
        filters.append(
            or_(
                User.username.ilike(f"%{search}%"),
                User.email.ilike(f"%{search}%"),
            )
        )
    if role:
        filters.append(User.role == role)
    if status:
        filters.append(User.status == status)

    base_q = select(User)
    if filters:
        base_q = base_q.where(and_(*filters))

    total = (
        await db.scalar(select(func.count()).select_from(base_q.subquery())) or 0
    )
    users = await db.scalars(
        base_q.order_by(User.created_at.desc()).limit(limit).offset(offset)
    )

    result = []
    for u in users.all():
        org_count = (
            await db.scalar(
                select(func.count())
                .select_from(Organization)
                .where(Organization.user_id == u.id)
            )
            or 0
        )
        result.append(
            {
                "id": str(u.id),
                "username": u.username,
                "email": u.email,
                "role": u.role,
                "status": u.status,
                "org_count": org_count,
                "last_login_at": u.last_login_at.isoformat()
                if u.last_login_at
                else None,
                "created_at": u.created_at.isoformat(),
            }
        )

    return {"items": result, "total": total, "limit": limit, "offset": offset}


@router.get("/users/{user_id}")
async def get_user_detail(
    user_id: UUID,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")

    orgs = await db.scalars(
        select(Organization).where(Organization.user_id == user_id)
    )

    org_ids_subq = select(Organization.id).where(Organization.user_id == user_id)
    ops_count = (
        await db.scalar(
            select(func.count())
            .select_from(OperationLog)
            .where(OperationLog.org_id.in_(org_ids_subq))
        )
        or 0
    )

    recent_ops = await db.scalars(
        select(OperationLog)
        .order_by(OperationLog.created_at.desc())
        .limit(10)
    )

    return {
        "id": str(user.id),
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "status": user.status,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        "created_at": user.created_at.isoformat(),
        "organizations": [
            {
                "id": str(o.id),
                "name": o.name,
                "inn": o.inn,
                "oms_id": o.oms_id,
                "is_active": o.is_active,
            }
            for o in orgs.all()
        ],
        "total_operations": ops_count,
        "recent_operations": [
            {
                "id": str(op.id),
                "type": op.operation_type,
                "status": op.status,
                "description": op.description,
                "created_at": op.created_at.isoformat(),
            }
            for op in recent_ops.all()
        ],
    }


class AdminUserCreate(BaseModel):
    username: str
    password: str
    email: str | None = None
    role: str = "user"


@router.post("/users", status_code=201)
async def admin_create_user(
    data: AdminUserCreate,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    existing = await get_user_by_username(db, data.username)
    if existing:
        raise HTTPException(409, "Пользователь уже существует")

    user = User(
        username=data.username,
        email=data.email,
        hashed_password=get_password_hash(data.password),
        role=data.role,
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    await db.commit()
    return {"id": str(user.id), "username": user.username}


@router.patch("/users/{user_id}/status")
async def change_user_status(
    user_id: UUID,
    data: dict,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    if str(user_id) == str(admin.id):
        raise HTTPException(400, "Нельзя изменить статус своего аккаунта")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    new_status = data.get("status")
    if new_status not in ("active", "blocked"):
        raise HTTPException(400, "Неверный статус")
    user.status = new_status
    await db.commit()
    return {"success": True, "status": new_status}


@router.patch("/users/{user_id}/role")
async def change_user_role(
    user_id: UUID,
    data: dict,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    if str(user_id) == str(admin.id):
        raise HTTPException(400, "Нельзя изменить роль своего аккаунта")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    new_role = data.get("role")
    if new_role not in ("admin", "user"):
        raise HTTPException(400, "Неверная роль")
    user.role = new_role
    await db.commit()
    return {"success": True, "role": new_role}


@router.post("/users/{user_id}/reset-password")
async def admin_reset_password(
    user_id: UUID,
    data: dict,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    new_password = data.get("new_password", "")
    if len(new_password) < 6:
        raise HTTPException(400, "Пароль должен быть минимум 6 символов")
    user.hashed_password = get_password_hash(new_password)
    await db.commit()
    return {"success": True}


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> None:
    if str(user_id) == str(admin.id):
        raise HTTPException(400, "Нельзя удалить свой аккаунт")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    await db.delete(user)
    await db.commit()


@router.get("/organizations")
async def list_all_orgs(
    search: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    query = select(Organization).options(joinedload(Organization.user))
    if search:
        query = query.where(
            or_(
                Organization.name.ilike(f"%{search}%"),
                Organization.inn.ilike(f"%{search}%"),
            )
        )

    total = (
        await db.scalar(select(func.count()).select_from(Organization)) or 0
    )
    orgs = await db.scalars(
        query.order_by(Organization.created_at.desc()).limit(limit).offset(offset)
    )

    return {
        "items": [
            {
                "id": str(o.id),
                "name": o.name,
                "inn": o.inn,
                "oms_id": o.oms_id,
                "is_active": o.is_active,
                "owner_username": o.user.username if o.user else None,
                "owner_id": str(o.user_id),
                "created_at": o.created_at.isoformat(),
            }
            for o in orgs.all()
        ],
        "total": total,
    }


@router.patch("/organizations/{org_id}/status")
async def toggle_org_status(
    org_id: UUID,
    data: dict,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    org = await db.get(Organization, org_id)
    if not org:
        raise HTTPException(404, "Организация не найдена")
    org.is_active = data.get("is_active", True)
    await db.commit()
    return {"success": True, "is_active": org.is_active}


@router.get("/journal")
async def admin_journal(
    user_id: UUID | None = Query(None),
    operation_type: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Журнал всех операций всех пользователей."""
    filters = []
    if operation_type:
        filters.append(OperationLog.operation_type == operation_type)
    if status:
        filters.append(OperationLog.status == status)
    if user_id:
        org_ids = await db.scalars(
            select(Organization.id).where(Organization.user_id == user_id)
        )
        filters.append(OperationLog.org_id.in_(list(org_ids.all())))

    base_q = select(OperationLog)
    if filters:
        base_q = base_q.where(and_(*filters))

    total = (
        await db.scalar(select(func.count()).select_from(base_q.subquery())) or 0
    )
    items = await db.scalars(
        base_q.order_by(OperationLog.created_at.desc())
        .limit(limit)
        .offset(offset)
    )

    return {
        "items": [
            {
                "id": str(op.id),
                "operation_type": op.operation_type,
                "status": op.status,
                "description": op.description,
                "codes_count": op.codes_count,
                "gtin": op.gtin,
                "error_message": op.error_message,
                "org_id": str(op.org_id) if op.org_id else None,
                "created_at": op.created_at.isoformat(),
            }
            for op in items.all()
        ],
        "total": total,
    }


@router.get("/tokens")
async def list_all_tokens(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    """Статус токенов всех организаций."""
    now = datetime.now(timezone.utc)
    tokens = await db.scalars(
        select(SuzToken).order_by(SuzToken.updated_at.desc())
    )
    result = []
    for t in tokens.all():
        suz_expires_in = None
        if t.expires_at:
            delta = t.expires_at - now
            suz_expires_in = int(delta.total_seconds() / 60)

        true_expires_in = None
        if t.true_api_expires_at:
            delta = t.true_api_expires_at - now
            true_expires_in = int(delta.total_seconds() / 60)

        result.append(
            {
                "id": str(t.id),
                "org_id": str(t.org_id) if t.org_id else None,
                "oms_connection_id": t.oms_connection_id,
                "suz_token_preview": t.token[:8] + "..." if t.token else None,
                "suz_expires_in_minutes": suz_expires_in,
                "suz_is_expired": suz_expires_in is not None and suz_expires_in <= 0,
                "true_api_configured": bool(t.true_api_token),
                "true_api_expires_in_minutes": true_expires_in,
                "updated_at": t.updated_at.isoformat() if t.updated_at else None,
            }
        )
    return result
