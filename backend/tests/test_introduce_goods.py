"""Тесты LP_INTRODUCE_GOODS — ввод в оборот (Производство РФ)."""
from __future__ import annotations

import base64
import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from models import Organization, ProductCard, ProductCardStatus, ProductCardType, User
from services.introduce_goods_service import (
    build_introduce_goods_body,
    build_introduce_goods_document,
    encode_introduce_goods_body,
    extract_certificate_document_data,
    extract_gtin_from_code,
    resolve_tnved_code,
    send_introduce_goods,
)

FULL_CODE = (
    "01029000040676422151lSbQXAES&g691FFD092dGVzdDxPl4yc2OOhCoXj6TPcEG6lSKcn9t0Vavgj/d4="
)
GTIN = "02900004067642"


def test_extract_gtin_from_code():
    assert extract_gtin_from_code(FULL_CODE) == GTIN


def test_build_introduce_goods_body_structure():
    products = [
        {
            "uit_code": FULL_CODE,
            "tnved_code": "3303001000",
            "certificate_document_data": [],
        }
    ]
    doc = build_introduce_goods_body(
        participant_inn="7707083893",
        producer_inn="7707083893",
        owner_inn="7707083893",
        products=products,
        production_date="2025-06-01",
    )
    assert doc["participant_inn"] == "7707083893"
    assert doc["producer_inn"] == "7707083893"
    assert doc["owner_inn"] == "7707083893"
    assert doc["production_type"] == "OWN_PRODUCTION"
    assert doc["production_date"] == "2025-06-01"
    assert doc["products"][0]["uit_code"] == FULL_CODE
    assert doc["products"][0]["tnved_code"] == "3303001000"
    assert doc["products"][0]["certificate_document_data"] == []


def test_encode_introduce_goods_body_base64():
    doc = build_introduce_goods_body(
        participant_inn="7707083893",
        producer_inn="7707083893",
        owner_inn="7707083893",
        products=[
            {
                "uit_code": FULL_CODE,
                "tnved_code": "3303001000",
                "certificate_document_data": [],
            }
        ],
    )
    body_json, body_b64 = encode_introduce_goods_body(doc)
    assert json.loads(body_json) == doc
    assert base64.b64decode(body_b64).decode("utf-8") == body_json


def test_resolve_tnved_from_card():
    card = ProductCard(
        type=ProductCardType.UNIT,
        tn_ved="3303",
        tn_ved_code="3303001000",
        name="Test",
        status=ProductCardStatus.DRAFT,
    )
    assert resolve_tnved_code(card, fill_from_cards=True, default_tnved="0000000000") == "3303001000"
    assert resolve_tnved_code(card, fill_from_cards=False, default_tnved="1111111111") == "1111111111"


def test_extract_certificate_from_card_extra_attrs():
    card = ProductCard(
        type=ProductCardType.UNIT,
        tn_ved="3303",
        name="Test",
        status=ProductCardStatus.DRAFT,
        extra_attrs={
            "nk_attrs": {"23557": "RU С-XX.YYYY.А.00001"},
            "nk_optional_attrs": {"23558": "2024-05-10"},
            "nk_attrs_names": {
                "23557": "Номер сертификата соответствия",
                "23558": "Дата сертификата соответствия",
            },
        },
    )
    certs = extract_certificate_document_data(card)
    assert len(certs) == 1
    assert certs[0]["certificate_type"] == "CONFORMITY_CERTIFICATE"
    assert certs[0]["certificate_number"] == "RU С-XX.YYYY.А.00001"
    assert certs[0]["certificate_date"] == "2024-05-10"


def test_extract_certificate_empty_when_missing():
    card = ProductCard(
        type=ProductCardType.UNIT,
        tn_ved="3303",
        name="Test",
        status=ProductCardStatus.DRAFT,
        extra_attrs={"nk_attrs": {}, "nk_attrs_names": {}},
    )
    assert extract_certificate_document_data(card) == []


@pytest.mark.asyncio
async def test_build_introduce_goods_document_fill_from_cards(db_session):
    user = User(
        username=f"u_{uuid.uuid4().hex[:8]}",
        hashed_password="x",
    )
    db_session.add(user)
    await db_session.flush()

    org = Organization(user_id=user.id, name="Test Org", inn="7707083893", is_active=True)
    db_session.add(org)
    await db_session.flush()

    card = ProductCard(
        type=ProductCardType.UNIT,
        tn_ved="3303",
        tn_ved_code="3303001000",
        gtin=GTIN,
        name="Perfume",
        status=ProductCardStatus.PUBLISHED,
        org_id=org.id,
        extra_attrs={
            "nk_attrs": {"23557": "CERT-001"},
            "nk_optional_attrs": {"23558": "10.05.2024"},
            "nk_attrs_names": {
                "23557": "Номер сертификата соответствия",
                "23558": "Дата сертификата соответствия",
            },
        },
    )
    db_session.add(card)
    await db_session.commit()

    doc = await build_introduce_goods_document(
        [FULL_CODE],
        db_session,
        org_inn=org.inn,
        production_date="2025-06-01",
        fill_tnved_from_cards=True,
        fill_certificate_from_cards=True,
        org_id=org.id,
    )
    product = doc["products"][0]
    assert product["tnved_code"] == "3303001000"
    assert len(product["certificate_document_data"]) == 1
    assert product["certificate_document_data"][0]["certificate_number"] == "CERT-001"


@pytest.mark.asyncio
async def test_introduce_goods_body_endpoint(client, user_token):
    await client.post(
        "/api/v1/organizations/",
        json={"name": "Org", "inn": "7707083893"},
        headers={"Authorization": f"Bearer {user_token}"},
    )

    response = await client.post(
        "/api/v1/emission-orders/introduce-goods-body",
        json={
            "marking_codes": [FULL_CODE],
            "product_group": "perfumery",
            "default_tnved_code": "3303001000",
            "production_date": "2025-06-01",
        },
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    body = json.loads(data["body"])
    assert body["production_type"] == "OWN_PRODUCTION"
    assert body["products"][0]["tnved_code"] == "3303001000"
    assert base64.b64decode(data["body_b64"]).decode("utf-8") == data["body"]


@pytest.mark.asyncio
async def test_send_introduce_goods_mocked(client, user_token):
    await client.post(
        "/api/v1/organizations/",
        json={"name": "Org", "inn": "7707083893"},
        headers={"Authorization": f"Bearer {user_token}"},
    )

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = '{"id":"doc-1"}'
    mock_response.json.return_value = {"id": "doc-1"}

    with (
        patch(
            "services.introduce_goods_service.get_true_api_token",
            new_callable=AsyncMock,
            return_value="test-true-api-token",
        ),
        patch(
            "services.introduce_goods_service._suz_dispatch_httpx",
            new_callable=AsyncMock,
            return_value=(mock_response, None),
        ),
    ):
        response = await client.post(
            "/api/v1/emission-orders/introduce-goods",
            json={
                "marking_codes": [FULL_CODE],
                "product_group": "perfumery",
                "default_tnved_code": "3303001000",
                "signature": "dGVzdFNpZw==",
            },
            headers={"Authorization": f"Bearer {user_token}"},
        )

    assert response.status_code == 200
    assert response.json()["success"] is True
