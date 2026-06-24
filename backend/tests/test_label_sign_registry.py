"""Тесты реестра знаков и PDF-рендера блока sign."""
from __future__ import annotations

import logging
from io import BytesIO

import pytest
from reportlab.pdfgen import canvas

from labels.block_registry import (
    DEFAULT_GEOMETRY,
    BLOCK_TYPES,
    draw_element_from_template,
    merge_element_defaults,
)
from labels.sign_registry import SIGN_REGISTRY, resolve_sign_path, sign_registry_metadata


def test_sign_registry_has_five_signs():
    assert len(SIGN_REGISTRY) == 5
    keys = {s.key for s in SIGN_REGISTRY}
    assert keys == {"rst_decl", "ctr", "rst", "eac", "ce"}


def test_sign_registry_metadata_matches_catalog():
    meta = sign_registry_metadata()
    assert len(meta) == 5
    assert all("key" in m and "label" in m and "asset" in m for m in meta)


@pytest.mark.parametrize("sign_key", ["rst_decl", "ctr", "rst", "eac", "ce"])
def test_resolve_sign_path_finds_bundled_png(sign_key: str):
    path = resolve_sign_path(sign_key)
    assert path is not None
    assert path.is_file()
    assert path.stat().st_size > 0


def test_resolve_sign_path_unknown_key_returns_none():
    assert resolve_sign_path("unknown_sign") is None


def test_block_registry_includes_sign_type():
    assert "sign" in BLOCK_TYPES
    assert "sign_key" in DEFAULT_GEOMETRY["sign"]
    assert DEFAULT_GEOMETRY["sign"]["width"] == 10
    assert DEFAULT_GEOMETRY["sign"]["height"] == 10


def test_merge_element_defaults_sign():
    el = merge_element_defaults({"type": "sign", "x": 1, "y": 2, "sign_key": "eac"})
    assert el["width"] == 10
    assert el["height"] == 10
    assert el["sign_key"] == "eac"


def _render_pdf_elements(elements: list[dict]) -> bytes:
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(200, 200))
    page_h = 200
    for el in elements:
        draw_element_from_template(c, el, "code", None, None, page_h, None, None)
    c.save()
    return buf.getvalue()


def test_pdf_sign_renders_eac_without_error():
    pdf = _render_pdf_elements(
        [{"type": "sign", "sign_key": "eac", "x": 5, "y": 5, "width": 10, "height": 10}]
    )
    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 500


def test_pdf_multiple_signs_render():
    pdf = _render_pdf_elements(
        [
            {"type": "sign", "sign_key": "eac", "x": 2, "y": 2, "width": 8, "height": 8},
            {"type": "sign", "sign_key": "ce", "x": 15, "y": 2, "width": 8, "height": 8},
            {"type": "sign", "sign_key": "rst", "x": 2, "y": 15, "width": 8, "height": 8},
        ]
    )
    assert pdf.startswith(b"%PDF")


def test_pdf_unknown_sign_key_skips_with_warning(caplog):
    with caplog.at_level(logging.WARNING):
        pdf = _render_pdf_elements(
            [{"type": "sign", "sign_key": "not_a_real_sign", "x": 1, "y": 1}]
        )
    assert pdf.startswith(b"%PDF")
    assert any("sign_key" in r.message for r in caplog.records)


def test_pdf_unknown_block_type_skips_with_warning(caplog):
    with caplog.at_level(logging.WARNING):
        pdf = _render_pdf_elements([{"type": "sticker", "x": 1, "y": 1}])
    assert pdf.startswith(b"%PDF")
    assert any("Неизвестный тип блока" in r.message for r in caplog.records)


def test_pdf_text_template_unchanged_without_sign_blocks():
    """Старые шаблоны без sign-блоков не затрагиваются."""
    pdf = _render_pdf_elements(
        [{"type": "text", "x": 1, "y": 1, "text": "оригинал", "font_size": 6}]
    )
    assert pdf.startswith(b"%PDF")
