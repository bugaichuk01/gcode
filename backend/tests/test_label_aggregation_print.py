"""Тесты последовательной печати КИТУ + вложений (два макета)."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from labels.aggregation_pdf_service import build_aggregation_page_jobs
from models import AggregationDocument, LabelTemplate
from services.aggregation_service import AGGREGATION_TYPE_KITU, generate_kitu_code

AGGREGATION_PDF_URL = "/api/v1/labels/pdf/aggregation"
BATCH_PDF_URL = "/api/v1/labels/pdf/batch"
SSCC_BATCH_URL = "/api/v1/labels/pdf/sscc"
VALID_CODE_A = (
    "01029000040676422151lSbQXAES&g691FFD092dGVzdDxPl4yc2OOhCoXj6TPcEG6lSKcn9t0Vavgj/D4="
)
VALID_CODE_B = (
    "01029000040676422152lSbQXAES&g691FFD092dGVzdDxPl4yc2OOhCoXj6TPcEG6lSKcn9t0Vavgj/D5="
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


def _extract_gtin(code: str) -> str | None:
    import re

    m = re.match(r"^01(\d{14})", code)
    return m.group(1) if m else None


def test_build_aggregation_page_jobs_order():
    kitu = "046000000096594245"
    jobs = build_aggregation_page_jobs(
        [(kitu, [VALID_CODE_A, VALID_CODE_B])],
        kitu_layout={"elements": []},
        kitu_width_mm=40,
        kitu_height_mm=20,
        unit_layout={"elements": [{"type": "datamatrix", "x": 1, "y": 1, "size": 10}]},
        unit_width_mm=58,
        unit_height_mm=40,
        unit_barcode_type="ean13",
        unit_barcode_column="gtin",
        unit_barcode_keep_leading_zero=True,
        unit_barcode_from_extra=False,
        extract_gtin=_extract_gtin,
    )
    assert [j.kind for j in jobs] == ["kitu", "km", "km"]
    assert jobs[0].code == kitu
    assert jobs[0].width_mm == 40
    assert jobs[1].width_mm == 58
    assert jobs[1].code == VALID_CODE_A


@pytest.mark.asyncio
async def test_aggregation_pdf_two_kitu_groups_page_order(client, db_session):
    from main import create_default_templates, ensure_sscc_default_template

    await create_default_templates(db_session)
    await ensure_sscc_default_template(db_session)

    token = await _register_token(client)
    kitu1 = generate_kitu_code()
    kitu2 = generate_kitu_code()

    doc1 = AggregationDocument(
        kitu_code=kitu1,
        product_group="perfumery",
        marking_codes=[VALID_CODE_A],
        aggregation_type=AGGREGATION_TYPE_KITU,
    )
    doc2 = AggregationDocument(
        kitu_code=kitu2,
        product_group="perfumery",
        marking_codes=[VALID_CODE_B],
        aggregation_type=AGGREGATION_TYPE_KITU,
    )
    db_session.add_all([doc1, doc2])
    await db_session.commit()
    await db_session.refresh(doc1)
    await db_session.refresh(doc2)

    templates = await db_session.scalars(select(LabelTemplate))
    template_list = list(templates.all())
    kitu_tpl = next(t for t in template_list if "SSCC" in t.name)
    unit_tpl = next(t for t in template_list if t.width_mm == 58 and t.height_mm == 40)

    response = await client.post(
        AGGREGATION_PDF_URL,
        json={
            "doc_ids": [str(doc1.id), str(doc2.id)],
            "kitu_template_id": str(kitu_tpl.id),
            "unit_template_id": str(unit_tpl.id),
            "save": False,
        },
        headers=_auth_headers(token),
    )
    assert response.status_code == 200, response.text
    pdf = response.content
    assert len(pdf) > 1000

    import fitz

    doc = fitz.open(stream=pdf, filetype="pdf")
    assert doc.page_count == 4
    sizes = sorted({round(doc[i].rect.width) for i in range(doc.page_count)})
    assert len(sizes) >= 2


@pytest.mark.asyncio
async def test_aggregation_pdf_kitu_not_rejected_by_crypto_check(client, db_session):
    from main import create_default_templates, ensure_sscc_default_template

    await create_default_templates(db_session)
    await ensure_sscc_default_template(db_session)

    token = await _register_token(client)
    kitu = generate_kitu_code()
    doc = AggregationDocument(
        kitu_code=kitu,
        product_group="perfumery",
        marking_codes=[VALID_CODE_A],
        aggregation_type=AGGREGATION_TYPE_KITU,
    )
    db_session.add(doc)
    await db_session.commit()
    await db_session.refresh(doc)

    templates = await db_session.scalars(select(LabelTemplate))
    template_list = list(templates.all())
    kitu_tpl = next(t for t in template_list if "SSCC" in t.name)
    unit_tpl = next(t for t in template_list if t.width_mm == 58 and t.height_mm == 40)

    response = await client.post(
        AGGREGATION_PDF_URL,
        json={
            "doc_ids": [str(doc.id)],
            "kitu_template_id": str(kitu_tpl.id),
            "unit_template_id": str(unit_tpl.id),
            "save": False,
        },
        headers=_auth_headers(token),
    )
    assert response.status_code == 200

    import fitz

    text = fitz.open(stream=response.content, filetype="pdf")[0].get_text()
    assert kitu in text


@pytest.mark.asyncio
async def test_aggregation_pdf_package_and_labels_in_kitu_fields(client, db_session):
    """Поля package_number и labels_in_kitu на макете КИТУ, package_number на вложениях."""
    from main import create_default_templates, ensure_sscc_default_template

    await create_default_templates(db_session)
    await ensure_sscc_default_template(db_session)

    token = await _register_token(client)
    kitu1 = generate_kitu_code()
    kitu2 = generate_kitu_code()

    doc1 = AggregationDocument(
        kitu_code=kitu1,
        product_group="perfumery",
        marking_codes=[VALID_CODE_A, VALID_CODE_B],
        aggregation_type=AGGREGATION_TYPE_KITU,
    )
    doc2 = AggregationDocument(
        kitu_code=kitu2,
        product_group="perfumery",
        marking_codes=[VALID_CODE_A],
        aggregation_type=AGGREGATION_TYPE_KITU,
    )
    db_session.add_all([doc1, doc2])
    await db_session.commit()
    await db_session.refresh(doc1)
    await db_session.refresh(doc2)

    kitu_tpl = LabelTemplate(
        name="Test KITU pkg",
        width_mm=58,
        height_mm=40,
        layout_data={
            "elements": [
                {
                    "type": "field",
                    "field_key": "package_number",
                    "x": 2,
                    "y": 2,
                    "font_size": 10,
                    "label": {"show": False},
                },
                {
                    "type": "field",
                    "field_key": "labels_in_kitu",
                    "x": 2,
                    "y": 10,
                    "font_size": 10,
                    "label": {"show": False},
                },
            ]
        },
    )
    unit_tpl = LabelTemplate(
        name="Test unit pkg",
        width_mm=58,
        height_mm=40,
        layout_data={
            "elements": [
                {
                    "type": "field",
                    "field_key": "package_number",
                    "x": 2,
                    "y": 2,
                    "font_size": 10,
                    "label": {"show": False},
                },
                {
                    "type": "field",
                    "field_key": "label_number",
                    "x": 2,
                    "y": 10,
                    "font_size": 10,
                    "label": {"show": False},
                },
            ]
        },
    )
    db_session.add_all([kitu_tpl, unit_tpl])
    await db_session.commit()
    await db_session.refresh(kitu_tpl)
    await db_session.refresh(unit_tpl)

    response = await client.post(
        AGGREGATION_PDF_URL,
        json={
            "doc_ids": [str(doc1.id), str(doc2.id)],
            "kitu_template_id": str(kitu_tpl.id),
            "unit_template_id": str(unit_tpl.id),
            "save": False,
        },
        headers=_auth_headers(token),
    )
    assert response.status_code == 200, response.text

    import fitz

    doc = fitz.open(stream=response.content, filetype="pdf")
    assert doc.page_count == 5
    page_texts = [doc[i].get_text() for i in range(doc.page_count)]
    assert "1" in page_texts[0]
    assert "1-2" in page_texts[0]
    assert "1" in page_texts[1]
    assert "2" in page_texts[2]
    assert "2" in page_texts[3]
    assert "1" in page_texts[3]
    assert "2" in page_texts[4]
    assert "1" in page_texts[4]


@pytest.mark.asyncio
async def test_km_and_sscc_endpoints_still_work(client):
    token = await _register_token(client)
    kitu = generate_kitu_code()

    sscc = await client.post(
        SSCC_BATCH_URL,
        json={"kitu_codes": [kitu], "save": False},
        headers=_auth_headers(token),
    )
    assert sscc.status_code == 200

    km = await client.post(
        BATCH_PDF_URL,
        json={"codes": [VALID_CODE_A], "save": False},
        headers=_auth_headers(token),
    )
    assert km.status_code == 200

    km_reject = await client.post(
        BATCH_PDF_URL,
        json={"codes": [kitu], "save": False},
        headers=_auth_headers(token),
    )
    assert km_reject.status_code == 400
