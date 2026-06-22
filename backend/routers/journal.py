"""Журнал операций."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from dependencies import get_current_org, get_current_user
from models import OperationLog, Organization, User
from schemas import JournalListResponse
from services import journal_service

router = APIRouter(prefix="/journal", tags=["journal"])


@router.get("/", response_model=JournalListResponse)
async def list_operations(
    operation_type: str | None = Query(None),
    status: str | None = Query(None),
    gtin: str | None = Query(None),
    search: str | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> JournalListResponse:
    items, total = await journal_service.get_journal(
        db,
        operation_type=operation_type,
        status=status,
        gtin=gtin,
        search=search,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
        org_id=org.id if org else None,
    )
    return JournalListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/export-excel")
async def export_journal(
    operation_type: str | None = Query(None),
    status: str | None = Query(None),
    gtin: str | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """Экспорт журнала в Excel."""
    content = await journal_service.export_journal_excel(
        db,
        operation_type=operation_type,
        status=status,
        gtin=gtin,
        date_from=date_from,
        date_to=date_to,
        org_id=org.id if org else None,
    )
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=journal.xlsx"},
    )


@router.get("/stats")
async def get_stats(
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Статистика операций за последние 30 дней."""
    since = datetime.now(timezone.utc) - timedelta(days=30)
    filters = [OperationLog.created_at >= since]
    if org:
        filters.append(OperationLog.org_id == org.id)
    result = await db.execute(
        select(
            OperationLog.operation_type,
            OperationLog.status,
            func.count().label("count"),
        )
        .where(and_(*filters))
        .group_by(OperationLog.operation_type, OperationLog.status)
    )
    rows = result.all()
    stats: dict[str, dict[str, int]] = {}
    for op_type, op_status, count in rows:
        key = op_type.value if hasattr(op_type, "value") else str(op_type)
        status_key = op_status.value if hasattr(op_status, "value") else str(op_status)
        if key not in stats:
            stats[key] = {"success": 0, "error": 0, "pending": 0}
        stats[key][status_key] = count
    return {"stats": stats, "period_days": 30}
