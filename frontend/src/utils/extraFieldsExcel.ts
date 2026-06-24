import * as XLSX from "xlsx";
import type { BulkFormKey } from "./extraFieldsCatalog";
import {
  PRINT_NAME_EXTRA_KEY,
  USER_FIELD_COUNT,
  userFieldLabelKey,
  userFieldValueKey,
  type ExtraCatalogField,
} from "./extraFieldsCatalog";

/**
 * Маппинг заголовков Excel → поля доп.полей (round-trip экспорт/импорт).
 *
 * Семантика пустых ячеек при импорте: как bulk (P5.1) — пустая ячейка НЕ отправляется
 * и НЕ затирает существующее значение в БД. Импорт после экспорта без правок не меняет данные.
 */
export type ExtraFieldsExcelColumn =
  | { kind: "gtin"; header: "GTIN"; key: "gtin" }
  | { kind: "column"; header: string; key: BulkFormKey }
  | { kind: "extra"; header: string; key: string };

const COLUMN_FIELD_HEADERS: { header: string; key: BulkFormKey }[] = [
  { header: "Наименование", key: "name" },
  { header: "Артикул", key: "article" },
  { header: "Размер", key: "size" },
  { header: "Цвет", key: "color" },
  { header: "Баркод", key: "barcode" },
  { header: "Страна производства", key: "country" },
  { header: "Бренд", key: "brand" },
  { header: "Состав", key: "composition" },
  { header: "ИНН (ЭДО)", key: "edo_inn" },
  { header: "КПП (ЭДО)", key: "edo_kpp" },
  { header: "Адрес (ЭДО)", key: "edo_address" },
];

const GTIN_HEADER_ALIASES = ["gtin", "гтин"];

export type ExtraFieldExcelRecord = {
  gtin: string;
  name: string | null;
  article: string | null;
  size: string | null;
  color: string | null;
  barcode: string | null;
  country: string | null;
  brand: string | null;
  composition: string | null;
  edo_inn: string | null;
  edo_kpp: string | null;
  edo_address: string | null;
  extra?: Record<string, unknown>;
};

export type ExtraFieldsImportRow = {
  gtin: string;
  fields: Record<string, unknown>;
};

export type ExtraFieldsImportPreview = {
  rows: ExtraFieldsImportRow[];
  total: number;
  toCreate: number;
  toUpdate: number;
  skipped: number;
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildExtraFieldsExcelColumns(
  catalogFields: ExtraCatalogField[],
): ExtraFieldsExcelColumn[] {
  const columns: ExtraFieldsExcelColumn[] = [
    { kind: "gtin", header: "GTIN", key: "gtin" },
    ...COLUMN_FIELD_HEADERS.map(({ header, key }) => ({
      kind: "column" as const,
      header,
      key,
    })),
    { kind: "extra", header: "Наименование для печати", key: PRINT_NAME_EXTRA_KEY },
  ];

  for (let n = 1; n <= USER_FIELD_COUNT; n += 1) {
    columns.push({
      kind: "extra",
      header: `Поле ${n} — наименование`,
      key: userFieldLabelKey(n),
    });
    columns.push({
      kind: "extra",
      header: `Поле ${n} — значение`,
      key: userFieldValueKey(n),
    });
  }

  for (const field of catalogFields) {
    columns.push({
      kind: "extra",
      header: field.label,
      key: field.extraKey,
    });
  }

  return columns;
}

export function buildHeaderToColumnMap(
  columns: ExtraFieldsExcelColumn[],
): Map<string, ExtraFieldsExcelColumn> {
  const map = new Map<string, ExtraFieldsExcelColumn>();
  for (const column of columns) {
    map.set(normalizeHeader(column.header), column);
  }
  for (const alias of GTIN_HEADER_ALIASES) {
    const gtinColumn = columns.find((column) => column.kind === "gtin");
    if (gtinColumn) {
      map.set(alias, gtinColumn);
    }
  }
  return map;
}

function cellToString(value: unknown): string {
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

export function normalizeGtinInput(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 14) {
    return null;
  }
  if (digits.length === 13) {
    return `0${digits}`;
  }
  return digits;
}

export function extraFieldItemToExcelRow(
  item: ExtraFieldExcelRecord,
  columns: ExtraFieldsExcelColumn[],
): Record<string, string> {
  const row: Record<string, string> = {};
  const extra = item.extra && typeof item.extra === "object" ? item.extra : {};

  for (const column of columns) {
    if (column.kind === "gtin") {
      row[column.header] = item.gtin;
      continue;
    }
    if (column.kind === "column") {
      const value = item[column.key];
      row[column.header] = value != null ? String(value) : "";
      continue;
    }
    const value = extra[column.key];
    row[column.header] = value != null ? String(value) : "";
  }

  return row;
}

export function exportExtraFieldsToXlsx(
  items: ExtraFieldExcelRecord[],
  columns: ExtraFieldsExcelColumn[],
  filename: string,
): void {
  const data = items.map((item) => extraFieldItemToExcelRow(item, columns));
  const ws = XLSX.utils.json_to_sheet(data, {
    header: columns.map((column) => column.header),
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Доп. поля");
  XLSX.writeFile(wb, filename);
}

function buildImportFieldsFromRow(
  row: Record<string, unknown>,
  headerToColumn: Map<string, ExtraFieldsExcelColumn>,
): Record<string, unknown> {
  const columnFields: Record<string, string> = {};
  const extraFields: Record<string, string> = {};

  for (const [header, value] of Object.entries(row)) {
    const column = headerToColumn.get(normalizeHeader(header));
    if (!column || column.kind === "gtin") {
      continue;
    }
    const text = cellToString(value);
    if (!text) {
      continue;
    }
    if (column.kind === "column") {
      columnFields[column.key] = text;
      continue;
    }
    extraFields[column.key] = text;
  }

  const fields: Record<string, unknown> = { ...columnFields };
  if (Object.keys(extraFields).length > 0) {
    fields.extra = extraFields;
  }
  return fields;
}

export function parseExtraFieldsExcel(
  buffer: ArrayBuffer,
  columns: ExtraFieldsExcelColumn[],
  existingGtins: Set<string>,
): { preview: ExtraFieldsImportPreview | null; error: string | null } {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array" });
  } catch {
    return { preview: null, error: "Не удалось прочитать файл Excel. Проверьте формат .xlsx." };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { preview: null, error: "Файл пуст или не содержит листов." };
  }

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });

  if (rawRows.length === 0) {
    return { preview: null, error: "В файле нет строк данных." };
  }

  const headerToColumn = buildHeaderToColumnMap(columns);
  const hasGtinColumn = Object.keys(rawRows[0]).some((header) =>
    headerToColumn.get(normalizeHeader(header))?.kind === "gtin",
  );
  if (!hasGtinColumn) {
    return {
      preview: null,
      error: 'В файле отсутствует обязательная колонка "GTIN".',
    };
  }

  const importRows: ExtraFieldsImportRow[] = [];
  let skipped = 0;

  for (const rawRow of rawRows) {
    let gtinRaw = "";
    for (const [header, value] of Object.entries(rawRow)) {
      const column = headerToColumn.get(normalizeHeader(header));
      if (column?.kind === "gtin") {
        gtinRaw = cellToString(value);
        break;
      }
    }

    if (!gtinRaw) {
      skipped += 1;
      continue;
    }

    const gtin = normalizeGtinInput(gtinRaw);
    if (!gtin) {
      skipped += 1;
      continue;
    }

    const fields = buildImportFieldsFromRow(rawRow, headerToColumn);
    if (Object.keys(fields).length === 0) {
      skipped += 1;
      continue;
    }

    importRows.push({ gtin, fields });
  }

  if (importRows.length === 0) {
    return {
      preview: null,
      error: "Нет строк с корректным GTIN и заполненными полями для импорта.",
    };
  }

  const uniqueRows = new Map<string, ExtraFieldsImportRow>();
  for (const row of importRows) {
    uniqueRows.set(row.gtin, row);
  }
  const dedupedRows = [...uniqueRows.values()];

  let toCreate = 0;
  let toUpdate = 0;
  for (const row of dedupedRows) {
    if (existingGtins.has(row.gtin)) {
      toUpdate += 1;
    } else {
      toCreate += 1;
    }
  }

  return {
    preview: {
      rows: dedupedRows,
      total: dedupedRows.length,
      toCreate,
      toUpdate,
      skipped,
    },
    error: null,
  };
}
