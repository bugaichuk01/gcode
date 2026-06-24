"""Тесты подписи+значения (label/value) для field и text блоков."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth

from labels.block_registry import draw_element_from_template
from labels.font_registry import register_fonts, resolve_font


@pytest.fixture(autouse=True)
def _ensure_fonts_registered():
    register_fonts()


def _draw(el: dict) -> MagicMock:
    c = MagicMock()
    draw_element_from_template(c, el, "", None, None, 100.0)
    return c


def test_field_user_field_uses_dynamic_label_from_extra():
    ef = SimpleNamespace(
        extra={"field_1": "ABC-123", "field_1_label": "Артикул поставщика"},
    )
    c = MagicMock()
    el = {
        "type": "field",
        "x": 1,
        "y": 2,
        "field_key": "user_field_1",
        "label": {"show": True, "text": "Поле 1:", "inline": False},
    }
    draw_element_from_template(c, el, "", None, ef, 100.0)
    texts = [call[0][2] for call in c.drawString.call_args_list]
    assert "Артикул поставщика:" in texts
    assert "ABC-123" in texts
    assert "Поле 1:" not in texts


def test_field_user_field_defaults_label_without_extra_label():
    ef = SimpleNamespace(extra={"field_1": "ABC-123"})
    c = MagicMock()
    el = {
        "type": "field",
        "x": 1,
        "y": 2,
        "field_key": "user_field_1",
        "label": {"show": True, "text": "Старое:", "inline": False},
    }
    draw_element_from_template(c, el, "", None, ef, 100.0)
    texts = [call[0][2] for call in c.drawString.call_args_list]
    assert "Поле 1:" in texts
    assert "ABC-123" in texts


def test_legacy_field_without_label_renders_value_only():
    """Старый field-блок без label/value — только значение, без подписи."""
    pc = SimpleNamespace(composition="100% хлопок")
    c = MagicMock()
    el = {"type": "field", "x": 1, "y": 2, "field_key": "composition", "font_size": 6}
    draw_element_from_template(c, el, "", None, None, 100.0, product_card=pc)
    c.drawString.assert_called_once()
    assert c.drawString.call_args[0][2] == "100% хлопок"


def test_new_field_inline_label_and_value():
    """Новый field: подпись и значение в одну строку."""
    pc = SimpleNamespace(composition="100% хлопок")
    c = MagicMock()
    el = {
        "type": "field",
        "x": 1,
        "y": 2,
        "field_key": "composition",
        "label": {"show": True, "text": "Состав:", "inline": False},
        "value": {"font_size": 6},
    }
    draw_element_from_template(c, el, "", None, None, 100.0, product_card=pc)
    assert c.drawString.call_count >= 2
    drawn_texts = [call[0][2] for call in c.drawString.call_args_list]
    assert "Состав:" in drawn_texts
    assert "100% хлопок" in drawn_texts


def test_field_separate_line_label():
    """Отдельной строкой: подпись сверху, значение ниже."""
    pc = SimpleNamespace(composition="100% хлопок")
    c = MagicMock()
    el = {
        "type": "field",
        "x": 1,
        "y": 2,
        "field_key": "composition",
        "label": {"show": True, "text": "Состав:", "inline": True},
    }
    draw_element_from_template(c, el, "", None, None, 100.0, product_card=pc)
    y_positions = [call[0][1] for call in c.drawString.call_args_list]
    texts = [call[0][2] for call in c.drawString.call_args_list]
    assert "Состав:" in texts
    assert "100% хлопок" in texts
    assert y_positions[0] > y_positions[1]


def test_field_label_hidden_shows_value_only():
    c = MagicMock()
    pc = SimpleNamespace(composition="100% хлопок")
    el = {
        "type": "field",
        "x": 1,
        "y": 2,
        "field_key": "composition",
        "label": {"show": False, "text": "Состав:"},
    }
    draw_element_from_template(c, el, "", None, None, 100.0, product_card=pc)
    c.drawString.assert_called_once()
    assert c.drawString.call_args[0][2] == "100% хлопок"


def test_field_different_label_and_value_font_sizes():
    """Подпись bold 12, значение normal 10."""
    pc = SimpleNamespace(composition="100% хлопок")
    c = MagicMock()
    el = {
        "type": "field",
        "x": 1,
        "y": 2,
        "field_key": "composition",
        "font_size": 6,
        "label": {
            "show": True,
            "text": "Состав:",
            "inline": False,
            "font_size": 12,
            "bold": True,
        },
        "value": {"font_size": 10, "bold": False},
    }
    draw_element_from_template(c, el, "", None, None, 100.0, product_card=pc)
    font_calls = c.setFont.call_args_list
    sizes = {call[0][1] for call in font_calls}
    names = {call[0][0] for call in font_calls}
    assert 12.0 in sizes
    assert 10.0 in sizes
    assert "DejaVuBold" in names
    assert "DejaVu" in names


def test_field_value_force_wrap():
    pc = SimpleNamespace(name="очень длинное название товара для переноса")
    c = MagicMock()
    el = {
        "type": "field",
        "x": 1,
        "y": 2,
        "field_key": "name",
        "max_width": 12,
        "label": {"show": True, "text": "Название:", "inline": True},
        "value": {"force_wrap": True},
    }
    draw_element_from_template(c, el, "", None, None, 100.0, product_card=pc)
    assert c.drawString.call_count >= 2


def test_legacy_text_block_unchanged():
    """Старый text «Арт: {article}» без label/value — как раньше."""
    ef = SimpleNamespace(article="ART-001")
    c = MagicMock()
    el = {"type": "text", "x": 1, "y": 2, "text": "Арт: {article}", "font_size": 6}
    draw_element_from_template(c, el, "", None, ef, 100.0)
    c.drawString.assert_called_once()
    assert c.drawString.call_args[0][2] == "Арт: ART-001"


def test_text_with_label_value_model():
    ef = SimpleNamespace(article="ART-001")
    c = MagicMock()
    el = {
        "type": "text",
        "x": 1,
        "y": 2,
        "text": "{article}",
        "label": {"show": True, "text": "Арт:", "inline": False},
    }
    draw_element_from_template(c, el, "", None, ef, 100.0)
    texts = [call[0][2] for call in c.drawString.call_args_list]
    assert "Арт:" in texts
    assert "ART-001" in texts
