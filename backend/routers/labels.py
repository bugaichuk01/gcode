import io
import logging
import re
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from dependencies import get_current_org, get_current_user
from labels.block_registry import draw_element_from_template
from labels.field_catalog import field_catalog_metadata
from models import (
    GtinExtraFields,
    LabelTemplate,
    OperationLogStatus,
    OperationLogType,
    Organization,
    ProductCard,
    User,
)
from schemas import LabelTemplateCreate, LabelTemplateResponse
from services.journal_service import log_operation
from utils.marking_code import CRYPTO_TAIL_PRINT_ERROR, codes_without_crypto_tail

router = APIRouter(prefix="/labels", tags=["labels"])
logger = logging.getLogger(__name__)
_fonts_registered = False
_DEFAULT_TEMPLATE_MUTATION_ERROR = (
    "Стандартный шаблон нельзя изменить, он сохраняется как новый"
)


def _register_fonts():
    global _fonts_registered
    if _fonts_registered:
        return
    try:
        pdfmetrics.registerFont(
            TTFont("DejaVu", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
        )
        pdfmetrics.registerFont(
            TTFont("DejaVuBold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
        )
        _fonts_registered = True
    except Exception as e:
        print(f"Шрифт не найден: {e}")


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


class PrintFromTemplateRequest(BaseModel):
    template_id: str
    codes: list[str]
    copies: int = 1


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
    font_normal: str,
    font_bold: str,
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
        c.setFont(font_bold, 5.5)
        name_truncated = _truncate_text(c, name, font_bold, 5.5, text_area_w)
        c.drawString(text_x, y, name_truncated)
        y -= 3.5 * mm

    c.setFont(font_normal, 4.5)
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
    font_normal: str,
    font_bold: str,
) -> None:
    elements = layout_data.get("elements") or []
    for el in elements:
        draw_element_from_template(
            c, el, code, gtin, ef, page_h, font_normal, font_bold, product_card
        )


async def _generate_batch_labels_pdf(
    data: BatchLabelRequest,
    db: AsyncSession,
    org: Organization | None,
    layout_data: dict | None = None,
) -> Response:
    _register_fonts()
    if not data.codes:
        raise HTTPException(status_code=400, detail="Список кодов пуст")
    _reject_codes_without_crypto_tail(data.codes)
    if len(data.codes) > 500:
        raise HTTPException(status_code=400, detail="Максимум 500 этикеток за один запрос")
    if data.copies < 1 or data.copies > 10:
        raise HTTPException(status_code=400, detail="Количество копий: от 1 до 10")

    w = data.width_mm * mm
    h = data.height_mm * mm
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(w, h))
    font_normal = "DejaVu" if _fonts_registered else "Helvetica"
    font_bold = "DejaVuBold" if _fonts_registered else "Helvetica-Bold"

    extra_fields_cache: dict[str, GtinExtraFields] = {}
    product_card_cache: dict[str, ProductCard] = {}
    gtins = list({_extract_gtin(code) for code in data.codes if _extract_gtin(code)})
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

    def draw_label(code: str, gtin: str | None) -> None:
        ef = extra_fields_cache.get(gtin) if gtin else None
        product_card = product_card_cache.get(gtin) if gtin else None
        if layout_data and layout_data.get("elements"):
            _draw_label_from_template(
                c, code, gtin, ef, product_card, layout_data, h, font_normal, font_bold
            )
        else:
            _draw_label_default(c, code, gtin, ef, w, h, font_normal, font_bold)

    total_pages = len(data.codes) * data.copies
    page_num = 0
    for code in data.codes:
        gtin = _extract_gtin(code)
        for _ in range(data.copies):
            draw_label(code, gtin)
            page_num += 1
            if page_num < total_pages:
                c.showPage()
                c.setPageSize((w, h))

    c.save()
    buf.seek(0)
    await log_operation(
        db,
        operation_type=OperationLogType.LABEL_PRINTED,
        status=OperationLogStatus.SUCCESS,
        description=f"Напечатано {len(data.codes)} этикеток",
        codes_count=len(data.codes),
        org_id=org.id if org else None,
    )
    filename = f"labels_{len(data.codes)}pcs.pdf"
    return Response(
        content=buf.read(),
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename={filename}"},
    )


def _reject_codes_without_crypto_tail(codes: list[str]) -> None:
    invalid = codes_without_crypto_tail(codes)
    if invalid:
        raise HTTPException(status_code=400, detail=CRYPTO_TAIL_PRINT_ERROR)


@router.get("/field-catalog")
async def get_field_catalog(
    _: User = Depends(get_current_user),
) -> list[dict[str, str]]:
    """Каталог полей (плейсхолдеров) для конструктора этикеток."""
    return field_catalog_metadata()


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
        ),
        db=db,
        org=org,
        layout_data=template.layout_data,
    )


@router.post("/pdf")
async def generate_label_pdf(
    data: LabelRequest,
    _: User = Depends(get_current_user),
):
    _register_fonts()
    buf = io.BytesIO()
    w = data.width_mm * mm
    h = data.height_mm * mm
    c = canvas.Canvas(buf, pagesize=(w, h))
    font_normal = "DejaVu" if _fonts_registered else "Helvetica"
    font_bold = "DejaVuBold" if _fonts_registered else "Helvetica-Bold"
    text_x = 2 * mm
    y = h - 4 * mm
    if data.name:
        c.setFont(font_bold, 5.5)
        c.drawString(text_x, y, data.name[:25])
        y -= 3.5 * mm
    c.setFont(font_normal, 4.5)
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
    return await _generate_batch_labels_pdf(data, db, org, layout_data=layout_data)
