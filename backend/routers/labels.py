import io
import logging
import re
from datetime import datetime, timezone
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from dependencies import get_current_org, get_current_user
from labels.aggregation_pdf_service import (
    build_aggregation_page_jobs,
    generate_aggregation_labels_pdf,
    resolve_aggregation_print_groups,
)
from labels.aggregation_system_barcodes_pdf import build_aggregation_system_barcodes_pdf
from labels.block_registry import draw_element_from_template
from labels.field_catalog import PrintContext
from labels.field_catalog import field_catalog_metadata
from labels.font_registry import register_fonts, resolve_font
from labels.image_service import (
    load_label_images_cache,
    read_upload_file,
    save_label_image,
    validate_label_image_upload,
    get_label_image_for_user,
)
from labels.pdf_service import (
    build_label_pdf_filename,
    build_print_context,
    delete_label_pdf_file_for_user,
    get_label_pdf_file_for_user,
    iter_label_chunks,
    list_label_pdf_files_for_org,
    save_label_pdf_file,
)
from models import (
    GtinExtraFields,
    LabelTemplate,
    OperationLogStatus,
    OperationLogType,
    Organization,
    ProductCard,
    User,
)
from schemas import (
    LabelImageUploadResponse,
    LabelPdfFileListItem,
    LabelPdfSplitFileItem,
    LabelPdfSplitResponse,
    LabelTemplateCreate,
    LabelTemplateResponse,
)
from services.journal_service import log_operation
from utils.marking_code import CRYPTO_TAIL_PRINT_ERROR, codes_without_crypto_tail

router = APIRouter(prefix="/labels", tags=["labels"])
logger = logging.getLogger(__name__)
_DEFAULT_TEMPLATE_MUTATION_ERROR = (
    "Стандартный шаблон нельзя изменить, он сохраняется как новый"
)


def _attachment_disposition(filename: str) -> str:
    encoded = quote(filename)
    return f"attachment; filename*=UTF-8''{encoded}"


class LabelRequest(BaseModel):
    code: str
    name: str = ""
    article: str = ""
    gtin: str = ""
    size: str = ""
    width_mm: int = 58
    height_mm: int = 40


class BatchLabelRequest(BaseModel):
    codes: list[str]
    width_mm: int = 58
    height_mm: int = 40
    copies: int = 1
    template_id: str | None = None
    start_number: int = 1
    barcode_type: str = "ean13"
    barcode_column: str = "gtin"
    barcode_keep_leading_zero: bool = True
    barcode_from_extra: bool = False
    split_files: bool = False
    pages_per_file: int = 100
    continuous_numbering: bool = False
    save: bool = True
    label_kind: str = "km"  # km | sscc


class SsccBatchLabelRequest(BaseModel):
    """Пакетная печать этикеток SSCC (КИТУ) — без проверки криптохвоста."""

    kitu_codes: list[str]
    width_mm: int = 40
    height_mm: int = 20
    copies: int = 1
    template_id: str | None = None
    start_number: int = 1
    split_files: bool = False
    pages_per_file: int = 100
    continuous_numbering: bool = False
    save: bool = True


class SsccPreviewLabelRequest(BaseModel):
    kitu_code: str
    template_id: str | None = None
    width_mm: int = 40
    height_mm: int = 20
    start_number: int = 1


class AggregationLabelRequest(BaseModel):
    """Последовательная печать КИТУ + вложений (два макета, один PDF)."""

    doc_ids: list[str] | None = None
    kitu_codes: list[str] | None = None
    kitu_template_id: str
    unit_template_id: str
    start_number: int = 1
    barcode_type: str = "ean13"
    barcode_column: str = "gtin"
    barcode_keep_leading_zero: bool = True
    barcode_from_extra: bool = False
    split_files: bool = False
    pages_per_file: int = 100
    continuous_numbering: bool = False
    save: bool = True
    single_file: bool = True


class PreviewLabelRequest(BaseModel):
    code: str
    template_id: str | None = None
    width_mm: int = 58
    height_mm: int = 40
    start_number: int = 1
    barcode_type: str = "ean13"
    barcode_column: str = "gtin"
    barcode_keep_leading_zero: bool = True
    barcode_from_extra: bool = False


class PrintFromTemplateRequest(BaseModel):
    template_id: str
    codes: list[str]
    copies: int = 1
    start_number: int = 1
    barcode_type: str = "ean13"
    barcode_column: str = "gtin"
    barcode_keep_leading_zero: bool = True
    barcode_from_extra: bool = False
    split_files: bool = False
    pages_per_file: int = 100
    continuous_numbering: bool = False


def _extract_gtin(code: str) -> str | None:
    m = re.match(r"^01(\d{14})", code)
    return m.group(1) if m else None


def _truncate_text(
    c: canvas.Canvas,
    text: str,
    font_name: str,
    font_size: float,
    max_width: float,
) -> str:
    while stringWidth(text, font_name, font_size) > max_width and len(text) > 1:
        text = text[:-1]
    return text


def _draw_datamatrix_safe(
    c: canvas.Canvas,
    code: str,
    x: float,
    y: float,
    size: float,
) -> None:
    """Надёжный рендер ECC200DataMatrix. x, y, size — в единицах ReportLab (points)."""
    from labels.block_registry import draw_datamatrix_safe

    draw_datamatrix_safe(c, code, x, y, size)


def _draw_label_default(
    c: canvas.Canvas,
    code: str,
    gtin: str | None,
    ef: GtinExtraFields | None,
    w: float,
    h: float,
) -> None:
    dm_size = min(h * 0.88, w * 0.44)
    dm_x = w - dm_size - 1 * mm
    dm_y = (h - dm_size) / 2

    text_area_w = dm_x - 3 * mm
    text_x = 2 * mm
    y = h - 4 * mm

    name = ef.name if ef and ef.name else ""
    article = ef.article if ef and ef.article else ""
    size = ef.size if ef and ef.size else ""

    if gtin:
        gtin_clean = gtin
    else:
        m = re.match(r"^01(\d{14})", code)
        gtin_clean = m.group(1) if m else ""

    if name:
        c.setFont(resolve_font(bold=True), 5.5)
        name_truncated = _truncate_text(c, name, resolve_font(bold=True), 5.5, text_area_w)
        c.drawString(text_x, y, name_truncated)
        y -= 3.5 * mm

    c.setFont(resolve_font(), 4.5)
    if article:
        c.drawString(text_x, y, f"Арт: {article}"[:20])
        y -= 3 * mm
    if gtin_clean:
        c.drawString(text_x, y, f"GTIN: {gtin_clean}")
        y -= 3 * mm
    if size:
        c.drawString(text_x, y, f"Размер: {size}"[:18])

    _draw_datamatrix_safe(c, code, dm_x, dm_y, dm_size)


def _draw_label_from_template(
    c: canvas.Canvas,
    code: str,
    gtin: str | None,
    ef: GtinExtraFields | None,
    product_card: ProductCard | None,
    layout_data: dict,
    page_h: float,
    image_cache: dict[str, bytes] | None = None,
    print_context: PrintContext | None = None,
) -> None:
    elements = layout_data.get("elements") or []
    for el in elements:
        draw_element_from_template(
            c, el, code, gtin, ef, page_h, product_card, image_cache, print_context
        )


def _draw_aggregation_label_page(
    c: canvas.Canvas,
    code: str,
    gtin: str | None,
    ef: GtinExtraFields | None,
    product_card: ProductCard | None,
    layout_data: dict | None,
    page_h: float,
    page_w: float,
    image_cache: dict[str, bytes] | None,
    print_context: PrintContext | None,
) -> None:
    if layout_data and layout_data.get("elements"):
        _draw_label_from_template(
            c, code, gtin, ef, product_card, layout_data, page_h, image_cache, print_context
        )
    else:
        _draw_label_default(c, code, gtin, ef, page_w, page_h)


def _build_label_jobs(codes: list[str], copies: int) -> list[tuple[str, str | None]]:
    jobs: list[tuple[str, str | None]] = []
    for code in codes:
        gtin = _extract_gtin(code)
        for _ in range(copies):
            jobs.append((code, gtin))
    return jobs


async def _generate_batch_labels_pdf(
    data: BatchLabelRequest,
    db: AsyncSession,
    org: Organization | None,
    layout_data: dict | None = None,
    *,
    save: bool = True,
    template_id: UUID | None = None,
) -> Response:
    register_fonts()
    if not data.codes:
        raise HTTPException(status_code=400, detail="Список кодов пуст")
    if data.label_kind == "sscc":
        _validate_kitu_codes(data.codes)
    else:
        _reject_codes_without_crypto_tail(data.codes)
    if len(data.codes) > 500:
        raise HTTPException(status_code=400, detail="Максимум 500 этикеток за один запрос")
    if data.copies < 1 or data.copies > 10:
        raise HTTPException(status_code=400, detail="Количество копий: от 1 до 10")
    if data.start_number < 1:
        raise HTTPException(status_code=400, detail="Стартовый номер: от 1")
    if data.split_files and data.pages_per_file < 1:
        raise HTTPException(status_code=400, detail="Страниц в файле: от 1")

    w = data.width_mm * mm
    h = data.height_mm * mm
    label_jobs = _build_label_jobs(data.codes, data.copies)
    total_pages = len(label_jobs)
    codes_count = len(data.codes)

    extra_fields_cache: dict[str, GtinExtraFields] = {}
    product_card_cache: dict[str, ProductCard] = {}
    image_cache: dict[str, bytes] = {}
    if layout_data:
        image_cache = await load_label_images_cache(db, layout_data, org)
    gtins = list({_extract_gtin(code) for code in data.codes if _extract_gtin(code)})
    if gtins and data.label_kind != "sscc":
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

    def render_chunk_pdf(chunk_start: int, chunk_end: int) -> bytes:
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=(w, h))
        chunk_len = chunk_end - chunk_start

        def draw_label(
            code: str,
            gtin: str | None,
            print_context: PrintContext | None = None,
        ) -> None:
            ef = extra_fields_cache.get(gtin) if gtin else None
            product_card = product_card_cache.get(gtin) if gtin else None
            if layout_data and layout_data.get("elements"):
                _draw_label_from_template(
                    c, code, gtin, ef, product_card, layout_data, h, image_cache, print_context
                )
            else:
                _draw_label_default(c, code, gtin, ef, w, h)

        for local_i, global_index in enumerate(range(chunk_start, chunk_end)):
            code, gtin = label_jobs[global_index]
            sscc_defaults = (
                {
                    "barcode_type": "code128",
                    "barcode_column": "kitu_code",
                }
                if data.label_kind == "sscc"
                else {
                    "barcode_type": data.barcode_type,
                    "barcode_column": data.barcode_column,
                }
            )
            print_context = build_print_context(
                global_index=global_index,
                chunk_start=chunk_start,
                chunk_len=chunk_len,
                total_pages=total_pages,
                start_number=data.start_number,
                continuous_numbering=data.continuous_numbering,
                barcode_keep_leading_zero=data.barcode_keep_leading_zero,
                barcode_from_extra=data.barcode_from_extra,
                kitu_code=code if data.label_kind == "sscc" else "",
                **sscc_defaults,
            )
            draw_label(code, gtin, print_context)
            if local_i < chunk_len - 1:
                c.showPage()
                c.setPageSize((w, h))

        c.save()
        buf.seek(0)
        return buf.read()

    resolved_template_id = template_id
    if resolved_template_id is None and data.template_id:
        try:
            resolved_template_id = UUID(data.template_id)
        except (ValueError, TypeError):
            resolved_template_id = None

    if data.split_files:
        chunks = iter_label_chunks(total_pages, data.pages_per_file)
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
                    template_id=resolved_template_id,
                    filename=filename,
                )
                saved_files.append(
                    LabelPdfSplitFileItem(
                        id=record.id,
                        filename=record.filename,
                        pages_count=record.pages_count,
                    )
                )

        if save:
            await log_operation(
                db,
                operation_type=OperationLogType.LABEL_PRINTED,
                status=OperationLogStatus.SUCCESS,
                description=f"Напечатано {codes_count} этикеток ({len(chunks)} файлов)",
                codes_count=codes_count,
                org_id=org.id if org else None,
            )
        payload = LabelPdfSplitResponse(files=saved_files)
        return JSONResponse(content=payload.model_dump(mode="json"))

    pdf_bytes = render_chunk_pdf(0, total_pages)
    if save:
        await save_label_pdf_file(
            db,
            pdf_bytes,
            org,
            pages_count=total_pages,
            codes_count=codes_count,
            template_id=resolved_template_id,
        )

    if save:
        await log_operation(
            db,
            operation_type=OperationLogType.LABEL_PRINTED,
            status=OperationLogStatus.SUCCESS,
            description=f"Напечатано {codes_count} этикеток",
            codes_count=codes_count,
            org_id=org.id if org else None,
        )
    inline_filename = f"labels_{codes_count}pcs.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename={inline_filename}"},
    )


async def _resolve_sscc_template(
    db: AsyncSession,
    template_id: UUID | None,
    layout_data: dict | None,
    width_mm: int,
    height_mm: int,
) -> tuple[dict | None, int, int, UUID | None]:
    """Подставить шаблон SSCC 40×20, если макет не задан."""
    if layout_data is not None:
        return layout_data, width_mm, height_mm, template_id

    result = await db.scalars(
        select(LabelTemplate).where(LabelTemplate.name == "SSCC 40×20мм").limit(1)
    )
    template = result.first()
    if template is None:
        return layout_data, width_mm, height_mm, template_id
    return template.layout_data, template.width_mm, template.height_mm, template.id


def _reject_codes_without_crypto_tail(codes: list[str]) -> None:
    invalid = codes_without_crypto_tail(codes)
    if invalid:
        raise HTTPException(status_code=400, detail=CRYPTO_TAIL_PRINT_ERROR)


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


@router.get("/field-catalog")
async def get_field_catalog(
    _: User = Depends(get_current_user),
) -> list[dict[str, str]]:
    """Каталог полей (плейсхолдеров) для конструктора этикеток."""
    return field_catalog_metadata()


@router.post("/images", response_model=LabelImageUploadResponse, status_code=201)
async def upload_label_image(
    file: UploadFile = File(...),
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> LabelImageUploadResponse:
    """Загрузить изображение для блока «Изображение» в конструкторе."""
    content = await read_upload_file(file)
    mime = validate_label_image_upload(content, file.content_type)
    image = await save_label_image(
        db,
        content,
        mime,
        org,
        filename=file.filename,
    )
    return LabelImageUploadResponse(id=image.id, mime=image.mime)


@router.get("/images/{image_id}")
async def get_label_image(
    image_id: UUID,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """Отдать бинарь загруженного изображения (с проверкой org)."""
    image = await get_label_image_for_user(db, image_id, org)
    return Response(
        content=bytes(image.data),
        media_type=image.mime,
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    )


@router.get("/pdf-files", response_model=list[LabelPdfFileListItem])
async def list_label_pdf_files(
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> list[LabelPdfFileListItem]:
    """Список ранее созданных PDF этикеток для текущей организации."""
    files = await list_label_pdf_files_for_org(db, org)
    return files


@router.get("/pdf-files/{file_id}")
async def get_label_pdf_file(
    file_id: UUID,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """Скачать сохранённый PDF (org-изоляция)."""
    pdf_file = await get_label_pdf_file_for_user(db, file_id, org)
    return Response(
        content=bytes(pdf_file.data),
        media_type="application/pdf",
        headers={
            "Content-Disposition": _attachment_disposition(pdf_file.filename),
        },
    )


@router.delete("/pdf-files/{file_id}", status_code=204)
async def delete_label_pdf_file(
    file_id: UUID,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> None:
    """Удалить PDF из истории (org-изоляция)."""
    await delete_label_pdf_file_for_user(db, file_id, org)


@router.get("/templates", response_model=list[LabelTemplateResponse])
async def list_templates(
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> list[LabelTemplateResponse]:
    """Список шаблонов этикеток."""
    q = (
        select(LabelTemplate)
        .where(
            or_(
                LabelTemplate.org_id == (org.id if org else None),
                LabelTemplate.org_id.is_(None),
            )
        )
        .order_by(LabelTemplate.is_default.desc(), LabelTemplate.created_at)
    )
    result = await db.scalars(q)
    return list(result.all())


@router.post("/templates", response_model=LabelTemplateResponse, status_code=201)
async def create_template(
    data: LabelTemplateCreate,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> LabelTemplateResponse:
    """Создать шаблон этикетки."""
    template = LabelTemplate(
        name=data.name,
        width_mm=data.width_mm,
        height_mm=data.height_mm,
        layout_data=data.layout_data,
        is_default=data.is_default,
        org_id=org.id if org else None,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return template


@router.put("/templates/{template_id}", response_model=LabelTemplateResponse)
async def update_template(
    template_id: UUID,
    data: LabelTemplateCreate,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> LabelTemplateResponse:
    """Обновить шаблон."""
    template = await db.get(LabelTemplate, template_id)
    if not template:
        raise HTTPException(404, "Шаблон не найден")
    if template.is_default:
        raise HTTPException(409, _DEFAULT_TEMPLATE_MUTATION_ERROR)
    template.name = data.name
    template.width_mm = data.width_mm
    template.height_mm = data.height_mm
    template.layout_data = data.layout_data
    await db.commit()
    await db.refresh(template)
    return template


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(
    template_id: UUID,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> None:
    """Удалить шаблон."""
    template = await db.get(LabelTemplate, template_id)
    if not template:
        raise HTTPException(404, "Шаблон не найден")
    if template.is_default:
        raise HTTPException(409, "Стандартный шаблон нельзя удалить")
    await db.delete(template)
    await db.commit()


@router.post("/pdf/from-template")
async def print_from_template(
    data: PrintFromTemplateRequest,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """Печать по шаблону."""
    if not data.template_id or not data.codes:
        raise HTTPException(400, "Укажите template_id и codes")

    template = await db.get(LabelTemplate, UUID(data.template_id))
    if not template:
        raise HTTPException(404, "Шаблон не найден")

    return await _generate_batch_labels_pdf(
        data=BatchLabelRequest(
            codes=data.codes,
            width_mm=template.width_mm,
            height_mm=template.height_mm,
            copies=data.copies,
            start_number=data.start_number,
            barcode_type=data.barcode_type,
            barcode_column=data.barcode_column,
            barcode_keep_leading_zero=data.barcode_keep_leading_zero,
            barcode_from_extra=data.barcode_from_extra,
            split_files=data.split_files,
            pages_per_file=data.pages_per_file,
            continuous_numbering=data.continuous_numbering,
            save=True,
        ),
        db=db,
        org=org,
        layout_data=template.layout_data,
        template_id=template.id,
        save=True,
    )


@router.post("/pdf")
async def generate_label_pdf(
    data: LabelRequest,
    _: User = Depends(get_current_user),
):
    register_fonts()
    buf = io.BytesIO()
    w = data.width_mm * mm
    h = data.height_mm * mm
    c = canvas.Canvas(buf, pagesize=(w, h))
    text_x = 2 * mm
    y = h - 4 * mm
    if data.name:
        c.setFont(resolve_font(bold=True), 5.5)
        c.drawString(text_x, y, data.name[:25])
        y -= 3.5 * mm
    c.setFont(resolve_font(), 4.5)
    if data.article:
        c.drawString(text_x, y, f"Арт: {data.article}")
        y -= 3 * mm
    if data.gtin:
        c.drawString(text_x, y, f"GTIN: {data.gtin}")
        y -= 3 * mm
    if data.size:
        c.drawString(text_x, y, f"Размер: {data.size}")
    dm_size = min(h * 0.88, w * 0.44)
    dm_x = w - dm_size - 1 * mm
    dm_y = (h - dm_size) / 2
    _draw_datamatrix_safe(c, data.code, dm_x, dm_y, dm_size)
    c.save()
    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/pdf",
        headers={
            "Content-Disposition": "inline; filename=label.pdf",
        },
    )


@router.post("/pdf/batch")
async def generate_batch_labels_pdf(
    data: BatchLabelRequest,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    layout_data: dict | None = None
    if data.template_id:
        template = await db.get(LabelTemplate, UUID(data.template_id))
        if template:
            layout_data = template.layout_data
            data = data.model_copy(
                update={
                    "width_mm": template.width_mm,
                    "height_mm": template.height_mm,
                }
            )
    return await _generate_batch_labels_pdf(
        data,
        db,
        org,
        layout_data=layout_data,
        template_id=UUID(data.template_id) if data.template_id else None,
        save=data.save,
    )


@router.post("/pdf/sscc")
async def generate_sscc_labels_pdf(
    data: SsccBatchLabelRequest,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """Печать этикеток SSCC (КИТУ): Code128 по kitu_code, без проверки криптохвоста."""
    layout_data: dict | None = None
    width_mm = data.width_mm
    height_mm = data.height_mm
    resolved_template_id: UUID | None = None
    if data.template_id:
        template = await db.get(LabelTemplate, UUID(data.template_id))
        if template:
            layout_data = template.layout_data
            width_mm = template.width_mm
            height_mm = template.height_mm
            resolved_template_id = template.id

    layout_data, width_mm, height_mm, resolved_template_id = await _resolve_sscc_template(
        db,
        resolved_template_id,
        layout_data,
        width_mm,
        height_mm,
    )

    batch = BatchLabelRequest(
        codes=[c.strip() for c in data.kitu_codes],
        width_mm=width_mm,
        height_mm=height_mm,
        copies=data.copies,
        template_id=data.template_id,
        start_number=data.start_number,
        barcode_type="code128",
        barcode_column="kitu_code",
        split_files=data.split_files,
        pages_per_file=data.pages_per_file,
        continuous_numbering=data.continuous_numbering,
        save=data.save,
        label_kind="sscc",
    )
    return await _generate_batch_labels_pdf(
        batch,
        db,
        org,
        layout_data=layout_data,
        template_id=resolved_template_id,
        save=data.save,
    )


@router.post("/pdf/sscc/preview")
async def preview_sscc_label_pdf(
    data: SsccPreviewLabelRequest,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """Предпросмотр одной SSCC-этикетки без сохранения в историю."""
    kitu_code = data.kitu_code.strip()
    if not kitu_code:
        raise HTTPException(status_code=400, detail="Укажите код КИТУ (SSCC)")

    layout_data: dict | None = None
    template_id: UUID | None = None
    width_mm = data.width_mm
    height_mm = data.height_mm

    if data.template_id:
        template = await db.get(LabelTemplate, UUID(data.template_id))
        if not template:
            raise HTTPException(status_code=404, detail="Шаблон не найден")
        layout_data = template.layout_data
        template_id = template.id
        width_mm = template.width_mm
        height_mm = template.height_mm

    layout_data, width_mm, height_mm, template_id = await _resolve_sscc_template(
        db,
        template_id,
        layout_data,
        width_mm,
        height_mm,
    )

    return await _generate_batch_labels_pdf(
        data=BatchLabelRequest(
            codes=[kitu_code],
            width_mm=width_mm,
            height_mm=height_mm,
            copies=1,
            barcode_type="code128",
            barcode_column="kitu_code",
            start_number=data.start_number,
            save=False,
            label_kind="sscc",
        ),
        db=db,
        org=org,
        layout_data=layout_data,
        template_id=template_id,
        save=False,
    )


@router.get("/pdf/aggregation-system-barcodes")
async def download_aggregation_system_barcodes_pdf(
    _: User = Depends(get_current_user),
) -> Response:
    """PDF с системными штрихкодами СТАРТ (AGGR_ST) и КОНЕЦ (AGGR_FN) для печати на рабочем месте."""
    pdf_bytes = build_aggregation_system_barcodes_pdf()
    filename = "aggregation_system_barcodes.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": _attachment_disposition(filename)},
    )


@router.post("/pdf/aggregation")
async def generate_aggregation_labels_pdf_endpoint(
    data: AggregationLabelRequest,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """Последовательная печать: КИТУ (макет упаковки) + вложения (макет КМ) одним PDF."""
    if data.split_files and not data.single_file:
        raise HTTPException(
            status_code=400,
            detail="Разбивка на части недоступна без режима «одним файлом»",
        )

    try:
        kitu_tpl_id = UUID(data.kitu_template_id)
        unit_tpl_id = UUID(data.unit_template_id)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="Некорректный идентификатор шаблона") from exc

    kitu_template = await _load_aggregation_template(db, kitu_tpl_id, label="упаковки")
    unit_template = await _load_aggregation_template(db, unit_tpl_id, label="вложений")

    doc_ids: list[UUID] | None = None
    if data.doc_ids:
        try:
            doc_ids = [UUID(value) for value in data.doc_ids]
        except (ValueError, TypeError) as exc:
            raise HTTPException(status_code=400, detail="Некорректный doc_id") from exc

    groups = await resolve_aggregation_print_groups(
        db,
        org,
        doc_ids=doc_ids,
        kitu_codes=data.kitu_codes,
    )

    jobs = build_aggregation_page_jobs(
        groups,
        kitu_layout=kitu_template.layout_data,
        kitu_width_mm=kitu_template.width_mm,
        kitu_height_mm=kitu_template.height_mm,
        unit_layout=unit_template.layout_data,
        unit_width_mm=unit_template.width_mm,
        unit_height_mm=unit_template.height_mm,
        unit_barcode_type=data.barcode_type,
        unit_barcode_column=data.barcode_column,
        unit_barcode_keep_leading_zero=data.barcode_keep_leading_zero,
        unit_barcode_from_extra=data.barcode_from_extra,
        extract_gtin=_extract_gtin,
    )

    pdf_bytes, split_payload, total_pages = await generate_aggregation_labels_pdf(
        db,
        org,
        jobs,
        start_number=data.start_number,
        continuous_numbering=data.continuous_numbering,
        split_files=data.split_files,
        pages_per_file=data.pages_per_file,
        save=data.save,
        kitu_template_id=kitu_template.id,
        unit_template_id=unit_template.id,
        draw_label_fn=_draw_aggregation_label_page,
    )

    if split_payload is not None:
        return JSONResponse(content=split_payload.model_dump(mode="json"))

    if data.save:
        await log_operation(
            db,
            operation_type=OperationLogType.LABEL_PRINTED,
            status=OperationLogStatus.SUCCESS,
            description=f"Последовательная печать: {total_pages} этикеток (КИТУ+вложения)",
            codes_count=total_pages,
            org_id=org.id if org else None,
        )

    inline_filename = f"aggregation_labels_{total_pages}pcs.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename={inline_filename}"},
    )


async def _load_aggregation_template(
    db: AsyncSession,
    template_id: UUID,
    *,
    label: str,
) -> LabelTemplate:
    template = await db.get(LabelTemplate, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail=f"Шаблон {label} не найден")
    return template


@router.post("/pdf/preview")
async def preview_label_pdf(
    data: PreviewLabelRequest,
    _: User = Depends(get_current_user),
    org: Organization | None = Depends(get_current_org),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """Предпросмотр одной этикетки — тот же рендер, что и печать, без сохранения в историю."""
    code = data.code.strip()
    if not code:
        raise HTTPException(status_code=400, detail="Укажите код маркировки")

    layout_data: dict | None = None
    template_id: UUID | None = None
    width_mm = data.width_mm
    height_mm = data.height_mm

    if data.template_id:
        template = await db.get(LabelTemplate, UUID(data.template_id))
        if not template:
            raise HTTPException(status_code=404, detail="Шаблон не найден")
        layout_data = template.layout_data
        template_id = template.id
        width_mm = template.width_mm
        height_mm = template.height_mm

    return await _generate_batch_labels_pdf(
        data=BatchLabelRequest(
            codes=[code],
            width_mm=width_mm,
            height_mm=height_mm,
            copies=1,
            barcode_type=data.barcode_type,
            barcode_column=data.barcode_column,
            barcode_keep_leading_zero=data.barcode_keep_leading_zero,
            barcode_from_extra=data.barcode_from_extra,
            start_number=data.start_number,
            save=False,
        ),
        db=db,
        org=org,
        layout_data=layout_data,
        template_id=template_id,
        save=False,
    )
