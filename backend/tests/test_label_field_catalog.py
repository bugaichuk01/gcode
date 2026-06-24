"""Тесты каталога полей и реестра блоков этикеток."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from labels.block_registry import DEFAULT_GEOMETRY, draw_element_from_template, merge_element_defaults
from labels.field_catalog import (
    FIELD_CATALOG,
    TAB_HONEST_SIGN,
    TAB_LABEL_FIELDS,
    TAB_MORE,
    FieldDefinition,
    FieldResolveContext,
    field_catalog_metadata,
    resolve_field,
    resolve_field_block_label,
    substitute_text,
)

FIELD_CATALOG_URL = "/api/v1/labels/field-catalog"

ORIGINAL_SEVEN_KEYS = {"name", "article", "gtin", "size", "brand", "color", "price"}
MORE_TAB_FIELD_COUNT = 19
EXPECTED_CATALOG_SIZE = 15 + MORE_TAB_FIELD_COUNT


def test_field_catalog_has_fourteen_label_fields_plus_more_tab():
    assert len(FIELD_CATALOG) == EXPECTED_CATALOG_SIZE
    by_key = {f.key: f.sources for f in FIELD_CATALOG}
    assert by_key["name"] == ("extra_fields.name", "product_card.name")
    assert by_key["print_name"] == (
        "extra_fields.extra.print_name",
        "extra_fields.name",
        "product_card.name",
    )
    assert by_key["article"] == ("extra_fields.article", "product_card.model_article")
    assert by_key["gtin"] == ("code.gtin",)
    assert by_key["cis_human"] == ("code.cis_human",)
    assert by_key["price"] == ("empty",)
    assert by_key["gender"] == ("product_card.gender",)
    assert by_key["set_items"] == ("product_card.set_items",)
    assert by_key["user_inn"] == ("extra_fields.edo_inn",)
    assert by_key["user_address"] == ("extra_fields.edo_address",)
    assert by_key["user_phone"] == ("extra_fields.extra.phone",)
    assert by_key["user_product_code"] == ("extra_fields.extra.product_code",)
    assert by_key["user_field_1"] == ("extra_fields.extra.field_1",)
    assert by_key["user_field_10"] == ("extra_fields.extra.field_10",)
    assert by_key["label_number"] == ("print_context.label_number",)
    label_fields = [f for f in FIELD_CATALOG if f.tab == TAB_LABEL_FIELDS]
    more_fields = [f for f in FIELD_CATALOG if f.tab == TAB_MORE]
    assert len(label_fields) == 14
    assert len(more_fields) == MORE_TAB_FIELD_COUNT
    assert all(f.tab == TAB_LABEL_FIELDS for f in label_fields)
    cis_human = next(f for f in FIELD_CATALOG if f.key == "cis_human")
    assert cis_human.tab == TAB_HONEST_SIGN
    more_keys = {f.key for f in more_fields}
    assert "name" not in more_keys
    assert "country" not in more_keys
    assert {f"user_field_{n}" for n in range(1, 11)} <= more_keys


def test_resolve_field_extra_json_keys():
    ef = SimpleNamespace(
        extra={
            "phone": "+7900",
            "field_1": "X",
            "field_1_label": "Артикул поставщика",
            "manufacturer": 12345,
            "product_code": "TOV-1",
        },
    )
    ctx = FieldResolveContext(code="", gtin=None, extra_fields=ef)
    assert resolve_field("user_phone", ctx) == "+7900"
    assert resolve_field("user_field_1", ctx) == "X"
    assert resolve_field("user_manufacturer", ctx) == "12345"
    assert resolve_field("user_product_code", ctx) == "TOV-1"


def test_resolve_field_block_label_uses_custom_name():
    ef = SimpleNamespace(extra={"field_1_label": "Артикул поставщика"})
    ctx = FieldResolveContext(code="", gtin=None, extra_fields=ef)
    assert resolve_field_block_label("user_field_1", ctx) == "Артикул поставщика:"


def test_resolve_field_block_label_defaults_without_label_key():
    ef = SimpleNamespace(extra={"field_1": "значение"})
    ctx = FieldResolveContext(code="", gtin=None, extra_fields=ef)
    assert resolve_field_block_label("user_field_1", ctx) == "Поле 1:"


def test_resolve_field_block_label_non_user_field_returns_none():
    ctx = FieldResolveContext(code="", gtin=None, extra_fields=None)
    assert resolve_field_block_label("composition", ctx) is None


def test_resolve_field_print_name_fallback_to_name():
    ef = SimpleNamespace(name="Основное имя", extra={})
    ctx = FieldResolveContext(code="", gtin=None, extra_fields=ef)
    assert resolve_field("print_name", ctx) == "Основное имя"


def test_resolve_field_print_name_prefers_extra_value():
    ef = SimpleNamespace(name="Основное имя", extra={"print_name": "Для этикетки"})
    ctx = FieldResolveContext(code="", gtin=None, extra_fields=ef)
    assert resolve_field("print_name", ctx) == "Для этикетки"


def test_resolve_field_edo_columns():
    ef = SimpleNamespace(edo_inn="7701234567", edo_address="г. Москва, ул. Тестовая, 5")
    ctx = FieldResolveContext(code="", gtin=None, extra_fields=ef)
    assert resolve_field("user_inn", ctx) == "7701234567"
    assert resolve_field("user_address", ctx) == "г. Москва, ул. Тестовая, 5"


def test_resolve_field_extra_json_none_or_missing():
    ef_none = SimpleNamespace(extra=None)
    ctx_none = FieldResolveContext(code="", gtin=None, extra_fields=ef_none)
    assert resolve_field("user_phone", ctx_none) == ""
    assert resolve_field("user_field_1", ctx_none) == ""

    ef_empty = SimpleNamespace(extra={})
    ctx_empty = FieldResolveContext(code="", gtin=None, extra_fields=ef_empty)
    assert resolve_field("user_phone", ctx_empty) == ""

    ctx_no_ef = FieldResolveContext(code="", gtin=None, extra_fields=None)
    assert resolve_field("user_inn", ctx_no_ef) == ""
    assert resolve_field("user_phone", ctx_no_ef) == ""


def test_resolve_field_extra_json_generic_key_without_resolver_change():
    """extra_fields.extra.<key> резолвится обобщённо — новый ключ без правки if-логики."""
    import labels.field_catalog as fc

    original = list(fc.FIELD_CATALOG)
    try:
        fc.FIELD_CATALOG = original + [
            FieldDefinition(
                "user_custom",
                "Кастом",
                ("extra_fields.extra.newkey",),
                "demo",
                tab=TAB_MORE,
            ),
        ]
        ef = SimpleNamespace(extra={"newkey": "новое значение"})
        ctx = FieldResolveContext(code="", gtin=None, extra_fields=ef)
        assert resolve_field("user_custom", ctx) == "новое значение"
    finally:
        fc.FIELD_CATALOG = original


def test_resolve_field_gtin_unchanged():
    ctx = FieldResolveContext(code="01" + "0" * 14, gtin="0" * 14, extra_fields=None)
    assert resolve_field("gtin", ctx) == "0" * 14


def test_resolve_field_cis_human_strips_crypto_tail():
    full_code = (
        "01029000040676422151lSbQXAES&g691FFD092dGVzdDxPl4yc2OOhCoXj6TPcEG6lSKcn9t0Vavgj/d4="
    )
    short_code = "01029000040676422151lSbQXAES&g6"
    code_with_gs = "01029000040676422151lSbQXAES&g6\x1d91FFD0\x1d92dGVzdDxP="

    ctx_full = FieldResolveContext(code=full_code, gtin="02900004064948", extra_fields=None)
    ctx_gs = FieldResolveContext(code=code_with_gs, gtin="02900004064948", extra_fields=None)
    ctx_short = FieldResolveContext(code=short_code, gtin="02900004064948", extra_fields=None)

    assert resolve_field("cis_human", ctx_full) == short_code
    assert resolve_field("cis_human", ctx_gs) == short_code
    assert resolve_field("cis_human", ctx_short) == short_code
    assert "\x1d" not in resolve_field("cis_human", ctx_gs)


def test_resolve_field_price_always_empty():
    ctx = FieldResolveContext(code="01" + "0" * 14, gtin="0" * 14, extra_fields=None)
    assert resolve_field("price", ctx) == ""
    assert resolve_field("gtin", ctx) == "0" * 14


def test_resolve_field_from_product_card_when_extra_fields_empty():
    pc = SimpleNamespace(
        name="НК-название",
        model_article="NK-ART",
        size="L",
        brand="NK-бренд",
        color="Красный",
        composition="хлопок",
        country="Китай",
        gender="Мужской",
        product_kind="Брюки",
        is_set=False,
        set_items=None,
    )
    ctx = FieldResolveContext(code="", gtin="02900004064948", extra_fields=None, product_card=pc)
    assert resolve_field("name", ctx) == "НК-название"
    assert resolve_field("article", ctx) == "NK-ART"
    assert resolve_field("size", ctx) == "L"
    assert resolve_field("brand", ctx) == "NK-бренд"
    assert resolve_field("color", ctx) == "Красный"
    assert resolve_field("composition", ctx) == "хлопок"
    assert resolve_field("country", ctx) == "Китай"
    assert resolve_field("gender", ctx) == "Мужской"
    assert resolve_field("product_kind", ctx) == "Брюки"
    assert resolve_field("model", ctx) == "NK-ART"


def test_resolve_field_extra_fields_override_product_card():
    ef = SimpleNamespace(
        name="EF-название",
        article="EF-ART",
        size="S",
        brand="EF-бренд",
        color="Синий",
        composition="шёлк",
        country="Италия",
    )
    pc = SimpleNamespace(
        name="НК-название",
        model_article="NK-ART",
        size="L",
        brand="NK-бренд",
        color="Красный",
        composition="хлопок",
        country="Китай",
        gender="Мужской",
        product_kind="Брюки",
        is_set=False,
        set_items=None,
    )
    ctx = FieldResolveContext(code="", gtin="02900004064948", extra_fields=ef, product_card=pc)
    assert resolve_field("name", ctx) == "EF-название"
    assert resolve_field("article", ctx) == "EF-ART"
    assert resolve_field("size", ctx) == "S"
    assert resolve_field("brand", ctx) == "EF-бренд"
    assert resolve_field("color", ctx) == "Синий"
    assert resolve_field("composition", ctx) == "шёлк"
    assert resolve_field("country", ctx) == "Италия"
    assert resolve_field("gender", ctx) == "Мужской"


def test_resolve_field_empty_without_sources():
    ctx = FieldResolveContext(code="", gtin="02900004064948", extra_fields=None, product_card=None)
    assert resolve_field("name", ctx) == ""
    assert resolve_field("gender", ctx) == ""
    assert substitute_text("{name} / {gender}", ctx) == " / "


def test_resolve_set_items_only_for_sets():
    pc_set = SimpleNamespace(
        is_set=True,
        set_items=[
            {"gtin": "04600000000001", "quantity": 1},
            {"gtin": "04600000000002", "quantity": 2},
        ],
    )
    pc_unit = SimpleNamespace(
        is_set=False,
        set_items=[{"gtin": "04600000000001", "quantity": 1}],
    )
    ctx_set = FieldResolveContext(code="", gtin=None, extra_fields=None, product_card=pc_set)
    ctx_unit = FieldResolveContext(code="", gtin=None, extra_fields=None, product_card=pc_unit)
    assert resolve_field("set_items", ctx_set) == "04600000000001, 04600000000002×2"
    assert resolve_field("set_items", ctx_unit) == ""


def test_substitute_text_uses_catalog():
    ctx = FieldResolveContext(code="", gtin="02900004064948", extra_fields=None)
    assert substitute_text("GTIN: {gtin}", ctx) == "GTIN: 02900004064948"
    assert substitute_text("Цена: {price}", ctx) == "Цена: "


def test_merge_element_defaults_fills_missing_props():
    el = {"type": "datamatrix", "x": 1, "y": 2}
    merged = merge_element_defaults(el)
    assert merged["size"] == DEFAULT_GEOMETRY["datamatrix"]["size"]


def test_merge_element_defaults_field_type():
    el = {"type": "field", "x": 1, "y": 2, "field_key": "gtin"}
    merged = merge_element_defaults(el)
    assert merged["field_key"] == "gtin"
    assert merged["font_size"] == DEFAULT_GEOMETRY["field"]["font_size"]


def test_pdf_field_resolves_via_catalog():
    from unittest.mock import MagicMock

    from types import SimpleNamespace

    c = MagicMock()
    pc = SimpleNamespace(name="НК-название")
    el = {"type": "field", "x": 1, "y": 2, "field_key": "name", "font_size": 6}
    draw_element_from_template(
        c,
        el,
        "code",
        "02900004064948",
        None,
        100.0,
        product_card=pc,
    )
    c.drawString.assert_called_once()
    assert c.drawString.call_args[0][2] == "НК-название"


def test_pdf_text_still_substitutes_placeholders():
    from unittest.mock import MagicMock

    c = MagicMock()
    el = {"type": "text", "x": 1, "y": 2, "text": "{name}", "font_size": 6}
    draw_element_from_template(
        c,
        el,
        "code",
        "02900004064948",
        None,
        100.0,
    )
    c.drawString.assert_not_called()


def test_unknown_block_type_skipped_without_error(caplog):
    """Неизвестный тип — мягкий пропуск с warning."""
    import logging
    from unittest.mock import MagicMock

    c = MagicMock()
    el = {"type": "unknown_block", "x": 0, "y": 0}
    with caplog.at_level(logging.WARNING):
        draw_element_from_template(c, el, "code", None, None, 100.0)
    assert any("Неизвестный тип блока" in r.message for r in caplog.records)


def test_field_catalog_items_appear_in_add_blocks_tab():
    """Новое поле в каталоге с tab=Поля этикетки попадает в список вкладки без правок JSX."""
    import labels.field_catalog as fc

    original = list(fc.FIELD_CATALOG)
    try:
        fc.FIELD_CATALOG = original + [
            FieldDefinition(
                "temp_modal_field",
                "Временное поле",
                ("code.gtin",),
                "TEMP",
            ),
        ]
        meta = field_catalog_metadata()
        modal_fields = [item for item in meta if item["tab"] == TAB_LABEL_FIELDS]
        keys = [item["key"] for item in modal_fields]
        assert "temp_modal_field" in keys
        assert len(modal_fields) == 15
    finally:
        fc.FIELD_CATALOG = original


def test_field_catalog_metadata_reflects_catalog_changes():
    """Доказательство единого источника: новое поле в каталоге попадает в API-метаданные."""
    import labels.field_catalog as fc

    original = list(fc.FIELD_CATALOG)
    try:
        fc.FIELD_CATALOG = original + [
            FieldDefinition("test_x", "Тест", ("code.gtin",), "X"),
        ]
        meta = field_catalog_metadata()
        keys = [item["key"] for item in meta]
        assert "test_x" in keys
        assert meta[-1]["tab"] == TAB_LABEL_FIELDS
    finally:
        fc.FIELD_CATALOG = original


def test_declarative_resolve_without_resolver_changes():
    """Новое поле с sources-списком резолвится без правки if-логики resolve_field."""
    import labels.field_catalog as fc

    original = list(fc.FIELD_CATALOG)
    try:
        fc.FIELD_CATALOG = original + [
            FieldDefinition(
                "demo_field",
                "Демо",
                ("extra_fields.brand", "product_card.color"),
                "demo",
            ),
        ]
        ef = SimpleNamespace(brand="", color=None)
        pc = SimpleNamespace(color="Фиолетовый")
        ctx = FieldResolveContext(code="", gtin=None, extra_fields=ef, product_card=pc)
        assert resolve_field("demo_field", ctx) == "Фиолетовый"
    finally:
        fc.FIELD_CATALOG = original


@pytest.mark.asyncio
async def test_get_field_catalog_endpoint(client, user_token):
    response = await client.get(
        FIELD_CATALOG_URL,
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == EXPECTED_CATALOG_SIZE
    assert all(
        "key" in item
        and "label" in item
        and "source" in item
        and "example" in item
        and "tab" in item
        for item in data
    )
    keys = {item["key"] for item in data}
    assert ORIGINAL_SEVEN_KEYS.issubset(keys)
    assert keys >= {
        "composition",
        "country",
        "gender",
        "product_kind",
        "model",
        "set_items",
        "cis_human",
        "print_name",
        "user_inn",
        "user_phone",
        "user_product_code",
        "user_field_1",
        "user_field_10",
    }
    more_items = [item for item in data if item["tab"] == TAB_MORE]
    assert len(more_items) == MORE_TAB_FIELD_COUNT
    assert "name" not in {item["key"] for item in more_items}
    assert "country" not in {item["key"] for item in more_items}
    by_key = {item["key"]: item["source"] for item in data}
    assert by_key["user_phone"] == "extra_fields.extra.phone"
    assert by_key["user_product_code"] == "extra_fields.extra.product_code"
    product_code_item = next(item for item in data if item["key"] == "user_product_code")
    assert product_code_item["label"] == "Код товара"
    assert product_code_item["tab"] == TAB_MORE
    assert by_key["user_inn"] == "extra_fields.edo_inn"
    assert by_key["name"] == "extra_fields.name"
