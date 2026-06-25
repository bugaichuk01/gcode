/**
 * Системные штрихкоды режима «наклейка агрегатов после сборки».
 * Значения должны совпадать с backend/aggregation_system_codes.py
 */
export const AGGR_START_CODE = "AGGR_ST";
export const AGGR_END_CODE = "AGGR_FN";

export const AGGR_START_LABEL = "СТАРТ";
export const AGGR_END_LABEL = "КОНЕЦ";

export const AGGREGATION_SYSTEM_BARCODE_ITEMS = [
  { code: AGGR_START_CODE, label: AGGR_START_LABEL },
  { code: AGGR_END_CODE, label: AGGR_END_LABEL },
] as const;
