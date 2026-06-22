from __future__ import annotations
import base64
from datetime import datetime, timezone
from uuid import UUID
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from models import Device, DocumentUPD
from schemas import DocumentStatus, EdoType, UpdSendRequest
from settings import get_settings
from services import upd_service, xml_generator_service
async def _get_document(document_id: UUID, db: AsyncSession) -> DocumentUPD:
    return await upd_service.get_upd_document(db, document_id)
def _serialize_response(response: httpx.Response) -> dict:
    try:
        return response.json()
    except ValueError:
        return {"raw_text": response.text}
async def _mark_document_as_signed(
    document: DocumentUPD,
    payload: UpdSendRequest,
    db: AsyncSession,
) -> None:
    signature = payload.signature
    document.signature_format = signature.format.value
    document.signature_value = signature.value
    document.signature_thumbprint = signature.thumbprint
    document.signature_metadata = signature.metadata
    document.signed_at = signature.signed_at or datetime.now(timezone.utc)
    document.status = DocumentStatus.SIGNED.value
    await db.flush()
async def _ensure_xml_payload(document: DocumentUPD, db: AsyncSession) -> str:
    if document.xml_draft_content:
        xml_content = document.xml_draft_content
        xml_generator_service.validate_upd_xml(xml_content.encode("utf-8"))
        return xml_content
    xml_bytes = await xml_generator_service.generate_upd_xml(document.id, db)
    xml_content = xml_bytes.decode("utf-8")
    document.xml_draft_content = xml_content
    return xml_content
async def _send_to_edo_lite(document: DocumentUPD, db: AsyncSession) -> DocumentUPD:
    device_result = await db.execute(select(Device).order_by(Device.created_at.desc()))
    device = device_result.scalars().first()
    if device is None:
        raise LookupError("Device settings not found")
    if document.status != DocumentStatus.SIGNED.value:
        raise ValueError("UPD must be signed before sending")
    if not document.signature_value:
        raise ValueError("Signed UPD does not contain signature payload")
    xml_content = await _ensure_xml_payload(document, db)
    file_base64 = base64.b64encode(xml_content.encode("utf-8")).decode("utf-8")
    settings = get_settings()
    payload = {
        "document_id": str(document.id),
        "file_name": f"upd_{document.document_number}.xml",
        "file_base64": file_base64,
        "signature_base64": document.signature_value,
        "signature_format": document.signature_format,
        "signature_thumbprint": document.signature_thumbprint,
        "oms_id": device.oms_id,
        "connection_id": device.connection_id,
    }
    headers: dict[str, str] = {}
    if settings.edo_lite_auth_token:
        headers["Authorization"] = f"Bearer {settings.edo_lite_auth_token}"
    last_error: Exception | None = None
    response: httpx.Response | None = None
    async with httpx.AsyncClient(timeout=settings.edo_lite_timeout_seconds) as client:
        for attempt in range(1, settings.edo_lite_retry_attempts + 1):
            try:
                response = await client.post(settings.edo_lite_send_url, json=payload, headers=headers)
                if response.status_code in {200, 201}:
                    break
                last_error = RuntimeError(
                    f"EDO Lite rejected document [attempt={attempt}] "
                    f"with status {response.status_code}: {response.text}"
                )
            except httpx.HTTPError as exc:
                last_error = RuntimeError(f"EDO Lite request failed [attempt={attempt}]: {exc}")
            if attempt < settings.edo_lite_retry_attempts:
                import asyncio
                await asyncio.sleep(settings.edo_lite_retry_delay_seconds)
    if response is None or response.status_code not in {200, 201}:
        raise RuntimeError(str(last_error) if last_error else "EDO Lite request failed")
    response_payload = _serialize_response(response)
    document.external_response_payload = response_payload
    document.external_message_id = str(
        response_payload.get("document_id")
        or response_payload.get("id")
        or response_payload.get("message_id")
        or document.id
    )
    document.external_status = str(response_payload.get("status") or "accepted")
    document.sent_at = datetime.now(timezone.utc)
    document.status = DocumentStatus.SENT.value
    await db.commit()
    await db.refresh(document)
    return document
async def _send_to_commercial_edo(document: DocumentUPD, db: AsyncSession) -> DocumentUPD:
    if document.status != DocumentStatus.SIGNED.value:
        raise ValueError("UPD must be signed before commercial handoff")
    await _ensure_xml_payload(document, db)
    document.external_status = "awaiting_commercial_handoff"
    document.external_message_id = str(document.id)
    document.external_response_payload = {
        "status": "queued",
        "note": "Commercial EDO handoff is expected to be handled by external integration",
    }
    document.sent_at = datetime.now(timezone.utc)
    document.status = DocumentStatus.SENT.value
    await db.commit()
    await db.refresh(document)
    return document
async def sign_and_send_document(
    document_id: UUID,
    payload: UpdSendRequest,
    db: AsyncSession,
) -> DocumentUPD:
    document = await _get_document(document_id, db)
    await _mark_document_as_signed(document, payload, db)
    if document.edo_type == EdoType.EDO_LITE.value:
        return await _send_to_edo_lite(document, db)
    if document.edo_type == EdoType.COMMERCIAL_EDO.value:
        return await _send_to_commercial_edo(document, db)
    raise ValueError(f"Unsupported EDO type: {document.edo_type}")
