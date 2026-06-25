"""Сохранение и доступ к PDF пакетной печати этикеток (label_pdf_files)."""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from labels.field_catalog import PrintContext
from models import LabelPdfFile, Organization

PDF_FILES_LIST_LIMIT = 50


def iter_label_chunks(total_pages: int, pages_per_file: int) -> list[tuple[int, int]]:
    """Диапазоны (start, end) страниц для разбивки на части."""
    if total_pages <= 0:
        return []
    chunks: list[tuple[int, int]] = []
    start = 0
    while start < total_pages:
        end = min(start + pages_per_file, total_pages)
        chunks.append((start, end))
        start = end
    return chunks


def build_print_context(
    global_index: int,
    chunk_start: int,
    chunk_len: int,
    total_pages: int,
    start_number: int,
    continuous_numbering: bool,
    *,
    barcode_type: str = "ean13",
    barcode_column: str = "gtin",
    barcode_keep_leading_zero: bool = True,
    barcode_from_extra: bool = False,
    kitu_code: str = "",
) -> PrintContext:
    """Контекст нумерации для одной страницы.

    continuous_numbering=True:
      label_index — глобальный 0-based индекс по всему пакету;
      label_number = start_number + label_index (сквозная нумерация между файлами).

    continuous_numbering=False:
      label_index — локальный 0-based индекс внутри текущего файла;
      label_number = start_number + label_index (каждый файл с start_number).
    """
    if continuous_numbering:
        label_index = global_index
        total = total_pages
    else:
        label_index = global_index - chunk_start
        total = chunk_len
    return PrintContext(
        label_index=label_index,
        label_number=start_number + label_index,
        total=total,
        barcode_type=barcode_type,
        barcode_column=barcode_column,
        barcode_keep_leading_zero=barcode_keep_leading_zero,
        barcode_from_extra=barcode_from_extra,
        kitu_code=kitu_code,
    )


def build_label_pdf_filename(
    codes_count: int,
    pdf_bytes: bytes,
    now: datetime | None = None,
    part_index: int | None = None,
) -> str:
    """Имя файла: ДД.ММ.ГГГГ_ЧЧ.ММ.СС_Nшт_hash.pdf или ..._частьK.pdf"""
    ts = (now or datetime.now(timezone.utc)).strftime("%d.%m.%Y_%H.%M.%S")
    digest = hashlib.sha256(pdf_bytes).hexdigest()[:8]
    base = f"{ts}_{codes_count}шт_{digest}"
    if part_index is not None:
        base = f"{base}_часть{part_index}"
    return f"{base}.pdf"


def user_can_access_label_pdf_file(
    pdf_file: LabelPdfFile,
    org: Organization | None,
) -> bool:
    if pdf_file.org_id is None:
        return True
    if org is None:
        return False
    return pdf_file.org_id == org.id


async def save_label_pdf_file(
    db: AsyncSession,
    pdf_bytes: bytes,
    org: Organization | None,
    pages_count: int,
    codes_count: int,
    template_id: UUID | None = None,
    filename: str | None = None,
) -> LabelPdfFile:
    record = LabelPdfFile(
        org_id=org.id if org else None,
        filename=filename or build_label_pdf_filename(codes_count, pdf_bytes),
        data=pdf_bytes,
        pages_count=pages_count,
        codes_count=codes_count,
        template_id=template_id,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


async def list_label_pdf_files_for_org(
    db: AsyncSession,
    org: Organization | None,
    limit: int = PDF_FILES_LIST_LIMIT,
) -> list[LabelPdfFile]:
    if org is None:
        return []
    result = await db.execute(
        select(LabelPdfFile)
        .where(LabelPdfFile.org_id == org.id)
        .order_by(LabelPdfFile.created_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def get_label_pdf_file_for_user(
    db: AsyncSession,
    file_id: UUID,
    org: Organization | None,
) -> LabelPdfFile:
    pdf_file = await db.get(LabelPdfFile, file_id)
    if not pdf_file or not user_can_access_label_pdf_file(pdf_file, org):
        raise HTTPException(status_code=404, detail="PDF-файл не найден")
    return pdf_file


async def delete_label_pdf_file_for_user(
    db: AsyncSession,
    file_id: UUID,
    org: Organization | None,
) -> None:
    pdf_file = await get_label_pdf_file_for_user(db, file_id, org)
    await db.delete(pdf_file)
    await db.commit()
