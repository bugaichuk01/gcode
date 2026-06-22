"""Тесты вывода из оборота."""
import pytest


@pytest.mark.asyncio
async def test_create_withdrawal_draft(client, user_token):
    """Создать черновик вывода из оборота."""
    response = await client.post(
        "/api/v1/withdrawal/",
        json={
            "marking_codes": [
                "010290000406494821test123456789\x1d91FFD0\x1d92dGVzdA=="
            ],
            "withdrawal_type": "SOLD",
            "product_group": "perfumery",
        },
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "draft"
    assert data["withdrawal_type"] == "SOLD"
    assert len(data["marking_codes"]) == 1


@pytest.mark.asyncio
async def test_withdrawal_requires_auth(client):
    """Без токена — 401."""
    response = await client.post(
        "/api/v1/withdrawal/",
        json={
            "marking_codes": ["test"],
            "withdrawal_type": "SOLD",
        },
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_withdrawal_empty_codes(client, user_token):
    """Пустой список кодов — 400."""
    response = await client.post(
        "/api/v1/withdrawal/",
        json={"marking_codes": [], "withdrawal_type": "SOLD"},
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_list_withdrawals(client, user_token):
    """Получить список выводов."""
    response = await client.get(
        "/api/v1/withdrawal/",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert response.status_code == 200
    assert isinstance(response.json(), list)
