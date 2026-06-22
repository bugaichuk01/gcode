"""Эндпоинты возврата КМ в оборот."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from dependencies import get_current_org, get_current_user
from models import Organization, ReturnDocument, User
from schemas import (
    ReturnBodyPreview,
    ReturnDocumentCreate,
    ReturnDocumentResponse,
    ReturnSendRequest,
)
from services import return_service

router = APIRouter(prefix="/returns", tags=["returns"])


@router.post(
    "/",
    response_model=ReturnDocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_document(
    data: ReturnDocumentCreate,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> ReturnDocumentResponse:
    if not data.marking_codes:
        raise HTTPException(status_code=400, detail="Список кодов пуст")
    if len(data.marking_codes) > 5000:
        raise HTTPException(status_code=400, detail="Максимум 5000 кодов")
    return await return_service.create_return_draft(
        data, db, org_id=org.id if org else None
    )


@router.get("/", response_model=list[ReturnDocumentResponse])
async def list_documents(
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> list[ReturnDocumentResponse]:
    return await return_service.list_return_documents(
        db, org_id=org.id if org else None
    )


@router.get("/{doc_id}/body", response_model=ReturnBodyPreview)
async def get_body(
    doc_id: UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ReturnBodyPreview:
    try:
        _, body_json, body_b64 = await return_service.get_return_body_for_signing(doc_id, db)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return ReturnBodyPreview(body=body_json, body_b64=body_b64)


@router.post("/{doc_id}/send", response_model=ReturnDocumentResponse)
async def send_document(
    doc_id: UUID,
    payload: ReturnSendRequest,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ReturnDocumentResponse:
    try:
        return await return_service.send_return_document(doc_id, payload.signature, db)
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
    doc = await db.get(ReturnDocument, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Документ не найден")
    await db.delete(doc)
    await db.commit()
