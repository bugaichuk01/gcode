"""Тесты PDF системных штрихкодов СТАРТ/КОНЕЦ (режим агрегации после сборки)."""
from __future__ import annotations

import uuid

import pytest
from pypdf import PdfReader

from aggregation_system_codes import AGGR_END_CODE, AGGR_START_CODE
from labels.aggregation_system_barcodes_pdf import build_aggregation_system_barcodes_pdf

SYSTEM_BARCODE_PDF_URL = "/api/v1/labels/pdf/aggregation-system-barcodes"


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register_token(client, username: str | None = None) -> str:
    name = username or f"user_{uuid.uuid4().hex[:8]}"
    response = await client.post(
        "/api/v1/auth/register",
        json={"username": name, "password": "testpass123"},
    )
    assert response.status_code in (200, 201)
    return response.json()["access_token"]


def test_aggregation_system_codes_match_frontend_contract():
    assert AGGR_START_CODE == "AGGR_ST"
    assert AGGR_END_CODE == "AGGR_FN"


def test_build_aggregation_system_barcodes_pdf_single_page():
    pdf_bytes = build_aggregation_system_barcodes_pdf()
    assert pdf_bytes.startswith(b"%PDF")
    reader = PdfReader(__import__("io").BytesIO(pdf_bytes))
    assert len(reader.pages) == 1


@pytest.mark.asyncio
async def test_aggregation_system_barcodes_pdf_endpoint(client):
    token = await _register_token(client)
    response = await client.get(
        SYSTEM_BARCODE_PDF_URL,
        headers=_auth_headers(token),
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")
    assert "attachment" in response.headers.get("content-disposition", "").lower()
    reader = PdfReader(__import__("io").BytesIO(response.content))
    assert len(reader.pages) == 1
