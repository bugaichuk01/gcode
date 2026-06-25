"""Тесты проверки уникальности КИТУ через True API /cises/info."""
from unittest.mock import AsyncMock, patch

import pytest

from services.suz_integration_service import (
    CIS_INFO_BATCH_SIZE,
    check_kitu_uniqueness,
)


@pytest.mark.asyncio
async def test_check_kitu_uniqueness_maps_404_to_unique():
    mock_batch = AsyncMock(
        return_value=[
            {
                "cis": "346000000001234567",
                "status": "not_found",
                "error": "КИ не найден",
            }
        ]
    )
    with patch(
        "services.suz_integration_service.check_cis_statuses_batch",
        mock_batch,
    ):
        results = await check_kitu_uniqueness(
            ["346000000001234567"],
            product_group="perfumery",
        )
    assert len(results) == 1
    assert results[0]["kitu_code"] == "346000000001234567"
    assert results[0]["status"] == "unique"
    mock_batch.assert_awaited_once_with(
        ["346000000001234567"],
        db=None,
        pg="perfumery",
    )


@pytest.mark.asyncio
async def test_check_kitu_uniqueness_maps_cis_info_to_exists():
    mock_batch = AsyncMock(
        return_value=[
            {
                "cis": "346000000009876543",
                "status": "INTRODUCED",
                "gtin": "04600000000001",
            }
        ]
    )
    with patch(
        "services.suz_integration_service.check_cis_statuses_batch",
        mock_batch,
    ):
        results = await check_kitu_uniqueness(
            ["346000000009876543"],
            product_group="perfumery",
        )
    assert results[0]["status"] == "exists"
    assert "INTRODUCED" in results[0]["detail"]


@pytest.mark.asyncio
async def test_check_kitu_uniqueness_maps_error():
    mock_batch = AsyncMock(
        return_value=[
            {
                "cis": "346000000001111111",
                "status": "error",
                "error": "TRUE_API_TOKEN не настроен",
            }
        ]
    )
    with patch(
        "services.suz_integration_service.check_cis_statuses_batch",
        mock_batch,
    ):
        results = await check_kitu_uniqueness(
            ["346000000001111111"],
            product_group="perfumery",
        )
    assert results[0]["status"] == "error"
    assert "TRUE_API_TOKEN" in results[0]["detail"]


@pytest.mark.asyncio
async def test_check_kitu_uniqueness_batches_over_limit():
    codes = [f"3460000000{i:08d}" for i in range(CIS_INFO_BATCH_SIZE + 3)]
    mock_batch = AsyncMock(
        side_effect=lambda batch, **kwargs: [
            {"cis": c, "status": "not_found", "error": "КИ не найден"} for c in batch
        ]
    )
    with patch(
        "services.suz_integration_service.check_cis_statuses_batch",
        mock_batch,
    ):
        results = await check_kitu_uniqueness(codes, product_group="perfumery")
    assert len(results) == len(codes)
    assert mock_batch.await_count == 2
    assert all(r["status"] == "unique" for r in results)


@pytest.mark.asyncio
async def test_check_kitu_uniqueness_endpoint(client, user_token):
    with patch(
        "routers.aggregation.check_kitu_uniqueness",
        AsyncMock(
            return_value=[
                {
                    "kitu_code": "346000000001234567",
                    "status": "unique",
                    "detail": "КИ не найден",
                },
                {
                    "kitu_code": "346000000009876543",
                    "status": "exists",
                    "detail": "Статус в ЧЗ: APPLIED",
                },
            ]
        ),
    ):
        response = await client.post(
            "/api/v1/aggregation/check-kitu-uniqueness",
            headers={"Authorization": f"Bearer {user_token}"},
            json={
                "kitu_codes": ["346000000001234567", "346000000009876543"],
                "product_group": "perfumery",
            },
        )
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 2
    assert data["unique_count"] == 1
    assert data["exists_count"] == 1
    assert data["error_count"] == 0
