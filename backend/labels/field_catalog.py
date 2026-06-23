"""Единый каталог полей (плейсхолдеров) для этикеток."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from models import GtinExtraFields, ProductCard
from utils.marking_code import get_short_cis

TAB_LABEL_FIELDS = "Поля этикетки"
TAB_HONEST_SIGN = "Честный знак"
TAB_MORE = "Ещё"


@dataclass(frozen=True)
class FieldDefinition:
    key: str
    label: str
    sources: tuple[str, ...]
    example: str
    tab: str = TAB_LABEL_FIELDS

    @property
    def source(self) -> str:
        """Первичный источник для обратной совместимости API."""
        if not self.sources:
            return ""
        ref = self.sources[0]
        if ref == "empty":
            return "extra_fields"
        if ref.startswith("code."):
            return "code"
        return ref.split(".", 1)[0]


FIELD_CATALOG: list[FieldDefinition] = [
    FieldDefinition(
        "name",
        "Название товара",
        ("extra_fields.name", "product_card.name"),
        "Название товара",
    ),
    FieldDefinition(
        "article",
        "Артикул",
        ("extra_fields.article", "product_card.model_article"),
        "АРТ-001",
    ),
    FieldDefinition("gtin", "GTIN", ("code.gtin",), "02900004064948"),
    FieldDefinition(
        "cis_human",
        "Код маркировки",
        ("code.cis_human",),
        "010462012345678921ABCDEF",
        tab=TAB_HONEST_SIGN,
    ),
    FieldDefinition(
        "size",
        "Размер",
        ("extra_fields.size", "product_card.size"),
        "M",
    ),
    FieldDefinition(
        "brand",
        "Бренд",
        ("extra_fields.brand", "product_card.brand"),
        "Бренд",
    ),
    FieldDefinition(
        "color",
        "Цвет",
        ("extra_fields.color", "product_card.color"),
        "Синий",
    ),
    FieldDefinition("price", "Цена", ("empty",), "999₽"),
    FieldDefinition(
        "composition",
        "Состав",
        ("extra_fields.composition", "product_card.composition"),
        "100% хлопок",
    ),
    FieldDefinition(
        "country",
        "Страна производства",
        ("extra_fields.country", "product_card.country"),
        "Россия",
    ),
    FieldDefinition("gender", "Пол", ("product_card.gender",), "Женский"),
    FieldDefinition(
        "product_kind",
        "Тип товара",
        ("product_card.product_kind",),
        "Футболка",
    ),
    FieldDefinition(
        "model",
        "Модель",
        ("product_card.model_article",),
        "MDL-2024",
    ),
    FieldDefinition(
        "set_items",
        "Состав набора",
        ("product_card.set_items",),
        "04600000000001, 04600000000002",
    ),
    FieldDefinition(
        "user_inn",
        "ИНН",
        ("extra_fields.edo_inn",),
        "7701234567",
        tab=TAB_MORE,
    ),
    FieldDefinition(
        "user_address",
        "Адрес",
        ("extra_fields.edo_address",),
        "г. Москва, ул. Примерная, д. 1",
        tab=TAB_MORE,
    ),
    FieldDefinition(
        "user_manufacturer",
        "Производитель",
        ("extra_fields.extra.manufacturer",),
        "ООО Ромашка",
        tab=TAB_MORE,
    ),
    FieldDefinition(
        "user_phone",
        "Телефон",
        ("extra_fields.extra.phone",),
        "+7 (900) 123-45-67",
        tab=TAB_MORE,
    ),
    FieldDefinition(
        "user_email",
        "E-mail",
        ("extra_fields.extra.email",),
        "info@example.ru",
        tab=TAB_MORE,
    ),
    FieldDefinition(
        "user_website",
        "Сайт",
        ("extra_fields.extra.website",),
        "www.example.ru",
        tab=TAB_MORE,
    ),
    FieldDefinition(
        "user_trademark",
        "Товарный знак",
        ("extra_fields.extra.trademark",),
        "Ромашка™",
        tab=TAB_MORE,
    ),
    FieldDefinition(
        "user_product_code",
        "Код товара",
        ("extra_fields.extra.product_code",),
        "TOV-00123",
        tab=TAB_MORE,
    ),
    *[
        FieldDefinition(
            f"user_field_{n}",
            f"Поле {n}",
            (f"extra_fields.extra.field_{n}",),
            f"Значение поля {n}",
            tab=TAB_MORE,
        )
        for n in range(1, 11)
    ],
]


@dataclass
class FieldResolveContext:
    code: str
    gtin: str | None
    extra_fields: GtinExtraFields | None
    product_card: ProductCard | None = None


def _is_nonempty(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


def _format_set_items(pc: ProductCard) -> str:
    if not pc.is_set:
        return ""
    items = pc.set_items
    if not items or not isinstance(items, list):
        return ""
    parts: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        label = item.get("article") or item.get("gtin") or ""
        label = str(label).strip()
        if not label:
            continue
        quantity = item.get("quantity", 1)
        try:
            qty = int(quantity)
        except (TypeError, ValueError):
            qty = 1
        if qty > 1:
            parts.append(f"{label}×{qty}")
        else:
            parts.append(label)
    return ", ".join(parts)


def _resolve_source_ref(source_ref: str, ctx: FieldResolveContext) -> str:
    if source_ref == "empty":
        return ""

    if source_ref == "code.gtin":
        return ctx.gtin or ""

    if source_ref == "code.cis_human":
        return get_short_cis(ctx.code) if ctx.code else ""

    if source_ref.startswith("extra_fields.extra."):
        json_key = source_ref[len("extra_fields.extra.") :]
        ef = ctx.extra_fields
        if ef is None:
            return ""
        extra = getattr(ef, "extra", None)
        if not isinstance(extra, dict):
            return ""
        value = extra.get(json_key)
        if value is None:
            return ""
        return str(value)

    if source_ref.startswith("extra_fields."):
        attr = source_ref.split(".", 1)[1]
        ef = ctx.extra_fields
        if ef is None:
            return ""
        return str(getattr(ef, attr, "") or "")

    if source_ref.startswith("product_card."):
        attr = source_ref.split(".", 1)[1]
        pc = ctx.product_card
        if pc is None:
            return ""
        if attr == "set_items":
            return _format_set_items(pc)
        value = getattr(pc, attr, None)
        if value is None:
            return ""
        return str(value)

    return ""


def resolve_field(key: str, ctx: FieldResolveContext) -> str:
    """Резолвит значение поля по ключу и приоритетному списку источников из каталога."""
    field = next((f for f in FIELD_CATALOG if f.key == key), None)
    if field is None:
        return ""

    for source_ref in field.sources:
        value = _resolve_source_ref(source_ref, ctx)
        if _is_nonempty(value):
            return value
    return ""


def field_catalog_metadata() -> list[dict[str, str]]:
    """Метаданные каталога для API."""
    return [
        {
            "key": f.key,
            "label": f.label,
            "source": f.sources[0] if f.sources else "",
            "example": f.example,
            "tab": f.tab,
        }
        for f in FIELD_CATALOG
    ]


def substitute_text(template: str, ctx: FieldResolveContext) -> str:
    """Подставляет плейсхолдеры {key} через каталог полей."""
    result = template
    for field in FIELD_CATALOG:
        placeholder = "{" + field.key + "}"
        if placeholder in result:
            result = result.replace(placeholder, resolve_field(field.key, ctx))
    return result
