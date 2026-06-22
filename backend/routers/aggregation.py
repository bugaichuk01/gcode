"""Эндпоинты агрегации КИТУ."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from dependencies import get_current_org, get_current_user
from models import AggregationDocument, Organization, User
from schemas import (
    AggregationBodyPreview,
    AggregationDocumentCreate,
    AggregationDocumentResponse,
    AggregationSendRequest,
)
from services import aggregation_service
from services.aggregation_service import generate_kitu_code

router = APIRouter(prefix="/aggregation", tags=["aggregation"])


@router.post(
    "/",
    response_model=AggregationDocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_document(
    data: AggregationDocumentCreate,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> AggregationDocumentResponse:
    if not data.marking_codes:
        raise HTTPException(status_code=400, detail="Список кодов пуст")
    if len(data.marking_codes) > 1000:
        raise HTTPException(status_code=400, detail="Максимум 1000 кодов в одной упаковке")
    return await aggregation_service.create_aggregation_draft(
        data, db, org_id=org.id if org else None
    )


@router.get("/", response_model=list[AggregationDocumentResponse])
async def list_documents(
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> list[AggregationDocumentResponse]:
    return await aggregation_service.list_aggregation_documents(
        db, org_id=org.id if org else None
    )


@router.get("/generate-kitu", response_model=dict)
async def get_new_kitu(
    _: User = Depends(get_current_user),
) -> dict:
    """Сгенерировать новый КИТУ/SSCC код."""
    return {"kitu_code": generate_kitu_code()}


@router.get("/{doc_id}/body", response_model=AggregationBodyPreview)
async def get_body_for_signing(
    doc_id: UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AggregationBodyPreview:
    try:
        doc, body_json, body_b64 = await aggregation_service.get_aggregation_body_for_signing(
            doc_id, db
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return AggregationBodyPreview(
        body=body_json,
        body_b64=body_b64,
        kitu_code=doc.kitu_code,
    )


@router.post("/{doc_id}/send", response_model=AggregationDocumentResponse)
async def send_document(
    doc_id: UUID,
    payload: AggregationSendRequest,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AggregationDocumentResponse:
    try:
        return await aggregation_service.send_aggregation_document(
            doc_id, payload.signature, db
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.get("/{doc_id}/disaggregation-body", response_model=AggregationBodyPreview)
async def get_disaggregation_body(
    doc_id: UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AggregationBodyPreview:
    """Тело для подписи расформирования упаковки."""
    try:
        doc, body_json, body_b64 = await aggregation_service.get_disaggregation_body(
            doc_id, db
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return AggregationBodyPreview(
        body=body_json,
        body_b64=body_b64,
        kitu_code=doc.kitu_code,
    )


@router.post("/{doc_id}/disaggregate", response_model=AggregationDocumentResponse)
async def disaggregate(
    doc_id: UUID,
    payload: AggregationSendRequest,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AggregationDocumentResponse:
    """Расформировать упаковку КИТУ."""
    try:
        return await aggregation_service.send_disaggregation(
            doc_id, payload.signature, db
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.delete("/{doc_id}", status_code=204)
async def delete_document(
    doc_id: UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> None:
    doc = await db.get(AggregationDocument, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Документ не найден")
    await db.delete(doc)
    await db.commit()
