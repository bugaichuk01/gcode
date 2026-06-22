"""Приёмка входящих УПД."""
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from lxml import etree
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from dependencies import get_current_org, get_current_user
from models import IncomingUPD, IncomingUPDStatus, Organization, User

router = APIRouter(prefix="/incoming-upd", tags=["incoming-upd"])


class IncomingUPDCreate(BaseModel):
    document_number: str
    document_date: str | None = None
    seller_inn: str | None = None
    seller_name: str | None = None
    document_codes: list[str]


class IncomingUPDResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    document_number: str
    document_date: str | None
    seller_inn: str | None
    seller_name: str | None
    document_codes: list[str]
    scanned_codes: list[str]
    extra_codes: list[str]
    missing_codes: list[str]
    duplicate_codes: list[str]
    status: str
    created_at: str


class ScanRequest(BaseModel):
    scanned_codes: list[str]


def _to_response(doc: IncomingUPD) -> IncomingUPDResponse:
    status_value = doc.status.value if hasattr(doc.status, "value") else str(doc.status)
    return IncomingUPDResponse(
        id=doc.id,
        document_number=doc.document_number,
        document_date=doc.document_date,
        seller_inn=doc.seller_inn,
        seller_name=doc.seller_name,
        document_codes=doc.document_codes or [],
        scanned_codes=doc.scanned_codes or [],
        extra_codes=doc.extra_codes or [],
        missing_codes=doc.missing_codes or [],
        duplicate_codes=doc.duplicate_codes or [],
        status=status_value,
        created_at=doc.created_at.isoformat(),
    )


@router.post("/", response_model=IncomingUPDResponse, status_code=status.HTTP_201_CREATED)
async def create_incoming_upd(
    data: IncomingUPDCreate,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> IncomingUPDResponse:
    """Создать запись входящего УПД."""
    doc = IncomingUPD(
        document_number=data.document_number,
        document_date=data.document_date,
        seller_inn=data.seller_inn,
        seller_name=data.seller_name,
        document_codes=data.document_codes,
        org_id=org.id if org else None,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return _to_response(doc)


@router.post("/parse-xml", response_model=IncomingUPDCreate)
async def parse_incoming_xml(
    file: UploadFile = File(...),
    _: User = Depends(get_current_user),
) -> IncomingUPDCreate:
    """Разобрать XML УПД и извлечь коды."""
    content = await file.read()
    try:
        root = etree.fromstring(content)
    except etree.XMLSyntaxError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неверный формат XML",
        ) from e

    doc_num = root.get("НомерДок") or root.get("НомерСчФ") or "Неизвестно"
    doc_date = root.get("ДатаДок") or ""

    seller_inn = None
    seller_name = None
    for elem in root.iter():
        inn = elem.get("ИННЮЛ") or elem.get("ИННФЛ")
        if inn and not seller_inn:
            seller_inn = inn
            seller_name = elem.get("НаимОрг", "")
            break

    codes: list[str] = []
    for elem in root.iter():
        code = elem.get("КодМаркировки") or elem.get("cis") or elem.text
        if code and isinstance(code, str) and len(code) > 20:
            normalized = code.strip()
            normalized = normalized.replace("\\x1d", "\x1d").replace("\\u001d", "\x1d")
            if normalized.startswith("01") and len(normalized) >= 20:
                codes.append(normalized)

    return IncomingUPDCreate(
        document_number=doc_num,
        document_date=doc_date,
        seller_inn=seller_inn,
        seller_name=seller_name,
        document_codes=list(set(codes)),
    )


@router.get("/", response_model=list[IncomingUPDResponse])
async def list_incoming_upds(
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> list[IncomingUPDResponse]:
    q = select(IncomingUPD)
    if org:
        q = q.where(IncomingUPD.org_id == org.id)
    result = await db.scalars(q.order_by(IncomingUPD.created_at.desc()))
    return [_to_response(doc) for doc in result.all()]


@router.post("/{doc_id}/scan", response_model=IncomingUPDResponse)
async def submit_scan_results(
    doc_id: UUID,
    data: ScanRequest,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> IncomingUPDResponse:
    """Загрузить результаты сканирования и сверить с документом."""
    doc = await db.get(IncomingUPD, doc_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="УПД не найден")

    doc_set = set(doc.document_codes)
    scanned_set = set(data.scanned_codes)

    duplicates = [code for code in data.scanned_codes if data.scanned_codes.count(code) > 1]

    doc.scanned_codes = data.scanned_codes
    doc.extra_codes = list(scanned_set - doc_set)
    doc.missing_codes = list(doc_set - scanned_set)
    doc.duplicate_codes = list(set(duplicates))
    doc.status = IncomingUPDStatus.CHECKED

    await db.commit()
    await db.refresh(doc)
    return _to_response(doc)


@router.post("/{doc_id}/accept")
async def accept_upd(
    doc_id: UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Принять УПД (с расхождениями или без)."""
    doc = await db.get(IncomingUPD, doc_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="УПД не найден")
    doc.status = IncomingUPDStatus.ACCEPTED
    await db.commit()
    return {"success": True}


@router.post("/{doc_id}/reject")
async def reject_upd(
    doc_id: UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Отклонить УПД."""
    doc = await db.get(IncomingUPD, doc_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="УПД не найден")
    doc.status = IncomingUPDStatus.REJECTED
    await db.commit()
    return {"success": True}


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_upd(
    doc_id: UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> None:
    doc = await db.get(IncomingUPD, doc_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="УПД не найден")
    await db.delete(doc)
    await db.commit()
