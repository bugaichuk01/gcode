"""Тесты аутентификации."""
import pytest


@pytest.mark.asyncio
async def test_register_success(client):
    """Регистрация нового пользователя."""
    response = await client.post(
        "/api/v1/auth/register",
        json={"username": "newuser", "password": "password123"},
    )
    assert response.status_code == 201
    data = response.json()
    assert "access_token" in data
    assert data["username"] == "newuser"
    assert data["role"] == "user"


@pytest.mark.asyncio
async def test_register_duplicate(client):
    """Нельзя зарегистрировать двух пользователей с одинаковым логином."""
    await client.post(
        "/api/v1/auth/register",
        json={"username": "duplicate", "password": "password123"},
    )
    response = await client.post(
        "/api/v1/auth/register",
        json={"username": "duplicate", "password": "password456"},
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_register_short_password(client):
    """Пароль менее 6 символов — ошибка."""
    response = await client.post(
        "/api/v1/auth/register",
        json={"username": "shortpass", "password": "123"},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_login_success(client):
    """Успешный вход."""
    await client.post(
        "/api/v1/auth/register",
        json={"username": "logintest", "password": "password123"},
    )
    response = await client.post(
        "/api/v1/auth/login",
        json={"username": "logintest", "password": "password123"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_login_wrong_password(client):
    """Неверный пароль."""
    await client.post(
        "/api/v1/auth/register",
        json={"username": "wrongpass", "password": "correctpass"},
    )
    response = await client.post(
        "/api/v1/auth/login",
        json={"username": "wrongpass", "password": "wrongpass"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_me(client, user_token):
    """Получить профиль текущего пользователя."""
    response = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "username" in data
    assert "role" in data


@pytest.mark.asyncio
async def test_get_me_unauthorized(client):
    """Без токена — 401."""
    response = await client.get("/api/v1/auth/me")
    assert response.status_code == 401
