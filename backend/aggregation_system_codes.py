"""Системные штрихкоды режима «наклейка агрегатов после сборки».

Значения должны совпадать с frontend/src/constants/aggregationSystemCodes.ts
"""

AGGR_START_CODE = "AGGR_ST"
AGGR_END_CODE = "AGGR_FN"

AGGR_START_LABEL = "СТАРТ"
AGGR_END_LABEL = "КОНЕЦ"

SYSTEM_BARCODE_ITEMS: tuple[tuple[str, str], ...] = (
    (AGGR_START_CODE, AGGR_START_LABEL),
    (AGGR_END_CODE, AGGR_END_LABEL),
)
