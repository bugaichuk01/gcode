"""Тесты защиты стандартных шаблонов этикеток."""
from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from models import LabelTemplate

LABELS_URL = "/api/v1/labels/templates"

ORIGINAL_LAYOUT = {
    "elements": [{"type": "text", "x": 1, "y": 1, "text": "оригинал"}]
}
MUTATED_LAYOUT = {
    "elements": [{"type": "text", "x": 9, "y": 9, "text": "изменено"}]
}


async def _create_template(
    db_session: AsyncSession,
    *,
    name: str,
    is_default: bool,
    layout_data: dict | None = None,
) -> LabelTemplate:
    template = LabelTemplate(
        name=name,
        width_mm=58,
        height_mm=40,
        layout_data=layout_data or ORIGINAL_LAYOUT,
        is_default=is_default,
        org_id=None,
    )
    db_session.add(template)
    await db_session.commit()
    await db_session.refresh(template)
    return template


def _auth_headers(user_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {user_token}"}


def _update_payload(
    *,
    name: str = "изменённое имя",
    layout_data: dict | None = None,
    is_default: bool | None = None,
) -> dict:
    payload = {
        "name": name,
        "width_mm": 58,
        "height_mm": 40,
        "layout_data": layout_data or MUTATED_LAYOUT,
    }
    if is_default is not None:
        payload["is_default"] = is_default
    return payload


@pytest.mark.asyncio
async def test_put_default_template_returns_409_and_keeps_original(
    client, db_session, user_token
):
    """PUT на is_default=true → 409, оригинал в БД не изменён."""
    template = await _create_template(
        db_session,
        name="Стандарт 58×40мм",
        is_default=True,
    )

    response = await client.put(
        f"{LABELS_URL}/{template.id}",
        json=_update_payload(name="взломанное имя"),
        headers=_auth_headers(user_token),
    )

    assert response.status_code == 409
    assert "сохраняется как новый" in response.json()["detail"]

    await db_session.refresh(template)
    assert template.name == "Стандарт 58×40мм"
    assert template.layout_data == ORIGINAL_LAYOUT
    assert template.is_default is True


@pytest.mark.asyncio
async def test_put_user_template_applies_changes_and_ignores_is_default_flag(
    client, db_session, user_token
):
    """PUT на пользовательский шаблон → 200, is_default из payload игнорируется."""
    template = await _create_template(
        db_session,
        name="Мой шаблон",
        is_default=False,
    )

    response = await client.put(
        f"{LABELS_URL}/{template.id}",
        json=_update_payload(name="Обновлённый шаблон", is_default=True),
        headers=_auth_headers(user_token),
    )

    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Обновлённый шаблон"
    assert data["layout_data"] == MUTATED_LAYOUT
    assert data["is_default"] is False

    await db_session.refresh(template)
    assert template.name == "Обновлённый шаблон"
    assert template.layout_data == MUTATED_LAYOUT
    assert template.is_default is False


@pytest.mark.asyncio
async def test_delete_default_template_returns_409_and_keeps_row(
    client, db_session, user_token
):
    """DELETE на is_default=true → 409, шаблон остаётся в БД."""
    template = await _create_template(
        db_session,
        name="Стандарт для удаления",
        is_default=True,
    )

    response = await client.delete(
        f"{LABELS_URL}/{template.id}",
        headers=_auth_headers(user_token),
    )

    assert response.status_code == 409
    assert "нельзя удалить" in response.json()["detail"]

    still_there = await db_session.get(LabelTemplate, template.id)
    assert still_there is not None
    assert still_there.is_default is True


@pytest.mark.asyncio
async def test_delete_user_template_succeeds(client, db_session, user_token):
    """DELETE на пользовательский шаблон → успех, запись удалена."""
    template = await _create_template(
        db_session,
        name="Удаляемый шаблон",
        is_default=False,
    )
    template_id = template.id

    response = await client.delete(
        f"{LABELS_URL}/{template_id}",
        headers=_auth_headers(user_token),
    )

    assert response.status_code == 204

    deleted = await db_session.get(LabelTemplate, template_id)
    assert deleted is None
