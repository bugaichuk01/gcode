"""Тесты загрузки изображений этикеток (label_images) и PDF-рендера блока image."""
from __future__ import annotations

import logging
import uuid
from io import BytesIO
from unittest.mock import AsyncMock, patch

import pytest
from reportlab.pdfgen import canvas

from labels.block_registry import (
    BLOCK_TYPES,
    DEFAULT_GEOMETRY,
    draw_element_from_template,
    merge_element_defaults,
)
from labels.image_service import load_label_images_cache
from models import LabelImage, LabelTemplate, Organization, User
from services.auth_service import get_password_hash

IMAGES_URL = "/api/v1/labels/images"
VALID_CODE = (
    "01029000040676422151lSbQXAES&g691FFD092dGVzdDxPl4yc2OOhCoXj6TPcEG6lSKcn9t0Vavgj/d4="
)

MINIMAL_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
    b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx"
    b"\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\x00\x05\xfe\xd4\xef"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
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


async def _create_label_image(
    db_session,
    org: Organization,
    data: bytes = MINIMAL_PNG,
    mime: str = "image/png",
) -> LabelImage:
    image = LabelImage(
        mime=mime,
        data=data,
        filename="test.png",
        org_id=org.id,
    )
    db_session.add(image)
    await db_session.commit()
    await db_session.refresh(image)
    return image


def _render_pdf_elements(
    elements: list[dict],
    image_cache: dict[str, bytes] | None = None,
) -> bytes:
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(200, 200))
    page_h = 200.0
    for el in elements:
        draw_element_from_template(c, el, "code", None, None, page_h, None, image_cache)
    c.save()
    return buf.getvalue()


@pytest.mark.asyncio
async def test_upload_png_creates_label_image_record(client, db_session):
    token, org_id = await _register_with_org(client)

    response = await client.post(
        IMAGES_URL,
        files={"file": ("logo.png", MINIMAL_PNG, "image/png")},
        headers=_auth_headers(token),
    )

    assert response.status_code == 201
    data = response.json()
    assert data["mime"] == "image/png"
    assert "id" in data

    image = await db_session.get(LabelImage, uuid.UUID(data["id"]))
    assert image is not None
    assert bytes(image.data) == MINIMAL_PNG
    assert image.org_id == org_id


@pytest.mark.asyncio
async def test_get_image_returns_binary_with_content_type(client, db_session):
    token, org_id = await _register_with_org(client)
    org = await db_session.get(Organization, org_id)
    assert org is not None
    image = await _create_label_image(db_session, org)

    response = await client.get(
        f"{IMAGES_URL}/{image.id}",
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    assert response.content == MINIMAL_PNG
    assert response.headers["content-type"].startswith("image/png")
    assert "immutable" in response.headers.get("cache-control", "")


@pytest.mark.asyncio
async def test_upload_oversized_file_rejected(client):
    token, _org_id = await _register_with_org(client)
    big = MINIMAL_PNG + b"x" * (1024 * 1024)

    response = await client.post(
        IMAGES_URL,
        files={"file": ("big.png", big, "image/png")},
        headers=_auth_headers(token),
    )

    assert response.status_code == 400
    assert "КБ" in response.json()["detail"]


@pytest.mark.asyncio
async def test_upload_invalid_mime_rejected(client):
    token, _org_id = await _register_with_org(client)

    response = await client.post(
        IMAGES_URL,
        files={"file": ("evil.exe", b"MZ", "application/octet-stream")},
        headers=_auth_headers(token),
    )

    assert response.status_code == 400
    assert "PNG" in response.json()["detail"]


@pytest.mark.asyncio
async def test_get_image_other_org_returns_404(client, db_session):
    token_a, org_id_a = await _register_with_org(client)
    org_a = await db_session.get(Organization, org_id_a)
    assert org_a is not None

    upload = await client.post(
        IMAGES_URL,
        files={"file": ("logo.png", MINIMAL_PNG, "image/png")},
        headers=_auth_headers(token_a),
    )
    image_id = upload.json()["id"]

    token_b, _org_id_b = await _register_with_org(client)
    response = await client.get(
        f"{IMAGES_URL}/{image_id}",
        headers=_auth_headers(token_b),
    )

    assert response.status_code == 404


def test_block_registry_includes_image_type():
    assert "image" in BLOCK_TYPES
    assert DEFAULT_GEOMETRY["image"]["width"] == 15
    assert DEFAULT_GEOMETRY["image"]["height"] == 15


def test_merge_element_defaults_image():
    el = merge_element_defaults({"type": "image", "x": 1, "y": 2, "image_id": "abc"})
    assert el["width"] == 15
    assert el["image_id"] == "abc"


def test_pdf_image_renders_with_cache():
    image_id = str(uuid.uuid4())
    pdf = _render_pdf_elements(
        [{"type": "image", "image_id": image_id, "x": 5, "y": 5, "width": 10, "height": 10}],
        image_cache={image_id: MINIMAL_PNG},
    )
    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 500


def test_pdf_image_empty_id_skips_with_warning(caplog):
    with caplog.at_level(logging.WARNING):
        pdf = _render_pdf_elements([{"type": "image", "x": 1, "y": 1}])
    assert pdf.startswith(b"%PDF")
    assert any("image_id" in r.message for r in caplog.records)


def test_pdf_image_missing_cache_skips_with_warning(caplog):
    with caplog.at_level(logging.WARNING):
        pdf = _render_pdf_elements(
            [{"type": "image", "image_id": str(uuid.uuid4()), "x": 1, "y": 1}]
        )
    assert pdf.startswith(b"%PDF")
    assert any("кэше" in r.message for r in caplog.records)


@pytest.mark.asyncio
async def test_load_label_images_cache_deduplicates_ids(db_session):
    user = User(
        username=f"cache_{uuid.uuid4().hex[:8]}",
        hashed_password=get_password_hash("x"),
    )
    db_session.add(user)
    await db_session.flush()
    org = Organization(user_id=user.id, name="org")
    db_session.add(org)
    await db_session.flush()
    image = await _create_label_image(db_session, org)
    layout = {
        "elements": [
            {"type": "image", "image_id": str(image.id), "x": 1, "y": 1},
            {"type": "image", "image_id": str(image.id), "x": 2, "y": 2},
        ]
    }

    cache = await load_label_images_cache(db_session, layout, org)

    assert list(cache.keys()) == [str(image.id)]
    assert cache[str(image.id)] == MINIMAL_PNG


@pytest.mark.asyncio
async def test_batch_pdf_uses_image_cache_once(client, db_session):
    token, org_id = await _register_with_org(client)
    org = await db_session.get(Organization, org_id)
    assert org is not None
    image = await _create_label_image(db_session, org)

    template = LabelTemplate(
        name="С картинкой",
        width_mm=58,
        height_mm=40,
        layout_data={
            "elements": [
                {
                    "type": "image",
                    "image_id": str(image.id),
                    "x": 5,
                    "y": 5,
                    "width": 10,
                    "height": 10,
                }
            ]
        },
        org_id=org.id,
    )
    db_session.add(template)
    await db_session.commit()
    await db_session.refresh(template)

    with patch(
        "routers.labels.load_label_images_cache",
        new_callable=AsyncMock,
        return_value={str(image.id): MINIMAL_PNG},
    ) as mock_load:
        response = await client.post(
            "/api/v1/labels/pdf/from-template",
            json={
                "template_id": str(template.id),
                "codes": [VALID_CODE] * 5,
                "copies": 1,
            },
            headers=_auth_headers(token),
        )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    mock_load.assert_awaited_once()


def test_pdf_horizontal_and_vertical_lines_render():
    pdf = _render_pdf_elements(
        [
            {"type": "line", "x": 2, "y": 5, "x2": 30, "y2": 5},
            {"type": "line", "x": 10, "y": 2, "x2": 10, "y2": 25},
        ]
    )
    assert pdf.startswith(b"%PDF")
