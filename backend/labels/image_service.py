"""Загрузка и доступ к изображениям этикеток (label_images)."""
from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import LabelImage, Organization

MAX_LABEL_IMAGE_BYTES = 1 * 1024 * 1024
ALLOWED_LABEL_IMAGE_MIMES = frozenset(
    {"image/png", "image/jpeg", "image/svg+xml"}
)


def validate_label_image_upload(content: bytes, content_type: str | None) -> str:
    """Проверяет mime и размер; возвращает нормализованный mime."""
    mime = (content_type or "").split(";")[0].strip().lower()
    if mime not in ALLOWED_LABEL_IMAGE_MIMES:
        raise HTTPException(
            status_code=400,
            detail="Допустимые форматы: PNG, JPEG, SVG",
        )
    if len(content) > MAX_LABEL_IMAGE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Размер файла не должен превышать {MAX_LABEL_IMAGE_BYTES // 1024} КБ",
        )
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Пустой файл")
    return mime


async def save_label_image(
    db: AsyncSession,
    content: bytes,
    mime: str,
    org: Organization | None,
    filename: str | None = None,
) -> LabelImage:
    image = LabelImage(
        mime=mime,
        data=content,
        filename=filename,
        org_id=org.id if org else None,
    )
    db.add(image)
    await db.commit()
    await db.refresh(image)
    return image


def user_can_access_label_image(
    image: LabelImage,
    org: Organization | None,
) -> bool:
    if image.org_id is None:
        return True
    if org is None:
        return False
    return image.org_id == org.id


async def get_label_image_for_user(
    db: AsyncSession,
    image_id: UUID,
    org: Organization | None,
) -> LabelImage:
    image = await db.get(LabelImage, image_id)
    if not image or not user_can_access_label_image(image, org):
        raise HTTPException(status_code=404, detail="Изображение не найдено")
    return image


def collect_image_ids_from_layout(layout_data: dict | None) -> set[UUID]:
    if not layout_data:
        return set()
    ids: set[UUID] = set()
    for el in layout_data.get("elements") or []:
        if el.get("type") != "image":
            continue
        raw_id = el.get("image_id")
        if not raw_id:
            continue
        try:
            ids.add(UUID(str(raw_id)))
        except (ValueError, TypeError):
            continue
    return ids


async def load_label_images_cache(
    db: AsyncSession,
    layout_data: dict | None,
    org: Organization | None,
) -> dict[str, bytes]:
    """Предзагрузка бинарей изображений для batch-печати (кэш по image_id)."""
    image_ids = collect_image_ids_from_layout(layout_data)
    if not image_ids:
        return {}

    result = await db.execute(
        select(LabelImage).where(LabelImage.id.in_(image_ids))
    )
    cache: dict[str, bytes] = {}
    for image in result.scalars().all():
        if user_can_access_label_image(image, org):
            cache[str(image.id)] = bytes(image.data)
    return cache


async def read_upload_file(file: UploadFile) -> bytes:
    content = await file.read()
    if len(content) > MAX_LABEL_IMAGE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Размер файла не должен превышать {MAX_LABEL_IMAGE_BYTES // 1024} КБ",
        )
    return content
