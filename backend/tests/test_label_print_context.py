"""Тесты контекста печати и поля «Номер этикетки»."""
from __future__ import annotations

import io

from reportlab.pdfgen import canvas

from labels.aggregation_pdf_service import build_aggregation_page_jobs, build_aggregation_print_context
from labels.block_registry import draw_element_from_template
from labels.field_catalog import (
    FieldResolveContext,
    PrintContext,
    format_labels_in_kitu_range,
    resolve_field,
)


def _make_canvas() -> tuple[canvas.Canvas, io.BytesIO]:
    buf = io.BytesIO()
    return canvas.Canvas(buf, pagesize=(200, 200)), buf


def test_resolve_field_label_number_from_print_context():
    ctx = FieldResolveContext(
        code="",
        gtin=None,
        extra_fields=None,
        print_context=PrintContext(label_index=4, label_number=105, total=10),
    )
    assert resolve_field("label_number", ctx) == "105"


def test_resolve_field_label_number_empty_without_context():
    ctx = FieldResolveContext(code="", gtin=None, extra_fields=None)
    assert resolve_field("label_number", ctx) == ""


def test_draw_field_label_number_in_pdf():
    c, _ = _make_canvas()
    el = {
        "type": "field",
        "field_key": "label_number",
        "x": 5,
        "y": 5,
        "font_size": 10,
    }
    print_ctx = PrintContext(label_index=2, label_number=103, total=5)
    draw_element_from_template(c, el, "code", None, None, 200.0, None, None, print_ctx)
    c.save()


def test_format_labels_in_kitu_range():
    assert format_labels_in_kitu_range(0) == ""
    assert format_labels_in_kitu_range(None) == ""
    assert format_labels_in_kitu_range(1) == "1"
    assert format_labels_in_kitu_range(10) == "1-10"


def test_resolve_package_number_from_kitu_index():
    ctx = FieldResolveContext(
        code="",
        gtin=None,
        extra_fields=None,
        print_context=PrintContext(
            label_index=0,
            label_number=1,
            total=3,
            kitu_index=2,
            label_kind="km",
        ),
    )
    assert resolve_field("package_number", ctx) == "2"


def test_resolve_labels_in_kitu_only_on_kitu_page():
    kitu_ctx = FieldResolveContext(
        code="046000000096594245",
        gtin=None,
        extra_fields=None,
        print_context=PrintContext(
            label_index=0,
            label_number=1,
            total=5,
            items_in_kitu=3,
            label_kind="kitu",
        ),
    )
    km_ctx = FieldResolveContext(
        code="01029000040676422151",
        gtin="02900004064948",
        extra_fields=None,
        print_context=PrintContext(
            label_index=1,
            label_number=2,
            total=3,
            items_in_kitu=3,
            label_kind="km",
        ),
    )
    assert resolve_field("labels_in_kitu", kitu_ctx) == "1-3"
    assert resolve_field("labels_in_kitu", km_ctx) == ""


def test_aggregation_print_context_km_label_number_within_kitu():
    kitu = "046000000096594245"
    code_a = "01029000040676422151ABCDEF"
    code_b = "01029000040676422152ABCDEF"
    jobs = build_aggregation_page_jobs(
        [(kitu, [code_a, code_b])],
        kitu_layout={"elements": []},
        kitu_width_mm=40,
        kitu_height_mm=20,
        unit_layout={"elements": []},
        unit_width_mm=58,
        unit_height_mm=40,
        unit_barcode_type="ean13",
        unit_barcode_column="gtin",
        unit_barcode_keep_leading_zero=True,
        unit_barcode_from_extra=False,
        extract_gtin=lambda c: "02900004064948",
    )
    km_job = jobs[2]
    ctx = build_aggregation_print_context(
        km_job,
        global_index=2,
        chunk_start=0,
        chunk_len=3,
        total_pages=3,
        start_number=1,
        continuous_numbering=True,
    )
    assert ctx.label_number == 2
    assert ctx.total == 2
    assert ctx.kitu_index == 1
    assert ctx.item_number_in_kitu == 2
    assert ctx.label_kind == "km"
    assert ctx.kitu_code == kitu


def test_aggregation_print_context_two_kitu_package_numbers():
    kitu1 = "046000000096594245"
    kitu2 = "046000000096594246"
    jobs = build_aggregation_page_jobs(
        [(kitu1, ["code_a"]), (kitu2, ["code_b", "code_c"])],
        kitu_layout={"elements": []},
        kitu_width_mm=40,
        kitu_height_mm=20,
        unit_layout={"elements": []},
        unit_width_mm=58,
        unit_height_mm=40,
        unit_barcode_type="ean13",
        unit_barcode_column="gtin",
        unit_barcode_keep_leading_zero=True,
        unit_barcode_from_extra=False,
        extract_gtin=lambda c: None,
    )
    assert jobs[0].kitu_index == 1
    assert jobs[1].kitu_index == 1
    assert jobs[2].kitu_index == 2
    assert jobs[3].kitu_index == 2
    assert jobs[3].kitu_total == 2
    assert jobs[4].item_number_in_kitu == 2
    assert jobs[4].kitu_index == 2
