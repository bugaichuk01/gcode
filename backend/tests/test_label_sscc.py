"""Тесты печати SSCC (КИТУ) — без crypto-check, Code128 по kitu_code."""
from __future__ import annotations

import uuid

import pytest

from labels.field_catalog import FieldResolveContext, PrintContext, resolve_barcode_value, resolve_field
from labels.block_registry import draw_element_from_template
from unittest.mock import MagicMock, patch

import io
from reportlab.pdfgen import canvas

SSCC_BATCH_URL = "/api/v1/labels/pdf/sscc"
SSCC_PREVIEW_URL = "/api/v1/labels/pdf/sscc/preview"
BATCH_PDF_URL = "/api/v1/labels/pdf/batch"
VALID_KITU = "460000000123456789"
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


def test_resolve_field_kitu_code_from_sscc():
    ctx = FieldResolveContext(code=VALID_KITU, gtin=None, extra_fields=None)
    assert resolve_field("kitu_code", ctx) == VALID_KITU


def test_resolve_field_kitu_code_empty_for_km():
    ctx = FieldResolveContext(code=VALID_CODE, gtin="02900004064948", extra_fields=None)
    assert resolve_field("kitu_code", ctx) == ""


def test_resolve_barcode_kitu_code_code128():
    ctx = FieldResolveContext(
        code=VALID_KITU,
        gtin=None,
        extra_fields=None,
        print_context=PrintContext(
            label_index=0,
            label_number=1,
            total=1,
            barcode_type="code128",
            barcode_column="kitu_code",
            kitu_code=VALID_KITU,
        ),
    )
    assert (
        resolve_barcode_value(
            ctx,
            barcode_type="code128",
            barcode_column="kitu_code",
        )
        == VALID_KITU
    )


def test_draw_barcode_code128_from_kitu_code():
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(200, 200))
    el = {"type": "barcode_ean13", "x": 5, "y": 5, "width": 38, "height": 15}
    print_ctx = PrintContext(
        label_index=0,
        label_number=1,
        total=1,
        barcode_type="code128",
        barcode_column="kitu_code",
        kitu_code=VALID_KITU,
    )
    with patch("reportlab.graphics.barcode.code128.Code128.drawOn") as mock_draw:
        draw_element_from_template(
            c,
            el,
            VALID_KITU,
            None,
            None,
            200.0,
            None,
            None,
            print_ctx,
        )
        c.save()
    mock_draw.assert_called_once()


@pytest.mark.asyncio
async def test_sscc_batch_pdf_without_crypto_check(client):
    token = await _register_token(client)
    response = await client.post(
        SSCC_BATCH_URL,
        json={"kitu_codes": [VALID_KITU], "save": False},
        headers=_auth_headers(token),
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert len(response.content) > 100


@pytest.mark.asyncio
async def test_sscc_batch_rejects_invalid_kitu(client):
    token = await _register_token(client)
    response = await client.post(
        SSCC_BATCH_URL,
        json={"kitu_codes": ["12345"], "save": False},
        headers=_auth_headers(token),
    )
    assert response.status_code == 400
    assert "18" in response.json()["detail"]


@pytest.mark.asyncio
async def test_km_batch_still_rejects_sscc_as_code(client):
    token = await _register_token(client)
    response = await client.post(
        BATCH_PDF_URL,
        json={"codes": [VALID_KITU], "save": False},
        headers=_auth_headers(token),
    )
    assert response.status_code == 400
    assert "криптохвост" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_sscc_preview_returns_pdf(client):
    token = await _register_token(client)
    response = await client.post(
        SSCC_PREVIEW_URL,
        json={"kitu_code": VALID_KITU},
        headers=_auth_headers(token),
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
