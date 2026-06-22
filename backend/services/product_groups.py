"""Справочник товарных групп маркировки."""

# Маппинг gismt_codes из API НК → product_group СУЗ
# Проверено по sandbox НК (api.nk.sandbox.crptech.ru/v3/categories)
GISMT_TO_PRODUCT_GROUP: dict[int, str] = {
    1:  "linen",       # Белье постельное, столовое
    2:  "shoes",       # Обувь
    3:  "tobacco",     # Сигареты, папиросы
    4:  "perfumery",   # Парфюмерия, туалетная вода
    5:  "tires",       # Шины и покрышки
    6:  "photo",       # Фотокамеры
    8:  "milk",        # Молочная продукция
    9:  "bicycle",     # Велосипеды, рамы велосипедные
    10: "medicines",   # Медизделия, диагностика in vitro
    12: "tobacco",     # Табак курительный
    13: "water",       # Воды питьевые и минеральные
    19: "antiseptic",  # Средства антисептические
    48: "automotive",  # Свечи зажигания, стекло для ТС
    # 15 → пиво/сидр — не наша группа, пропускаем
}

# Обратный маппинг
PRODUCT_GROUP_TO_GISMT: dict[str, int] = {
    v: k for k, v in GISMT_TO_PRODUCT_GROUP.items()
}

# Человекочитаемые названия
PRODUCT_GROUP_LABELS: dict[str, str] = {
    "lp":         "Лёгкая промышленность",
    "perfumery":  "Духи и туалетная вода",
    "shoes":      "Обувь",
    "linen":      "Постельное бельё",
    "tires":      "Шины и покрышки",
    "milk":       "Молочная продукция",
    "water":      "Питьевая вода",
    "tobacco":    "Табак",
    "medicines":  "Лекарственные препараты",
    "photo":      "Фотоаппараты",
    "bicycle":    "Велосипеды",
    "antiseptic": "Антисептики",
    "automotive": "Автозапчасти и комплектующие",
}

# ТНВЭД коды для каждой группы
# Источник: постановления правительства РФ о маркировке
PRODUCT_GROUP_TO_TNVED: dict[str, list[str]] = {
    "lp":         ["6101","6102","6103","6104","6105","6106","6107","6108",
                   "6109","6110","6111","6112","6113","6114","6115","6116",
                   "6117","6201","6202","6203","6204","6205","6206","6207",
                   "6208","6209","6210","6211","6212","6213","6214","6215",
                   "6216","6217"],
    "perfumery":  ["3303","3304","3305","3307"],
    "shoes":      ["6401","6402","6403","6404","6405"],
    "linen":      ["6301","6302","6303","6304"],
    "tires":      ["4011","4012"],
    "milk":       ["0401","0402","0403","0404","0405","0406"],
    "water":      ["2201","2202"],
    "tobacco":    ["2401","2402","2403"],
    "medicines":  ["3006","3004","3002"],
    "photo":      ["9006","9007"],
    "bicycle":    ["8712","8714"],
    "antiseptic": ["3808","3402"],
    "automotive": ["8708","8421","8507","8512","6813",
                   "7009","3917","8413","8536","3926"],
}

# Обратный маппинг ТНВЭД → product_group
TNVED_TO_PRODUCT_GROUP: dict[str, str] = {
    tnved: pg
    for pg, codes in PRODUCT_GROUP_TO_TNVED.items()
    for tnved in codes
}

# Группы где технические карточки РАЗРЕШЕНЫ (whitelist НК п.7.1.4)
TECH_GTIN_ALLOWED_GROUPS: frozenset[str] = frozenset({
    "perfumery", "lp", "shoes", "tires", "tobacco",
    "water", "antiseptic", "photo", "bicycle",
})

# Для групп где НК требует 10-значный ТНВЭД вместо 4-значного
# Ключ: 4-значный prefix → список 10-значных кодов из preset НК
TNVED_SHORT_TO_FULL: dict[str, list[str]] = {
    "8714": ["8714911001", "8714911004", "8714911007", "8714911009"],
    "8712": ["8714911001"],  # рамы идут под 8714 в НК
}


def resolve_full_tnved(tnved: str) -> str:
    """
    Вернуть полный ТНВЭД код для отправки в НК.
    Если код 4-значный и есть маппинг — вернуть первый полный.
    Иначе вернуть как есть.
    """
    tnved = (tnved or "").strip()
    if len(tnved) <= 4:
        full_codes = TNVED_SHORT_TO_FULL.get(tnved)
        if full_codes:
            return full_codes[0]
    return tnved


# Справочник СУЗ №7 «Шаблоны КМ» (templateId) — OMS API Guide "MC Templates", Table 199
PRODUCT_GROUP_TO_SUZ_TEMPLATE: dict[str, int] = {
    "shoes": 1,
    "tobacco": 4,       # пачки (UNIT); блоки — 3
    "medicines": 5,
    "tires": 7,
    "photo": 8,
    "perfumery": 9,
    "perfum": 9,
    "lp": 10,
    "linen": 10,
    "bicycle": 11,
    "bicycles": 11,
    "water": 16,
    "milk": 20,
    "antiseptic": 25,
}

# Алиасы product_group для поля productGroup в API СУЗ
PRODUCT_GROUP_SUZ_ALIASES: dict[str, str] = {
    "bicycles": "bicycle",
    "perfum": "perfumery",
}


def normalize_suz_product_group(product_group: str | None) -> str:
    """Нормализовать код товарной группы для API СУЗ."""
    g = (product_group or "").strip().lower()
    return PRODUCT_GROUP_SUZ_ALIASES.get(g, g)


def resolve_suz_template_id(product_group: str | None, *, fallback: int = 9) -> int:
    """Подобрать templateId по товарной группе; fallback — из настроек (.env)."""
    g = normalize_suz_product_group(product_group)
    if g in {"perfume"}:
        return 9
    return PRODUCT_GROUP_TO_SUZ_TEMPLATE.get(g, fallback)


def detect_product_group(cat_name: str) -> str:
    """Определить product_group по названию категории НК."""
    name_lower = cat_name.lower()
    KEYWORDS = {
        "велосипед": "bicycle",
        "рама велосипед": "bicycle",
        "духи": "perfumery",
        "туалетная вода": "perfumery",
        "парфюм": "perfumery",
        "одеколон": "perfumery",
        "одежда": "lp",
        "текстиль": "lp",
        "белье": "linen",
        "постельное": "linen",
        "обувь": "shoes",
        "шины": "tires",
        "покрышки": "tires",
        "молоко": "milk",
        "молочн": "milk",
        "вода питьевая": "water",
        "вода упакованная": "water",
        "вода минеральная": "water",
        "табак": "tobacco",
        "сигарет": "tobacco",
        "лекарств": "medicines",
        "препарат": "medicines",
        "фотоаппарат": "photo",
        "фотокамер": "photo",
        "антисептик": "antiseptic",
        "автозапчаст": "automotive",
        "запчаст": "automotive",
        "транспортн": "automotive",
    }
    for keyword in sorted(KEYWORDS.keys(), key=len, reverse=True):
        if keyword in name_lower:
            return KEYWORDS[keyword]
    return "other"


def get_product_group_label(pg: str) -> str:
    return PRODUCT_GROUP_LABELS.get(pg, pg)
