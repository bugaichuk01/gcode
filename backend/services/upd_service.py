from __future__ import annotations
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from models import DocumentUPD
from schemas import DocumentStatus, UpdCreateRequest
async def create_upd_draft(
    session: AsyncSession,
    data: UpdCreateRequest,
    org_id: UUID | None = None,
) -> DocumentUPD:
    doc = DocumentUPD(
        document_number=data.document_number.strip(),
        marking_codes=list(data.marking_codes),
        disable_owner_control=data.disable_owner_control,
        edo_type=data.edo_type.value,
        status=DocumentStatus.DRAFT.value,
        xml_draft_content=None,
        seller_inn=data.seller_inn,
        seller_kpp=data.seller_kpp,
        seller_name=data.seller_name,
        seller_address=data.seller_address,
        buyer_inn=data.buyer_inn,
        buyer_kpp=data.buyer_kpp,
        buyer_name=data.buyer_name,
        buyer_address=data.buyer_address,
        org_id=org_id,
    )
    session.add(doc)
    await session.commit()
    await session.refresh(doc)
    return doc
async def get_upd_document(session: AsyncSession, document_id: UUID) -> DocumentUPD:
    result = await session.execute(select(DocumentUPD).where(DocumentUPD.id == document_id))
    document = result.scalar_one_or_none()
    if document is None:
        raise LookupError("UPD document not found")
    return document
