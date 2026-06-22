"""Тесты организаций."""
import pytest


@pytest.mark.asyncio
async def test_create_organization(client, user_token):
    """Создать организацию."""
    response = await client.post(
        "/api/v1/organizations/",
        json={"name": "ООО Тест", "inn": "1234567890"},
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "ООО Тест"
    assert data["inn"] == "1234567890"


@pytest.mark.asyncio
async def test_list_organizations(client, user_token):
    """Получить список организаций."""
    await client.post(
        "/api/v1/organizations/",
        json={"name": "ООО Список"},
        headers={"Authorization": f"Bearer {user_token}"},
    )
    response = await client.get(
        "/api/v1/organizations/",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_organizations_isolation(client):
    """Пользователи не видят организации друг друга."""
    reg1 = await client.post(
        "/api/v1/auth/register",
        json={"username": "iso_user1", "password": "pass123"},
    )
    token1 = reg1.json()["access_token"]
    await client.post(
        "/api/v1/organizations/",
        json={"name": "Орг пользователя 1"},
        headers={"Authorization": f"Bearer {token1}"},
    )

    reg2 = await client.post(
        "/api/v1/auth/register",
        json={"username": "iso_user2", "password": "pass123"},
    )
    token2 = reg2.json()["access_token"]

    response = await client.get(
        "/api/v1/organizations/",
        headers={"Authorization": f"Bearer {token2}"},
    )
    orgs = response.json()
    assert all(org["name"] != "Орг пользователя 1" for org in orgs)
