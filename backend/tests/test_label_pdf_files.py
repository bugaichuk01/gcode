"""Тесты сохранения и истории PDF этикеток (label_pdf_files)."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from urllib.parse import quote

from models import LabelPdfFile, OperationLog, OperationLogType, Organization

PDF_FILES_URL = "/api/v1/labels/pdf-files"
BATCH_PDF_URL = "/api/v1/labels/pdf/batch"
PREVIEW_PDF_URL = "/api/v1/labels/pdf/preview"
VALID_CODE = (
    "01029000040676422151lSbQXAES&g691FFD092dGVzdDxPl4yc2OOhCoXj6TPcEG6lSKcn9t0Vavgj/d4="
)


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register_token(client, username: str | None = None) -> str:
    name = username or f"user_{uuid.uuid4().hex[:8]}"
    response = await client.post(
        "/api/v1/auth/register",
        json={"username": name, "password": "pass123"},
    )
    assert response.status_code in (200, 201), response.text
    return response.json()["access_token"]


async def _register_with_org(client) -> tuple[str, uuid.UUID]:
    token = await _register_token(client)
    org_resp = await client.post(
        "/api/v1/organizations/",
        json={"name": "Тестовая организация"},
        headers=_auth_headers(token),
    )
    assert org_resp.status_code == 201, org_resp.text
    return token, uuid.UUID(org_resp.json()["id"])


async def _print_batch(client, token: str, codes: list[str] | None = None) -> bytes:
    response = await client.post(
        BATCH_PDF_URL,
        json={"codes": codes or [VALID_CODE], "copies": 1},
        headers=_auth_headers(token),
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")
    return response.content


@pytest.mark.asyncio
async def test_batch_print_saves_pdf_to_db(client, db_session):
    token, org_id = await _register_with_org(client)
    codes = [VALID_CODE, VALID_CODE]

    pdf_bytes = await _print_batch(client, token, codes)

    result = await db_session.execute(
        select(LabelPdfFile).where(LabelPdfFile.org_id == org_id)
    )
    records = list(result.scalars().all())
    assert len(records) == 1
    record = records[0]
    assert record.codes_count == 2
    assert record.pages_count == 2
    assert record.org_id == org_id
    assert bytes(record.data) == pdf_bytes
    assert record.filename.endswith(".pdf")
    assert "2шт_" in record.filename


@pytest.mark.asyncio
async def test_list_pdf_files_returns_metadata(client, db_session):
    token, org_id = await _register_with_org(client)
    await _print_batch(client, token)

    response = await client.get(PDF_FILES_URL, headers=_auth_headers(token))

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    item = data[0]
    assert item["codes_count"] == 1
    assert item["pages_count"] == 1
    assert "filename" in item
    assert "created_at" in item
    assert "id" in item
    assert "data" not in item

    record = await db_session.scalar(
        select(LabelPdfFile).where(LabelPdfFile.org_id == org_id)
    )
    assert record is not None
    assert item["id"] == str(record.id)


@pytest.mark.asyncio
async def test_download_pdf_file_returns_attachment(client, db_session):
    token, org_id = await _register_with_org(client)
    pdf_bytes = await _print_batch(client, token)

    record = await db_session.scalar(
        select(LabelPdfFile).where(LabelPdfFile.org_id == org_id)
    )
    assert record is not None

    response = await client.get(
        f"{PDF_FILES_URL}/{record.id}",
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    assert response.content == pdf_bytes
    assert response.headers["content-type"] == "application/pdf"
    disposition = response.headers.get("content-disposition", "")
    assert "attachment" in disposition
    assert quote(record.filename) in disposition


@pytest.mark.asyncio
async def test_list_pdf_files_org_isolation(client, db_session):
    token_a, org_id_a = await _register_with_org(client)
    await _print_batch(client, token_a)

    token_b, _org_id_b = await _register_with_org(client)
    response_b = await client.get(PDF_FILES_URL, headers=_auth_headers(token_b))
    assert response_b.status_code == 200
    assert response_b.json() == []

    record = await db_session.scalar(
        select(LabelPdfFile).where(LabelPdfFile.org_id == org_id_a)
    )
    assert record is not None

    download_b = await client.get(
        f"{PDF_FILES_URL}/{record.id}",
        headers=_auth_headers(token_b),
    )
    assert download_b.status_code == 404


@pytest.mark.asyncio
async def test_delete_pdf_file_org_scoped(client, db_session):
    token_a, org_id_a = await _register_with_org(client)
    await _print_batch(client, token_a)

    record = await db_session.scalar(
        select(LabelPdfFile).where(LabelPdfFile.org_id == org_id_a)
    )
    assert record is not None

    token_b, _ = await _register_with_org(client)
    delete_b = await client.delete(
        f"{PDF_FILES_URL}/{record.id}",
        headers=_auth_headers(token_b),
    )
    assert delete_b.status_code == 404

    delete_a = await client.delete(
        f"{PDF_FILES_URL}/{record.id}",
        headers=_auth_headers(token_a),
    )
    assert delete_a.status_code == 204

    remaining = await db_session.get(LabelPdfFile, record.id)
    assert remaining is None


@pytest.mark.asyncio
async def test_batch_print_still_returns_inline_pdf(client):
    token, _ = await _register_with_org(client)
    response = await client.post(
        BATCH_PDF_URL,
        json={"codes": [VALID_CODE], "copies": 1},
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    assert response.content.startswith(b"%PDF")
    disposition = response.headers.get("content-disposition", "")
    assert "inline" in disposition


@pytest.mark.asyncio
async def test_list_pdf_files_empty_for_user_without_org(client):
    token = await _register_token(client)
    response = await client.get(PDF_FILES_URL, headers=_auth_headers(token))
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_preview_does_not_save_pdf_or_log_print(client, db_session):
    token, org_id = await _register_with_org(client)

    response = await client.post(
        PREVIEW_PDF_URL,
        json={"code": VALID_CODE},
        headers=_auth_headers(token),
    )

    assert response.status_code == 200, response.text
    assert response.content.startswith(b"%PDF")
    assert response.headers["content-type"] == "application/pdf"

    pdf_records = await db_session.execute(
        select(LabelPdfFile).where(LabelPdfFile.org_id == org_id)
    )
    assert list(pdf_records.scalars().all()) == []

    log_records = await db_session.execute(
        select(OperationLog).where(
            OperationLog.org_id == org_id,
            OperationLog.operation_type == OperationLogType.LABEL_PRINTED,
        )
    )
    assert list(log_records.scalars().all()) == []


@pytest.mark.asyncio
async def test_batch_with_save_false_does_not_persist(client, db_session):
    token, org_id = await _register_with_org(client)

    response = await client.post(
        BATCH_PDF_URL,
        json={"codes": [VALID_CODE], "copies": 1, "save": False},
        headers=_auth_headers(token),
    )

    assert response.status_code == 200, response.text
    assert response.content.startswith(b"%PDF")

    pdf_records = await db_session.execute(
        select(LabelPdfFile).where(LabelPdfFile.org_id == org_id)
    )
    assert list(pdf_records.scalars().all()) == []

    log_records = await db_session.execute(
        select(OperationLog).where(
            OperationLog.org_id == org_id,
            OperationLog.operation_type == OperationLogType.LABEL_PRINTED,
        )
    )
    assert list(log_records.scalars().all()) == []
