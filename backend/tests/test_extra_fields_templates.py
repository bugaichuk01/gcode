"""Тесты шаблонов автозаполнения доп. полей."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from models import ExtraFieldsTemplate

EXTRA_FIELDS_URL = "/api/v1/extra-fields/"
TEMPLATES_URL = f"{EXTRA_FIELDS_URL}templates"


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


@pytest.mark.asyncio
async def test_create_template_stores_only_filled_fields(client):
    token, _org_id = await _register_with_org(client)
    headers = _auth_headers(token)
    response = await client.post(
        TEMPLATES_URL,
        headers=headers,
        json={
            "name": "Реквизиты MZ",
            "fields": {
                "edo_inn": "7701234567",
                "edo_address": "Москва",
                "name": "",
                "extra": {"manufacturer": "ООО Ромашка", "phone": ""},
            },
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Реквизиты MZ"
    assert body["fields"] == {
        "edo_inn": "7701234567",
        "edo_address": "Москва",
        "extra": {"manufacturer": "ООО Ромашка"},
    }


@pytest.mark.asyncio
async def test_create_template_rejects_empty_fields(client):
    token, _org_id = await _register_with_org(client)
    headers = _auth_headers(token)
    response = await client.post(
        TEMPLATES_URL,
        headers=headers,
        json={"name": "Пустой", "fields": {"name": "", "brand": "  "}},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_upsert_template_by_name_updates_fields(client):
    token, _org_id = await _register_with_org(client)
    headers = _auth_headers(token)

    first = await client.post(
        TEMPLATES_URL,
        headers=headers,
        json={"name": "Реквизиты MZ", "fields": {"edo_inn": "1111111111"}},
    )
    assert first.status_code == 200
    template_id = first.json()["id"]

    second = await client.post(
        TEMPLATES_URL,
        headers=headers,
        json={
            "name": "Реквизиты MZ",
            "fields": {"edo_inn": "2222222222", "edo_address": "СПб"},
        },
    )
    assert second.status_code == 200
    body = second.json()
    assert body["id"] == template_id
    assert body["fields"] == {"edo_inn": "2222222222", "edo_address": "СПб"}

    listed = await client.get(TEMPLATES_URL, headers=headers)
    assert listed.status_code == 200
    assert len(listed.json()) == 1


@pytest.mark.asyncio
async def test_list_and_get_template(client):
    token, _org_id = await _register_with_org(client)
    headers = _auth_headers(token)
    created = await client.post(
        TEMPLATES_URL,
        headers=headers,
        json={"name": "Бренд", "fields": {"brand": "MZ"}},
    )
    template_id = created.json()["id"]

    listed = await client.get(TEMPLATES_URL, headers=headers)
    assert listed.status_code == 200
    assert listed.json() == [
        {
            "id": template_id,
            "name": "Бренд",
            "created_at": created.json()["created_at"],
        }
    ]

    detail = await client.get(f"{TEMPLATES_URL}/{template_id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["fields"] == {"brand": "MZ"}


@pytest.mark.asyncio
async def test_delete_template(client):
    token, _org_id = await _register_with_org(client)
    headers = _auth_headers(token)
    created = await client.post(
        TEMPLATES_URL,
        headers=headers,
        json={"name": "Удаляемый", "fields": {"brand": "X"}},
    )
    template_id = created.json()["id"]

    deleted = await client.delete(f"{TEMPLATES_URL}/{template_id}", headers=headers)
    assert deleted.status_code == 200
    assert deleted.json() == {"success": True}

    listed = await client.get(TEMPLATES_URL, headers=headers)
    assert listed.json() == []


@pytest.mark.asyncio
async def test_templates_are_org_scoped(client, db_session):
    token_a, org_id_a = await _register_with_org(client)
    token_b, _org_id_b = await _register_with_org(client)
    headers_a = _auth_headers(token_a)
    headers_b = _auth_headers(token_b)

    created = await client.post(
        TEMPLATES_URL,
        headers=headers_a,
        json={"name": "Org A", "fields": {"brand": "A"}},
    )
    template_id = created.json()["id"]

    listed_b = await client.get(TEMPLATES_URL, headers=headers_b)
    assert listed_b.json() == []

    detail_b = await client.get(f"{TEMPLATES_URL}/{template_id}", headers=headers_b)
    assert detail_b.status_code == 404

    delete_b = await client.delete(f"{TEMPLATES_URL}/{template_id}", headers=headers_b)
    assert delete_b.status_code == 404

    result = await client.get(TEMPLATES_URL, headers=headers_a)
    assert len(result.json()) == 1

    stored = await db_session.scalar(
        select(ExtraFieldsTemplate).where(ExtraFieldsTemplate.id == uuid.UUID(template_id))
    )
    assert stored is not None
    assert stored.org_id == org_id_a


@pytest.mark.asyncio
async def test_template_fields_work_with_bulk_apply(client):
    token, _org_id = await _register_with_org(client)
    headers = _auth_headers(token)
    gtins = ["04600000000020", "04600000000021"]

    template = await client.post(
        TEMPLATES_URL,
        headers=headers,
        json={
            "name": "Реквизиты",
            "fields": {
                "edo_inn": "7701234567",
                "extra": {"manufacturer": "ООО Ромашка"},
            },
        },
    )
    fields = template.json()["fields"]

    bulk = await client.post(
        f"{EXTRA_FIELDS_URL}bulk",
        headers=headers,
        json={"gtins": gtins, "fields": fields},
    )
    assert bulk.status_code == 200
    assert bulk.json() == {"updated": 0, "created": 2, "total": 2}

    for gtin in gtins:
        listed = await client.get(f"{EXTRA_FIELDS_URL}?gtin={gtin}", headers=headers)
        item = listed.json()["items"][0]
        assert item["edo_inn"] == "7701234567"
        assert item["extra"] == {"manufacturer": "ООО Ромашка"}
