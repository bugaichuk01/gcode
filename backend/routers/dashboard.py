"""Дашборд пользователя."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from dependencies import get_current_org, get_current_user
from models import (
    AggregationDocument,
    EmissionOrder,
    EmissionOrderStatus,
    OperationLog,
    Organization,
    ProductCard,
    SuzToken,
    User,
    WithdrawalReport,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/")
async def get_dashboard(
    current_user: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Дашборд текущего пользователя."""
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    org_id = org.id if org else None

    def org_filter(model):
        if org_id:
            return model.org_id == org_id
        return model.org_id.is_(None)

    # === КОДЫ МАРКИРОВКИ ===
    total_orders = await db.scalar(
        select(func.count()).select_from(EmissionOrder).where(org_filter(EmissionOrder))
    ) or 0

    orders = await db.scalars(
        select(EmissionOrder).where(org_filter(EmissionOrder))
    )
    total_codes = sum(len(o.suz_marking_codes) for o in orders.all())

    active_orders = await db.scalar(
        select(func.count())
        .select_from(EmissionOrder)
        .where(
            and_(
                org_filter(EmissionOrder),
                EmissionOrder.status.in_(
                    [
                        EmissionOrderStatus.AVAILABLE,
                        EmissionOrderStatus.PENDING,
                    ]
                ),
            )
        )
    ) or 0

    # === ВЫВОДЫ ИЗ ОБОРОТА ===
    total_withdrawals = await db.scalar(
        select(func.count())
        .select_from(WithdrawalReport)
        .where(org_filter(WithdrawalReport))
    ) or 0

    withdrawals_month = await db.scalar(
        select(func.count())
        .select_from(WithdrawalReport)
        .where(
            and_(
                org_filter(WithdrawalReport),
                WithdrawalReport.created_at >= month_ago,
                WithdrawalReport.status == "accepted",
            )
        )
    ) or 0

    # === КАРТОЧКИ НК ===
    total_cards = await db.scalar(
        select(func.count()).select_from(ProductCard).where(org_filter(ProductCard))
    ) or 0

    published_cards = await db.scalar(
        select(func.count())
        .select_from(ProductCard)
        .where(
            and_(
                org_filter(ProductCard),
                ProductCard.status == "published",
            )
        )
    ) or 0

    # === АГРЕГАЦИЯ ===
    total_kitu = await db.scalar(
        select(func.count())
        .select_from(AggregationDocument)
        .where(
            and_(
                org_filter(AggregationDocument),
                AggregationDocument.status == "accepted",
            )
        )
    ) or 0

    # === ОПЕРАЦИИ ===
    ops_today = await db.scalar(
        select(func.count())
        .select_from(OperationLog)
        .where(
            and_(
                org_filter(OperationLog),
                OperationLog.created_at >= today,
            )
        )
    ) or 0

    ops_week = await db.scalar(
        select(func.count())
        .select_from(OperationLog)
        .where(
            and_(
                org_filter(OperationLog),
                OperationLog.created_at >= week_ago,
            )
        )
    ) or 0

    errors_week = await db.scalar(
        select(func.count())
        .select_from(OperationLog)
        .where(
            and_(
                org_filter(OperationLog),
                OperationLog.created_at >= week_ago,
                OperationLog.status == "error",
            )
        )
    ) or 0

    # === ПОСЛЕДНИЕ ОПЕРАЦИИ ===
    recent_ops = await db.scalars(
        select(OperationLog)
        .where(org_filter(OperationLog))
        .order_by(OperationLog.created_at.desc())
        .limit(8)
    )

    # === АКТИВНОСТЬ ЗА 7 ДНЕЙ ===
    activity = []
    for i in range(6, -1, -1):
        day_start = today - timedelta(days=i)
        day_end = day_start + timedelta(days=1)
        count = await db.scalar(
            select(func.count())
            .select_from(OperationLog)
            .where(
                and_(
                    org_filter(OperationLog),
                    OperationLog.created_at >= day_start,
                    OperationLog.created_at < day_end,
                )
            )
        ) or 0
        activity.append(
            {
                "date": day_start.strftime("%d.%m"),
                "day": day_start.strftime("%a"),
                "count": count,
            }
        )

    # === ТОКЕН ===
    token_info = None
    token = await db.scalar(
        select(SuzToken)
        .where(SuzToken.org_id == org_id if org_id else SuzToken.org_id.is_(None))
        .order_by(SuzToken.updated_at.desc())
        .limit(1)
    )
    if token:
        suz_mins = None
        if token.expires_at:
            delta = token.expires_at - now
            suz_mins = int(delta.total_seconds() / 60)
        true_mins = None
        if token.true_api_expires_at:
            delta = token.true_api_expires_at - now
            true_mins = int(delta.total_seconds() / 60)
        token_info = {
            "suz_expires_in_minutes": suz_mins,
            "suz_is_expiring": suz_mins is not None and suz_mins < 60,
            "true_api_expires_in_minutes": true_mins,
            "true_api_is_expiring": true_mins is not None and true_mins < 60,
            "updated_at": token.updated_at.isoformat() if token.updated_at else None,
        }

    # === ОРГАНИЗАЦИЯ ===
    org_info = None
    if org:
        org_info = {
            "id": str(org.id),
            "name": org.name,
            "inn": org.inn,
            "oms_id": org.oms_id,
        }

    # === НЕЗАКРЫТЫЕ ЗАКАЗЫ ===
    pending_orders = await db.scalars(
        select(EmissionOrder)
        .where(
            and_(
                org_filter(EmissionOrder),
                EmissionOrder.status.in_(
                    [
                        EmissionOrderStatus.AVAILABLE,
                        EmissionOrderStatus.PENDING,
                        EmissionOrderStatus.CREATED,
                    ]
                ),
            )
        )
        .order_by(EmissionOrder.created_at.desc())
        .limit(5)
    )

    user_role = (
        current_user.role.value
        if hasattr(current_user.role, "value")
        else str(current_user.role)
    )

    return {
        "user": {
            "username": current_user.username,
            "role": user_role,
        },
        "organization": org_info,
        "codes": {
            "total_orders": total_orders,
            "total_codes": total_codes,
            "active_orders": active_orders,
        },
        "withdrawals": {
            "total": total_withdrawals,
            "month": withdrawals_month,
        },
        "cards": {
            "total": total_cards,
            "published": published_cards,
        },
        "kitu": {
            "total_active": total_kitu,
        },
        "operations": {
            "today": ops_today,
            "week": ops_week,
            "errors_week": errors_week,
        },
        "activity_chart": activity,
        "recent_operations": [
            {
                "id": str(op.id),
                "type": op.operation_type.value
                if hasattr(op.operation_type, "value")
                else str(op.operation_type),
                "status": op.status.value
                if hasattr(op.status, "value")
                else str(op.status),
                "description": op.description,
                "codes_count": op.codes_count,
                "created_at": op.created_at.isoformat(),
            }
            for op in recent_ops.all()
        ],
        "token": token_info,
        "pending_orders": [
            {
                "id": str(o.id),
                "gtin": o.gtin,
                "quantity": o.quantity,
                "status": o.status.value if hasattr(o.status, "value") else str(o.status),
                "created_at": o.created_at.isoformat(),
            }
            for o in pending_orders.all()
        ],
    }
