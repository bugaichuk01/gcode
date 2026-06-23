"""Тесты API доп. полей GTIN (extra JSON merge)."""
from __future__ import annotations

import pytest

EXTRA_FIELDS_URL = "/api/v1/extra-fields/"


@pytest.mark.asyncio
async def test_extra_fields_upsert_merges_extra_json(client, user_token):
    headers = {"Authorization": f"Bearer {user_token}"}
    gtin = "04600000000001"

    create = await client.post(
        EXTRA_FIELDS_URL,
        headers=headers,
        json={
            "gtin": gtin,
            "extra": {"phone": "+7900", "custom_key": "keep"},
        },
    )
    assert create.status_code == 200

    update = await client.post(
        EXTRA_FIELDS_URL,
        headers=headers,
        json={
            "gtin": gtin,
            "extra": {"field_1": "ABC"},
        },
    )
    assert update.status_code == 200
    body = update.json()
    assert body["extra"] == {"phone": "+7900", "custom_key": "keep", "field_1": "ABC"}


@pytest.mark.asyncio
async def test_extra_fields_upsert_clears_extra_key_with_null(client, user_token):
    headers = {"Authorization": f"Bearer {user_token}"}
    gtin = "04600000000002"

    await client.post(
        EXTRA_FIELDS_URL,
        headers=headers,
        json={"gtin": gtin, "extra": {"phone": "+7900", "custom_key": "keep"}},
    )

    update = await client.post(
        EXTRA_FIELDS_URL,
        headers=headers,
        json={"gtin": gtin, "extra": {"phone": None}},
    )
    assert update.status_code == 200
    assert update.json()["extra"] == {"custom_key": "keep"}
