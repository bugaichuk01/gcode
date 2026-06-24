"""Тесты генерации партии КИТУ/SSCC."""
import pytest

from services.aggregation_service import (
    DEFAULT_KITU_GCP,
    generate_kitu_batch,
    generate_kitu_code,
    normalize_kitu_gcp,
    validate_kitu_extension,
    verify_sscc_check_digit,
)


def test_gs1_check_digit_known():
    code = generate_kitu_code(gcp="460000000", extension=0, serial="1234567")
    assert verify_sscc_check_digit(code)


def test_generate_kitu_code_default_extension():
    code = generate_kitu_code()
    assert len(code) == 18
    assert code.isdigit()
    assert code[0] == "0"
    assert verify_sscc_check_digit(code)


def test_generate_kitu_code_extension_3():
    code = generate_kitu_code(gcp="460000000", extension=3)
    assert code[0] == "3"
    assert verify_sscc_check_digit(code)


@pytest.mark.parametrize("ext", range(10))
def test_extension_validation_0_to_9(ext: int):
    assert validate_kitu_extension(ext) == str(ext)


def test_extension_validation_rejects_out_of_range():
    with pytest.raises(ValueError, match="0 до 9"):
        validate_kitu_extension(10)


def test_normalize_gcp_pads_to_9():
    assert normalize_kitu_gcp("460") == "460000000"
    assert normalize_kitu_gcp(DEFAULT_KITU_GCP) == "460000000"


def test_generate_kitu_batch_count_and_uniqueness():
    items = generate_kitu_batch(
        gcp="460000000",
        extension=3,
        count=5,
        units_per_kitu=10,
        unlimited=False,
    )
    assert len(items) == 5
    codes = [item["kitu_code"] for item in items]
    assert len(set(codes)) == 5
    for item in items:
        code = item["kitu_code"]
        assert len(code) == 18
        assert code[0] == "3"
        assert verify_sscc_check_digit(code)
        assert item["units_capacity"] == 10


def test_generate_kitu_batch_unlimited():
    items = generate_kitu_batch(
        gcp="460000000",
        extension=0,
        count=3,
        unlimited=True,
    )
    assert all(item["units_capacity"] is None for item in items)


def test_generate_kitu_batch_requires_units_when_not_unlimited():
    with pytest.raises(ValueError, match="без ограничений"):
        generate_kitu_batch(count=1, unlimited=False, units_per_kitu=None)


@pytest.mark.asyncio
async def test_generate_kitu_batch_endpoint(client, user_token):
    response = await client.post(
        "/api/v1/aggregation/generate-kitu-batch",
        json={
            "gcp": "460000000",
            "extension": 3,
            "count": 5,
            "units_per_kitu": 10,
            "unlimited": False,
        },
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["extension"] == 3
    assert data["gcp"] == "460000000"
    assert len(data["items"]) == 5
    codes = [item["kitu_code"] for item in data["items"]]
    assert len(set(codes)) == 5
    for item in data["items"]:
        assert item["kitu_code"][0] == "3"
        assert verify_sscc_check_digit(item["kitu_code"])
        assert item["units_capacity"] == 10


@pytest.mark.asyncio
async def test_generate_kitu_batch_unlimited_endpoint(client, user_token):
    response = await client.post(
        "/api/v1/aggregation/generate-kitu-batch",
        json={
            "gcp": "460000000",
            "extension": 0,
            "count": 2,
            "unlimited": True,
        },
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert response.status_code == 200
    for item in response.json()["items"]:
        assert item["units_capacity"] is None


@pytest.mark.asyncio
async def test_get_generate_kitu_still_works(client, user_token):
    response = await client.get(
        "/api/v1/aggregation/generate-kitu",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert response.status_code == 200
    code = response.json()["kitu_code"]
    assert len(code) == 18
    assert verify_sscc_check_digit(code)
