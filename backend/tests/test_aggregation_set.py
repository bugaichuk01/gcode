"""Тесты формирования набора (SETS_AGGREGATION)."""
from __future__ import annotations

import json
import uuid

import pytest

from models import ProductCard, ProductCardStatus, ProductCardType
from services.aggregation_service import (
    AGGREGATION_TYPE_KITU,
    AGGREGATION_TYPE_SET,
    build_aggregation_document,
    validate_set_composition,
)

BUNDLE_GTIN = "04600000000099"
ITEM1_GTIN = "04600000000001"
ITEM2_GTIN = "04600000000002"


def _km(gtin: str, serial: str = "abc") -> str:
    return f"01{gtin}21{serial}91FFD092test"


SET_CODE = _km(BUNDLE_GTIN, "setserial")
ITEM1_CODE = _km(ITEM1_GTIN, "item1")
ITEM2_CODE_A = _km(ITEM2_GTIN, "item2a")
ITEM2_CODE_B = _km(ITEM2_GTIN, "item2b")

SET_ITEMS = [
    {"gtin": ITEM1_GTIN, "quantity": 1},
    {"gtin": ITEM2_GTIN, "quantity": 2},
]


def test_build_aggregation_document_kitu_default_type():
    body = build_aggregation_document(
        kitu_code="046000000000000001",
        marking_codes=[ITEM1_CODE, ITEM2_CODE_A],
        participant_inn="7707083893",
    )
    unit = body["aggregationUnits"][0]
    assert unit["aggregationType"] == AGGREGATION_TYPE_KITU
    assert unit["unitSerialNumber"] == "046000000000000001"
    assert unit["sntins"] == [ITEM1_CODE, ITEM2_CODE_A]
    assert unit["aggregatedItemsCount"] == 2


def test_build_aggregation_document_sets_aggregation():
    codes = [ITEM1_CODE, ITEM2_CODE_A, ITEM2_CODE_B]
    body = build_aggregation_document(
        kitu_code=SET_CODE,
        marking_codes=codes,
        product_group="perfumery",
        participant_inn="7707083893",
        aggregation_type=AGGREGATION_TYPE_SET,
    )
    assert body["participantId"] == "7707083893"
    assert body["productGroup"] == "perfumery"
    unit = body["aggregationUnits"][0]
    assert unit["aggregationType"] == "SETS_AGGREGATION"
    assert unit["unitSerialNumber"] == SET_CODE
    assert unit["sntins"] == codes
    assert unit["aggregatedItemsCount"] == 3
    assert unit["aggregationUnitCapacity"] == 3


def test_validate_set_composition_matches():
    validate_set_composition(
        [ITEM1_CODE, ITEM2_CODE_A, ITEM2_CODE_B],
        SET_ITEMS,
        set_code=SET_CODE,
        bundle_gtin=BUNDLE_GTIN,
    )


def test_validate_set_composition_mismatch_gtin():
    with pytest.raises(ValueError, match="не соответствует карточке набора"):
        validate_set_composition(
            [ITEM1_CODE, ITEM1_CODE],
            SET_ITEMS,
        )


def test_validate_set_composition_mismatch_quantity():
    with pytest.raises(ValueError, match="не соответствует карточке набора"):
        validate_set_composition(
            [ITEM1_CODE],
            SET_ITEMS,
        )


def test_validate_set_composition_wrong_set_code_gtin():
    wrong_set = _km("04600000000088", "wrong")
    with pytest.raises(ValueError, match="не соответствует GTIN карточки"):
        validate_set_composition(
            [ITEM1_CODE, ITEM2_CODE_A, ITEM2_CODE_B],
            SET_ITEMS,
            set_code=wrong_set,
            bundle_gtin=BUNDLE_GTIN,
        )


@pytest.mark.asyncio
async def test_create_set_aggregation_draft(client, user_token, db_session):
    card = ProductCard(
        id=uuid.uuid4(),
        type=ProductCardType.BUNDLE,
        tn_ved="3303",
        gtin=BUNDLE_GTIN,
        name="Набор тест",
        status=ProductCardStatus.PUBLISHED,
        is_set=True,
        set_items=SET_ITEMS,
    )
    db_session.add(card)
    await db_session.commit()

    response = await client.post(
        "/api/v1/aggregation/",
        json={
            "marking_codes": [ITEM1_CODE, ITEM2_CODE_A, ITEM2_CODE_B],
            "product_group": "perfumery",
            "kitu_code": SET_CODE,
            "aggregation_type": "SETS_AGGREGATION",
            "product_card_id": str(card.id),
        },
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["aggregation_type"] == "SETS_AGGREGATION"
    assert data["kitu_code"] == SET_CODE
    assert data["product_card_id"] == str(card.id)


@pytest.mark.asyncio
async def test_create_set_aggregation_rejects_bad_composition(client, user_token, db_session):
    card = ProductCard(
        id=uuid.uuid4(),
        type=ProductCardType.BUNDLE,
        tn_ved="3303",
        gtin=BUNDLE_GTIN,
        name="Набор тест",
        status=ProductCardStatus.PUBLISHED,
        is_set=True,
        set_items=SET_ITEMS,
    )
    db_session.add(card)
    await db_session.commit()

    response = await client.post(
        "/api/v1/aggregation/",
        json={
            "marking_codes": [ITEM1_CODE],
            "product_group": "perfumery",
            "kitu_code": SET_CODE,
            "aggregation_type": "SETS_AGGREGATION",
            "product_card_id": str(card.id),
        },
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert response.status_code == 422
    assert "не соответствует карточке набора" in response.json()["detail"]


@pytest.mark.asyncio
async def test_set_aggregation_body_preview(client, user_token, db_session):
    card = ProductCard(
        id=uuid.uuid4(),
        type=ProductCardType.BUNDLE,
        tn_ved="3303",
        gtin=BUNDLE_GTIN,
        name="Набор тест",
        status=ProductCardStatus.PUBLISHED,
        is_set=True,
        set_items=SET_ITEMS,
    )
    db_session.add(card)
    await db_session.commit()

    create_res = await client.post(
        "/api/v1/aggregation/",
        json={
            "marking_codes": [ITEM1_CODE, ITEM2_CODE_A, ITEM2_CODE_B],
            "product_group": "perfumery",
            "kitu_code": SET_CODE,
            "aggregation_type": "SETS_AGGREGATION",
            "product_card_id": str(card.id),
        },
        headers={"Authorization": f"Bearer {user_token}"},
    )
    doc_id = create_res.json()["id"]

    body_res = await client.get(
        f"/api/v1/aggregation/{doc_id}/body",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert body_res.status_code == 200
    body = json.loads(body_res.json()["body"])
    unit = body["aggregationUnits"][0]
    assert unit["aggregationType"] == "SETS_AGGREGATION"
    assert unit["unitSerialNumber"] == SET_CODE
    assert unit["sntins"] == [ITEM1_CODE, ITEM2_CODE_A, ITEM2_CODE_B]


@pytest.mark.asyncio
async def test_kitu_aggregation_still_default(client, user_token):
    response = await client.post(
        "/api/v1/aggregation/",
        json={
            "marking_codes": [ITEM1_CODE, ITEM2_CODE_A],
            "product_group": "perfumery",
            "kitu_code": "046000000000000001",
        },
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["aggregation_type"] == "AGGREGATION"

    body_res = await client.get(
        f"/api/v1/aggregation/{data['id']}/body",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    body = json.loads(body_res.json()["body"])
    assert body["aggregationUnits"][0]["aggregationType"] == "AGGREGATION"
