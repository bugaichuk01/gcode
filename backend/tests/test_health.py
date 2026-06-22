"""Тесты базового функционала."""
import pytest


@pytest.mark.asyncio
async def test_health(client):
    """Health check должен возвращать 200."""
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_docs_available(client):
    """Swagger документация доступна."""
    response = await client.get("/docs")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_openapi_json(client):
    """OpenAPI схема доступна."""
    response = await client.get("/openapi.json")
    assert response.status_code == 200
    data = response.json()
    assert data["info"]["title"] == "G-CODE API"
    assert "BearerAuth" in data["components"]["securitySchemes"]
