"""Тесты API доп. полей GTIN (extra JSON merge)."""
from __future__ import annotations

import pytest

EXTRA_FIELDS_URL = "/api/v1/extra-fields/"


@pytest.mark.asyncio
async def test_extra_fields_saves_field_label_pair(client, user_token):
    headers = {"Authorization": f"Bearer {user_token}"}
    gtin = "04600000000030"

    create = await client.post(
        EXTRA_FIELDS_URL,
        headers=headers,
        json={
            "gtin": gtin,
            "extra": {
                "field_1": "ART-777",
                "field_1_label": "Артикул поставщика",
                "print_name": "Печатное имя",
            },
        },
    )
    assert create.status_code == 200
    body = create.json()
    assert body["extra"]["field_1"] == "ART-777"
    assert body["extra"]["field_1_label"] == "Артикул поставщика"
    assert body["extra"]["print_name"] == "Печатное имя"

    update = await client.post(
        EXTRA_FIELDS_URL,
        headers=headers,
        json={"gtin": gtin, "extra": {"field_1_label": None}},
    )
    assert update.status_code == 200
    assert update.json()["extra"] == {"field_1": "ART-777", "print_name": "Печатное имя"}


@pytest.mark.asyncio
async def test_extra_fields_bulk_field_label_pair(client, user_token):
    headers = {"Authorization": f"Bearer {user_token}"}
    gtin = "04600000000031"

    bulk = await client.post(
        f"{EXTRA_FIELDS_URL}bulk",
        headers=headers,
        json={
            "gtins": [gtin],
            "fields": {
                "extra": {
                    "field_2": "VAL",
                    "field_2_label": "Код партии",
                },
            },
        },
    )
    assert bulk.status_code == 200

    listed = await client.get(f"{EXTRA_FIELDS_URL}?gtin={gtin}", headers=headers)
    extra = listed.json()["items"][0]["extra"]
    assert extra == {"field_2": "VAL", "field_2_label": "Код партии"}


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
async def test_extra_fields_upsert_barcode_column(client, user_token):
    headers = {"Authorization": f"Bearer {user_token}"}
    gtin = "04600000000003"

    create = await client.post(
        EXTRA_FIELDS_URL,
        headers=headers,
        json={"gtin": gtin, "barcode": "123456789012"},
    )
    assert create.status_code == 200
    assert create.json()["barcode"] == "123456789012"

    update = await client.post(
        EXTRA_FIELDS_URL,
        headers=headers,
        json={"gtin": gtin, "barcode": "4601234567890"},
    )
    assert update.status_code == 200
    assert update.json()["barcode"] == "4601234567890"


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


@pytest.mark.asyncio
async def test_extra_fields_bulk_only_filled_fields(client, user_token):
    headers = {"Authorization": f"Bearer {user_token}"}
    gtins = ["04600000000010", "04600000000011", "04600000000012"]

    for gtin in gtins:
        create = await client.post(
            EXTRA_FIELDS_URL,
            headers=headers,
            json={
                "gtin": gtin,
                "name": f"Name {gtin}",
                "article": f"ART-{gtin[-2:]}",
                "brand": "OldBrand",
            },
        )
        assert create.status_code == 200

    bulk = await client.post(
        f"{EXTRA_FIELDS_URL}bulk",
        headers=headers,
        json={
            "gtins": gtins,
            "fields": {
                "brand": "NewBrand",
                "name": "",
                "article": None,
            },
        },
    )
    assert bulk.status_code == 200
    assert bulk.json() == {"updated": 3, "created": 0, "total": 3}

    for gtin in gtins:
        listed = await client.get(
            f"{EXTRA_FIELDS_URL}?gtin={gtin}",
            headers=headers,
        )
        assert listed.status_code == 200
        item = listed.json()["items"][0]
        assert item["brand"] == "NewBrand"
        assert item["name"] == f"Name {gtin}"
        assert item["article"] == f"ART-{gtin[-2:]}"


@pytest.mark.asyncio
async def test_extra_fields_bulk_merge_extra(client, user_token):
    headers = {"Authorization": f"Bearer {user_token}"}
    gtin = "04600000000013"

    await client.post(
        EXTRA_FIELDS_URL,
        headers=headers,
        json={"gtin": gtin, "extra": {"phone": "+7900", "custom_key": "keep"}},
    )

    bulk = await client.post(
        f"{EXTRA_FIELDS_URL}bulk",
        headers=headers,
        json={
            "gtins": [gtin],
            "fields": {"extra": {"manufacturer": "ООО Ромашка", "phone": ""}},
        },
    )
    assert bulk.status_code == 200
    assert bulk.json() == {"updated": 1, "created": 0, "total": 1}

    listed = await client.get(
        f"{EXTRA_FIELDS_URL}?gtin={gtin}",
        headers=headers,
    )
    assert listed.json()["items"][0]["extra"] == {
        "phone": "+7900",
        "custom_key": "keep",
        "manufacturer": "ООО Ромашка",
    }


@pytest.mark.asyncio
async def test_extra_fields_bulk_creates_missing_gtins(client, user_token):
    headers = {"Authorization": f"Bearer {user_token}"}
    gtins = ["04600000000014", "04600000000015"]

    bulk = await client.post(
        f"{EXTRA_FIELDS_URL}bulk",
        headers=headers,
        json={
            "gtins": gtins,
            "fields": {"brand": "BulkBrand", "extra": {"manufacturer": "Maker"}},
        },
    )
    assert bulk.status_code == 200
    assert bulk.json() == {"updated": 0, "created": 2, "total": 2}

    for gtin in gtins:
        listed = await client.get(
            f"{EXTRA_FIELDS_URL}?gtin={gtin}",
            headers=headers,
        )
        item = listed.json()["items"][0]
        assert item["brand"] == "BulkBrand"
        assert item["extra"] == {"manufacturer": "Maker"}


@pytest.mark.asyncio
async def test_extra_fields_bulk_rejects_empty_fields(client, user_token):
    headers = {"Authorization": f"Bearer {user_token}"}
    bulk = await client.post(
        f"{EXTRA_FIELDS_URL}bulk",
        headers=headers,
        json={"gtins": ["04600000000016"], "fields": {"name": "", "brand": "  "}},
    )
    assert bulk.status_code == 400
