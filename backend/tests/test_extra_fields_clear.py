"""Тесты массовой очистки поля доп. полей."""
from __future__ import annotations

import uuid

import pytest

EXTRA_FIELDS_URL = "/api/v1/extra-fields/"
CLEAR_FIELD_URL = f"{EXTRA_FIELDS_URL}clear-field"


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register_with_org(client) -> tuple[str, uuid.UUID]:
    name = f"user_{uuid.uuid4().hex[:8]}"
    reg = await client.post(
        "/api/v1/auth/register",
        json={"username": name, "password": "pass123"},
    )
    token = reg.json()["access_token"]
    org_resp = await client.post(
        "/api/v1/organizations/",
        json={"name": "Тестовая организация"},
        headers=_auth_headers(token),
    )
    return token, uuid.UUID(org_resp.json()["id"])


@pytest.mark.asyncio
async def test_clear_column_field_for_selected_gtins(client):
    token, _org_id = await _register_with_org(client)
    headers = _auth_headers(token)
    gtins = ["04600000000050", "04600000000051", "04600000000052"]

    for gtin in gtins:
        await client.post(
            EXTRA_FIELDS_URL,
            headers=headers,
            json={"gtin": gtin, "brand": f"Brand-{gtin[-2:]}", "name": "Keep"},
        )

    response = await client.post(
        CLEAR_FIELD_URL,
        headers=headers,
        json={"gtins": gtins, "field": "brand"},
    )
    assert response.status_code == 200
    assert response.json() == {"cleared": 3, "skipped": 0}

    for gtin in gtins:
        listed = await client.get(f"{EXTRA_FIELDS_URL}?gtin={gtin}", headers=headers)
        item = listed.json()["items"][0]
        assert item["brand"] is None
        assert item["name"] == "Keep"


@pytest.mark.asyncio
async def test_clear_extra_key_removes_only_that_key(client, user_token):
    headers = _auth_headers(user_token)
    gtin = "04600000000053"

    await client.post(
        EXTRA_FIELDS_URL,
        headers=headers,
        json={
            "gtin": gtin,
            "extra": {"phone": "+7900", "manufacturer": "ООО Ромашка"},
        },
    )

    response = await client.post(
        CLEAR_FIELD_URL,
        headers=headers,
        json={"gtins": [gtin], "field": "extra.phone"},
    )
    assert response.status_code == 200
    assert response.json()["cleared"] == 1

    listed = await client.get(f"{EXTRA_FIELDS_URL}?gtin={gtin}", headers=headers)
    assert listed.json()["items"][0]["extra"] == {"manufacturer": "ООО Ромашка"}


@pytest.mark.asyncio
async def test_clear_user_field_value_does_not_remove_label(client, user_token):
    headers = _auth_headers(user_token)
    gtin = "04600000000054"

    await client.post(
        EXTRA_FIELDS_URL,
        headers=headers,
        json={
            "gtin": gtin,
            "extra": {
                "field_1": "VAL",
                "field_1_label": "Артикул поставщика",
            },
        },
    )

    response = await client.post(
        CLEAR_FIELD_URL,
        headers=headers,
        json={"gtins": [gtin], "field": "extra.field_1"},
    )
    assert response.status_code == 200

    listed = await client.get(f"{EXTRA_FIELDS_URL}?gtin={gtin}", headers=headers)
    assert listed.json()["items"][0]["extra"] == {"field_1_label": "Артикул поставщика"}


@pytest.mark.asyncio
async def test_clear_skips_missing_gtins_without_creating(client, user_token):
    headers = _auth_headers(user_token)
    gtin = "04600000000055"

    await client.post(
        EXTRA_FIELDS_URL,
        headers=headers,
        json={"gtin": gtin, "brand": "X"},
    )

    response = await client.post(
        CLEAR_FIELD_URL,
        headers=headers,
        json={
            "gtins": [gtin, "04600000000056"],
            "field": "brand",
        },
    )
    assert response.status_code == 200
    assert response.json() == {"cleared": 1, "skipped": 1}

    missing = await client.get(
        f"{EXTRA_FIELDS_URL}?gtin=04600000000056",
        headers=headers,
    )
    assert missing.json()["items"] == []


@pytest.mark.asyncio
async def test_clear_rejects_unknown_field(client, user_token):
    headers = _auth_headers(user_token)
    response = await client.post(
        CLEAR_FIELD_URL,
        headers=headers,
        json={"gtins": ["04600000000057"], "field": "unknown_field"},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_clear_is_org_scoped(client):
    token_a, _org_id_a = await _register_with_org(client)
    token_b, _org_id_b = await _register_with_org(client)
    headers_a = _auth_headers(token_a)
    headers_b = _auth_headers(token_b)
    gtin = "04600000000058"

    await client.post(
        EXTRA_FIELDS_URL,
        headers=headers_a,
        json={"gtin": gtin, "brand": "OrgA"},
    )

    response = await client.post(
        CLEAR_FIELD_URL,
        headers=headers_b,
        json={"gtins": [gtin], "field": "brand"},
    )
    assert response.status_code == 200
    assert response.json() == {"cleared": 0, "skipped": 1}

    listed = await client.get(f"{EXTRA_FIELDS_URL}?gtin={gtin}", headers=headers_a)
    assert listed.json()["items"][0]["brand"] == "OrgA"
