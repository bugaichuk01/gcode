"""Тесты разбивки PDF этикеток на части и сквозной нумерации."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from labels.pdf_service import build_print_context, iter_label_chunks
from models import LabelPdfFile, LabelTemplate, Organization

PDF_FILES_URL = "/api/v1/labels/pdf-files"
BATCH_PDF_URL = "/api/v1/labels/pdf/batch"
FROM_TEMPLATE_URL = "/api/v1/labels/pdf/from-template"
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


def _pdf_contains_text(pdf_bytes: bytes, text: str) -> bool:
    return text.encode("ascii", errors="ignore") in pdf_bytes or text in pdf_bytes.decode(
        "latin-1", errors="ignore"
    )


def test_iter_label_chunks_splits_correctly():
    assert iter_label_chunks(250, 100) == [(0, 100), (100, 200), (200, 250)]
    assert iter_label_chunks(50, 100) == [(0, 50)]
    assert iter_label_chunks(100, 100) == [(0, 100)]


def test_build_print_context_continuous_numbering():
    ctx = build_print_context(
        global_index=150,
        chunk_start=100,
        chunk_len=100,
        total_pages=250,
        start_number=1,
        continuous_numbering=True,
    )
    assert ctx.label_index == 150
    assert ctx.label_number == 151
    assert ctx.total == 250


def test_build_print_context_local_numbering():
    ctx = build_print_context(
        global_index=150,
        chunk_start=100,
        chunk_len=100,
        total_pages=250,
        start_number=1,
        continuous_numbering=False,
    )
    assert ctx.label_index == 50
    assert ctx.label_number == 51
    assert ctx.total == 100


@pytest.mark.asyncio
async def test_split_250_labels_creates_three_files(client, db_session):
    token, org_id = await _register_with_org(client)
    codes = [VALID_CODE] * 250

    response = await client.post(
        BATCH_PDF_URL,
        json={
            "codes": codes,
            "copies": 1,
            "split_files": True,
            "pages_per_file": 100,
        },
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    data = response.json()
    assert len(data["files"]) == 3
    assert [item["pages_count"] for item in data["files"]] == [100, 100, 50]
    for item in data["files"]:
        assert "_часть" in item["filename"]

    records = list(
        (
            await db_session.execute(
                select(LabelPdfFile)
                .where(LabelPdfFile.org_id == org_id)
                .order_by(LabelPdfFile.created_at.asc())
            )
        ).scalars()
    )
    assert len(records) == 3
    assert [r.pages_count for r in records] == [100, 100, 50]


@pytest.mark.asyncio
async def test_split_pages_per_file_larger_than_total_creates_one_file(client, db_session):
    token, org_id = await _register_with_org(client)

    response = await client.post(
        BATCH_PDF_URL,
        json={
            "codes": [VALID_CODE] * 5,
            "copies": 1,
            "split_files": True,
            "pages_per_file": 100,
        },
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data["files"]) == 1
    assert data["files"][0]["pages_count"] == 5
    assert "_часть" not in data["files"][0]["filename"]

    count = await db_session.scalar(
        select(LabelPdfFile).where(LabelPdfFile.org_id == org_id)
    )
    assert count is not None


@pytest.mark.asyncio
async def test_split_false_still_returns_inline_pdf(client):
    token, _ = await _register_with_org(client)

    response = await client.post(
        BATCH_PDF_URL,
        json={
            "codes": [VALID_CODE],
            "copies": 1,
            "split_files": False,
        },
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")
    assert "inline" in response.headers.get("content-disposition", "")


@pytest.mark.asyncio
async def test_continuous_numbering_across_split_files(client, db_session):
    token, org_id = await _register_with_org(client)
    org = await db_session.get(Organization, org_id)
    assert org is not None

    template = LabelTemplate(
        name="Нумерация",
        width_mm=58,
        height_mm=40,
        layout_data={
            "elements": [
                {
                    "type": "field",
                    "field_key": "label_number",
                    "x": 2,
                    "y": 2,
                    "font_size": 12,
                }
            ]
        },
        org_id=org.id,
    )
    db_session.add(template)
    await db_session.commit()
    await db_session.refresh(template)

    response = await client.post(
        FROM_TEMPLATE_URL,
        json={
            "template_id": str(template.id),
            "codes": [VALID_CODE] * 5,
            "copies": 1,
            "split_files": True,
            "pages_per_file": 2,
            "continuous_numbering": True,
            "start_number": 1,
        },
        headers=_auth_headers(token),
    )
    assert response.status_code == 200
    files = response.json()["files"]
    assert len(files) == 3

    records = list(
        (
            await db_session.execute(
                select(LabelPdfFile)
                .where(LabelPdfFile.org_id == org_id)
                .order_by(LabelPdfFile.created_at.asc())
            )
        ).scalars()
    )
    assert _pdf_contains_text(bytes(records[0].data), "1")
    assert _pdf_contains_text(bytes(records[0].data), "2")
    assert _pdf_contains_text(bytes(records[1].data), "3")
    assert _pdf_contains_text(bytes(records[1].data), "4")
    assert _pdf_contains_text(bytes(records[2].data), "5")


@pytest.mark.asyncio
async def test_local_numbering_restarts_each_split_file(client, db_session):
    token, org_id = await _register_with_org(client)
    org = await db_session.get(Organization, org_id)
    assert org is not None

    template = LabelTemplate(
        name="Локальная нумерация",
        width_mm=58,
        height_mm=40,
        layout_data={
            "elements": [
                {
                    "type": "field",
                    "field_key": "label_number",
                    "x": 2,
                    "y": 2,
                    "font_size": 12,
                }
            ]
        },
        org_id=org.id,
    )
    db_session.add(template)
    await db_session.commit()
    await db_session.refresh(template)

    response = await client.post(
        FROM_TEMPLATE_URL,
        json={
            "template_id": str(template.id),
            "codes": [VALID_CODE] * 5,
            "copies": 1,
            "split_files": True,
            "pages_per_file": 2,
            "continuous_numbering": False,
            "start_number": 1,
        },
        headers=_auth_headers(token),
    )
    assert response.status_code == 200

    records = list(
        (
            await db_session.execute(
                select(LabelPdfFile)
                .where(LabelPdfFile.org_id == org_id)
                .order_by(LabelPdfFile.created_at.asc())
            )
        ).scalars()
    )
    assert _pdf_contains_text(bytes(records[0].data), "1")
    assert _pdf_contains_text(bytes(records[0].data), "2")
    assert _pdf_contains_text(bytes(records[1].data), "1")
    assert _pdf_contains_text(bytes(records[1].data), "2")
    assert _pdf_contains_text(bytes(records[2].data), "1")


@pytest.mark.asyncio
async def test_split_files_org_isolation(client, db_session):
    token_a, org_id_a = await _register_with_org(client)
    await client.post(
        BATCH_PDF_URL,
        json={
            "codes": [VALID_CODE] * 3,
            "copies": 1,
            "split_files": True,
            "pages_per_file": 1,
        },
        headers=_auth_headers(token_a),
    )

    token_b, _ = await _register_with_org(client)
    list_b = await client.get(PDF_FILES_URL, headers=_auth_headers(token_b))
    assert list_b.json() == []

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
async def test_split_invalid_pages_per_file_rejected(client):
    token, _ = await _register_with_org(client)

    response = await client.post(
        BATCH_PDF_URL,
        json={
            "codes": [VALID_CODE],
            "copies": 1,
            "split_files": True,
            "pages_per_file": 0,
        },
        headers=_auth_headers(token),
    )

    assert response.status_code == 400
