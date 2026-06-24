"""Тесты импорта доп. полей из Excel (bulk-семантика)."""
from __future__ import annotations

import uuid

import pytest

EXTRA_FIELDS_URL = "/api/v1/extra-fields/"
IMPORT_URL = f"{EXTRA_FIELDS_URL}import"


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
async def test_import_creates_and_updates_rows(client):
    token, _org_id = await _register_with_org(client)
    headers = _auth_headers(token)
    existing_gtin = "04600000000040"

    await client.post(
        EXTRA_FIELDS_URL,
        headers=headers,
        json={"gtin": existing_gtin, "brand": "OldBrand", "name": "KeepName"},
    )

    response = await client.post(
        IMPORT_URL,
        headers=headers,
        json={
            "rows": [
                {
                    "gtin": existing_gtin,
                    "fields": {"brand": "NewBrand"},
                },
                {
                    "gtin": "04600000000041",
                    "fields": {
                        "brand": "CreatedBrand",
                        "extra": {
                            "field_1": "VAL",
                            "field_1_label": "Артикул поставщика",
                            "print_name": "Печатное имя",
                        },
                    },
                },
            ],
        },
    )
    assert response.status_code == 200
    assert response.json() == {
        "updated": 1,
        "created": 1,
        "total": 2,
        "skipped": 0,
    }

    listed_old = await client.get(
        f"{EXTRA_FIELDS_URL}?gtin={existing_gtin}",
        headers=headers,
    )
    item_old = listed_old.json()["items"][0]
    assert item_old["brand"] == "NewBrand"
    assert item_old["name"] == "KeepName"

    listed_new = await client.get(
        f"{EXTRA_FIELDS_URL}?gtin=04600000000041",
        headers=headers,
    )
    item_new = listed_new.json()["items"][0]
    assert item_new["brand"] == "CreatedBrand"
    assert item_new["extra"] == {
        "field_1": "VAL",
        "field_1_label": "Артикул поставщика",
        "print_name": "Печатное имя",
    }


@pytest.mark.asyncio
async def test_import_empty_fields_do_not_clear_existing(client, user_token):
    headers = _auth_headers(user_token)
    gtin = "04600000000042"

    await client.post(
        EXTRA_FIELDS_URL,
        headers=headers,
        json={"gtin": gtin, "brand": "KeepBrand", "extra": {"phone": "+7900"}},
    )

    response = await client.post(
        IMPORT_URL,
        headers=headers,
        json={
            "rows": [
                {
                    "gtin": gtin,
                    "fields": {"name": "OnlyName"},
                },
            ],
        },
    )
    assert response.status_code == 200

    listed = await client.get(f"{EXTRA_FIELDS_URL}?gtin={gtin}", headers=headers)
    item = listed.json()["items"][0]
    assert item["name"] == "OnlyName"
    assert item["brand"] == "KeepBrand"
    assert item["extra"] == {"phone": "+7900"}


@pytest.mark.asyncio
async def test_import_rejects_rows_without_fields(client, user_token):
    headers = _auth_headers(user_token)
    response = await client.post(
        IMPORT_URL,
        headers=headers,
        json={"rows": [{"gtin": "04600000000043", "fields": {}}]},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_import_skips_invalid_gtin(client, user_token):
    headers = _auth_headers(user_token)
    response = await client.post(
        IMPORT_URL,
        headers=headers,
        json={
            "rows": [
                {"gtin": "123", "fields": {"brand": "X"}},
                {"gtin": "04600000000044", "fields": {"brand": "Valid"}},
            ],
        },
    )
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["skipped"] == 1
    assert response.json()["created"] == 1
