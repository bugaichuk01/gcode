"""Последовательная печать КИТУ + вложений (разные макеты на страницу)."""
from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from labels.field_catalog import PrintContext
from labels.font_registry import register_fonts
from labels.image_service import load_label_images_cache
from labels.pdf_service import (
    build_label_pdf_filename,
    build_print_context,
    iter_label_chunks,
    save_label_pdf_file,
)
from models import AggregationDocument, GtinExtraFields, LabelTemplate, Organization, ProductCard
from schemas import LabelPdfSplitFileItem, LabelPdfSplitResponse
from services.aggregation_service import AGGREGATION_TYPE_KITU
from utils.marking_code import CRYPTO_TAIL_PRINT_ERROR, codes_without_crypto_tail

MAX_AGGREGATION_PAGES = 500


@dataclass(frozen=True)
class LabelPageJob:
    code: str
    kind: str  # kitu | km
    layout_data: dict | None
    width_mm: int
    height_mm: int
    gtin: str | None
    barcode_type: str
    barcode_column: str
    barcode_keep_leading_zero: bool
    barcode_from_extra: bool
    kitu_code: str = ""
    kitu_index: int = 0
    kitu_total: int = 0
    items_in_kitu: int = 0
    item_number_in_kitu: int = 0


def _validate_kitu_codes(codes: list[str]) -> None:
    invalid: list[str] = []
    for code in codes:
        stripped = code.strip()
        if len(stripped) != 18 or not stripped.isdigit():
            invalid.append(code)
    if invalid:
        raise HTTPException(
            status_code=400,
            detail="КИТУ должен быть 18-значным SSCC (только цифры)",
        )


def _reject_codes_without_crypto_tail(codes: list[str]) -> None:
    invalid = codes_without_crypto_tail(codes)
    if invalid:
        raise HTTPException(status_code=400, detail=CRYPTO_TAIL_PRINT_ERROR)


def build_aggregation_page_jobs(
    groups: list[tuple[str, list[str]]],
    *,
    kitu_layout: dict | None,
    kitu_width_mm: int,
    kitu_height_mm: int,
    unit_layout: dict | None,
    unit_width_mm: int,
    unit_height_mm: int,
    unit_barcode_type: str,
    unit_barcode_column: str,
    unit_barcode_keep_leading_zero: bool,
    unit_barcode_from_extra: bool,
    extract_gtin,
) -> list[LabelPageJob]:
    """Порядок: [КИТУ_1, вложения_1...], [КИТУ_2, вложения_2...]."""
    jobs: list[LabelPageJob] = []
    kitu_total = len(groups)
    for kitu_index, (kitu_code, marking_codes) in enumerate(groups, start=1):
        kitu = kitu_code.strip()
        unit_codes = [raw_code.strip() for raw_code in marking_codes if raw_code.strip()]
        items_in_kitu = len(unit_codes)
        jobs.append(
            LabelPageJob(
                code=kitu,
                kind="kitu",
                layout_data=kitu_layout,
                width_mm=kitu_width_mm,
                height_mm=kitu_height_mm,
                gtin=None,
                barcode_type="code128",
                barcode_column="kitu_code",
                barcode_keep_leading_zero=True,
                barcode_from_extra=False,
                kitu_code=kitu,
                kitu_index=kitu_index,
                kitu_total=kitu_total,
                items_in_kitu=items_in_kitu,
                item_number_in_kitu=0,
            )
        )
        for item_number_in_kitu, code in enumerate(unit_codes, start=1):
            jobs.append(
                LabelPageJob(
                    code=code,
                    kind="km",
                    layout_data=unit_layout,
                    width_mm=unit_width_mm,
                    height_mm=unit_height_mm,
                    gtin=extract_gtin(code),
                    barcode_type=unit_barcode_type,
                    barcode_column=unit_barcode_column,
                    barcode_keep_leading_zero=unit_barcode_keep_leading_zero,
                    barcode_from_extra=unit_barcode_from_extra,
                    kitu_code=kitu,
                    kitu_index=kitu_index,
                    kitu_total=kitu_total,
                    items_in_kitu=items_in_kitu,
                    item_number_in_kitu=item_number_in_kitu,
                )
            )
    return jobs


def build_aggregation_print_context(
    job: LabelPageJob,
    *,
    global_index: int,
    chunk_start: int,
    chunk_len: int,
    total_pages: int,
    start_number: int,
    continuous_numbering: bool,
) -> PrintContext:
    """Контекст печати для страницы последовательной печати КИТУ + вложений."""
    base = build_print_context(
        global_index=global_index,
        chunk_start=chunk_start,
        chunk_len=chunk_len,
        total_pages=total_pages,
        start_number=start_number,
        continuous_numbering=continuous_numbering,
        barcode_type=job.barcode_type,
        barcode_column=job.barcode_column,
        barcode_keep_leading_zero=job.barcode_keep_leading_zero,
        barcode_from_extra=job.barcode_from_extra,
        kitu_code=job.kitu_code,
    )
    if job.kind == "km" and job.item_number_in_kitu > 0:
        label_index = job.item_number_in_kitu - 1
        label_number = start_number + label_index
        total = job.items_in_kitu
    else:
        label_index = base.label_index
        label_number = base.label_number
        total = base.total
    return PrintContext(
        label_index=label_index,
        label_number=label_number,
        total=total,
        barcode_type=base.barcode_type,
        barcode_column=base.barcode_column,
        barcode_keep_leading_zero=base.barcode_keep_leading_zero,
        barcode_from_extra=base.barcode_from_extra,
        kitu_code=job.kitu_code,
        kitu_index=job.kitu_index or None,
        kitu_total=job.kitu_total or None,
        items_in_kitu=job.items_in_kitu or None,
        item_number_in_kitu=job.item_number_in_kitu or None,
        label_kind=job.kind,
    )


async def resolve_aggregation_print_groups(
    db: AsyncSession,
    org: Organization | None,
    *,
    doc_ids: list[UUID] | None,
    kitu_codes: list[str] | None,
) -> list[tuple[str, list[str]]]:
    if doc_ids:
        groups: list[tuple[str, list[str]]] = []
        for doc_id in doc_ids:
            doc = await db.get(AggregationDocument, doc_id)
            if doc is None:
                raise HTTPException(status_code=404, detail="Документ агрегации не найден")
            if org is not None and doc.org_id is not None and doc.org_id != org.id:
                raise HTTPException(status_code=404, detail="Документ агрегации не найден")
            if (doc.aggregation_type or AGGREGATION_TYPE_KITU) != AGGREGATION_TYPE_KITU:
                raise HTTPException(
                    status_code=400,
                    detail=f"Документ {doc.kitu_code} не является агрегацией КИТУ",
                )
            groups.append((doc.kitu_code, list(doc.marking_codes or [])))
        return groups

    if not kitu_codes:
        raise HTTPException(status_code=400, detail="Укажите doc_ids или kitu_codes")

    groups = []
    for raw_kitu in kitu_codes:
        kitu = raw_kitu.strip()
        if not kitu:
            continue
        q = (
            select(AggregationDocument)
            .where(
                AggregationDocument.kitu_code == kitu,
                AggregationDocument.aggregation_type == AGGREGATION_TYPE_KITU,
            )
            .order_by(AggregationDocument.created_at.desc())
            .limit(1)
        )
        if org is not None:
            q = q.where(AggregationDocument.org_id == org.id)
        doc = await db.scalar(q)
        if doc is None:
            raise HTTPException(
                status_code=404,
                detail=f"Документ агрегации для КИТУ {kitu} не найден",
            )
        groups.append((doc.kitu_code, list(doc.marking_codes or [])))
    if not groups:
        raise HTTPException(status_code=400, detail="Список КИТУ пуст")
    return groups


async def _load_template(
    db: AsyncSession,
    template_id: UUID,
    *,
    label: str,
) -> LabelTemplate:
    template = await db.get(LabelTemplate, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail=f"Шаблон {label} не найден")
    return template


async def generate_aggregation_labels_pdf(
    db: AsyncSession,
    org: Organization | None,
    jobs: list[LabelPageJob],
    *,
    start_number: int,
    continuous_numbering: bool,
    split_files: bool,
    pages_per_file: int,
    save: bool,
    kitu_template_id: UUID,
    unit_template_id: UUID,
    draw_label_fn,
) -> tuple[bytes | None, LabelPdfSplitResponse | None, int]:
    """Рендер PDF с разными размерами страниц. Возвращает inline bytes или split payload."""
    register_fonts()
    if not jobs:
        raise HTTPException(status_code=400, detail="Нет страниц для печати")
    if len(jobs) > MAX_AGGREGATION_PAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Максимум {MAX_AGGREGATION_PAGES} этикеток за один запрос",
        )
    if start_number < 1:
        raise HTTPException(status_code=400, detail="Стартовый номер: от 1")
    if split_files and pages_per_file < 1:
        raise HTTPException(status_code=400, detail="Страниц в файле: от 1")

    total_pages = len(jobs)
    km_codes = [job.code for job in jobs if job.kind == "km"]
    kitu_codes = [job.code for job in jobs if job.kind == "kitu"]
    _reject_codes_without_crypto_tail(km_codes)
    _validate_kitu_codes(kitu_codes)

    extra_fields_cache: dict[str, GtinExtraFields] = {}
    product_card_cache: dict[str, ProductCard] = {}
    gtins = list({job.gtin for job in jobs if job.gtin})
    if gtins:
        q = select(GtinExtraFields).where(GtinExtraFields.gtin.in_(gtins))
        if org:
            q = q.where(GtinExtraFields.org_id == org.id)
        result = await db.execute(q)
        for ef in result.scalars().all():
            extra_fields_cache[ef.gtin] = ef

        q_pc = select(ProductCard).where(ProductCard.gtin.in_(gtins))
        if org:
            q_pc = q_pc.where(ProductCard.org_id == org.id)
        result_pc = await db.execute(q_pc)
        for pc in result_pc.scalars().all():
            if pc.gtin:
                product_card_cache[pc.gtin] = pc

    image_cache: dict[str, bytes] = {}
    layouts = [job.layout_data for job in jobs if job.layout_data]
    seen_layout_ids: set[int] = set()
    for layout in layouts:
        layout_key = id(layout)
        if layout_key in seen_layout_ids:
            continue
        seen_layout_ids.add(layout_key)
        partial = await load_label_images_cache(db, layout, org)
        image_cache.update(partial)

    def render_chunk_pdf(chunk_start: int, chunk_end: int) -> bytes:
        buf = io.BytesIO()
        first = jobs[chunk_start]
        c = canvas.Canvas(buf, pagesize=(first.width_mm * mm, first.height_mm * mm))
        chunk_len = chunk_end - chunk_start

        for local_i, global_index in enumerate(range(chunk_start, chunk_end)):
            job = jobs[global_index]
            page_w = job.width_mm * mm
            page_h = job.height_mm * mm
            if local_i > 0:
                c.showPage()
            c.setPageSize((page_w, page_h))

            print_context = build_aggregation_print_context(
                job,
                global_index=global_index,
                chunk_start=chunk_start,
                chunk_len=chunk_len,
                total_pages=total_pages,
                start_number=start_number,
                continuous_numbering=continuous_numbering,
            )
            ef = extra_fields_cache.get(job.gtin) if job.gtin else None
            product_card = product_card_cache.get(job.gtin) if job.gtin else None
            draw_label_fn(
                c,
                job.code,
                job.gtin,
                ef,
                product_card,
                job.layout_data,
                page_h,
                page_w,
                image_cache,
                print_context,
            )

        c.save()
        buf.seek(0)
        return buf.read()

    if split_files:
        chunks = iter_label_chunks(total_pages, pages_per_file)
        now = datetime.now(timezone.utc)
        saved_files: list[LabelPdfSplitFileItem] = []

        for part_index, (chunk_start, chunk_end) in enumerate(chunks, start=1):
            pdf_bytes = render_chunk_pdf(chunk_start, chunk_end)
            chunk_pages = chunk_end - chunk_start
            filename = build_label_pdf_filename(
                chunk_pages,
                pdf_bytes,
                now=now,
                part_index=part_index if len(chunks) > 1 else None,
            )
            if save:
                record = await save_label_pdf_file(
                    db,
                    pdf_bytes,
                    org,
                    pages_count=chunk_pages,
                    codes_count=chunk_pages,
                    template_id=unit_template_id,
                    filename=filename,
                )
                saved_files.append(
                    LabelPdfSplitFileItem(
                        id=record.id,
                        filename=record.filename,
                        pages_count=record.pages_count,
                    )
                )
        return None, LabelPdfSplitResponse(files=saved_files), total_pages

    pdf_bytes = render_chunk_pdf(0, total_pages)
    if save:
        await save_label_pdf_file(
            db,
            pdf_bytes,
            org,
            pages_count=total_pages,
            codes_count=total_pages,
            template_id=unit_template_id,
        )
    return pdf_bytes, None, total_pages
