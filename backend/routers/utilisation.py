import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from dependencies import get_current_org, get_current_user
from models import Organization, User, UtilisationReport
from schemas import (
    UtilisationBodyPreview,
    UtilisationReportCreate,
    UtilisationReportResponse,
    UtilisationSendRequest,
)
from services import utilisation_service

router = APIRouter(prefix="/utilisation", tags=["utilisation"])


@router.post(
    "/",
    response_model=UtilisationReportResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_report(
    data: UtilisationReportCreate,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> UtilisationReportResponse:
    if not data.marking_codes:
        raise HTTPException(status_code=400, detail="Список кодов не может быть пустым")
    if len(data.marking_codes) > 5000:
        raise HTTPException(status_code=400, detail="Максимум 5000 кодов в одном отчёте")
    return await utilisation_service.create_utilisation_draft(
        data, db, org_id=org.id if org else None
    )


@router.get("/", response_model=list[UtilisationReportResponse])
async def list_reports(
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> list[UtilisationReportResponse]:
    return await utilisation_service.list_utilisation_reports(
        db, org_id=org.id if org else None
    )


@router.delete("/{report_id}", status_code=204)
async def delete_report(
    report_id: UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> None:
    report = await db.get(UtilisationReport, report_id)
    if report is None:
        raise HTTPException(404, "Отчёт не найден")
    await db.delete(report)
    await db.commit()


@router.get("/{report_id}/body", response_model=UtilisationBodyPreview)
async def get_body_for_signing(
    report_id: UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> UtilisationBodyPreview:
    try:
        _report, body_str = await utilisation_service.get_utilisation_body_for_signing(
            report_id, db
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return UtilisationBodyPreview(
        body=body_str,
        body_dict=json.loads(body_str),
    )


@router.post("/{report_id}/send", response_model=UtilisationReportResponse)
async def send_report(
    report_id: UUID,
    payload: UtilisationSendRequest,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> UtilisationReportResponse:
    try:
        return await utilisation_service.send_utilisation_report(
            report_id, payload.signature, db
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
