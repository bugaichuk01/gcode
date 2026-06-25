import * as XLSX from "xlsx";

/**
 * Маппинг заголовков Excel ↔ поля агрегатов КИТУ (round-trip экспорт/импорт).
 *
 * Колонки: КИТУ, Количество вложений, Статус.
 * Пустое «Количество вложений» или «Без ограничений» → units_capacity = null.
 */
export const KITU_EXCEL_HEADERS = {
  kitu: "КИТУ",
  unitsCapacity: "Количество вложений",
  status: "Статус",
} as const;

export const KITU_EXCEL_HEADER_LIST = [
  KITU_EXCEL_HEADERS.kitu,
  KITU_EXCEL_HEADERS.unitsCapacity,
  KITU_EXCEL_HEADERS.status,
] as const;

export const KITU_STATUS_GENERATED = "Сгенерирован";
export const KITU_STATUS_UNIQUE = "Уникален";
export const KITU_STATUS_EXISTS = "Уже существует";
export const KITU_STATUS_CHECK_ERROR = "Ошибка проверки";

const UNLIMITED_ALIASES = ["без ограничений", "unlimited", "∞"];

export type KituExcelRecord = {
  kitu_code: string;
  units_capacity: number | null;
  status: string;
};

export type KituExcelImportItem = {
  kitu_code: string;
  units_capacity: number | null;
};

export type KituExcelInvalidRow = {
  row: number;
  kitu: string;
  reason: string;
};

export type KituExcelImportPreview = {
  items: KituExcelImportItem[];
  total: number;
  skippedEmpty: number;
  skippedInvalid: KituExcelInvalidRow[];
  skippedDuplicateInFile: number;
  skippedDuplicateExisting: number;
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function cellToString(value: unknown): string {
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

function gs1CheckDigit(digits: string): number {
  let total = 0;
  for (let i = 0; i < digits.length; i += 1) {
    const n = Number(digits[digits.length - 1 - i]);
    total += i % 2 === 0 ? n * 3 : n;
  }
  return (10 - (total % 10)) % 10;
}

/** Проверить контрольную цифру GS1 для 18-значного SSCC (как verify_sscc_check_digit на бэке). */
export function verifySsccCheckDigit(sscc: string): boolean {
  if (sscc.length !== 18 || !/^\d+$/.test(sscc)) {
    return false;
  }
  return Number(sscc[17]) === gs1CheckDigit(sscc.slice(0, 17));
}

export function normalizeKituCode(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 18) {
    return null;
  }
  if (!verifySsccCheckDigit(digits)) {
    return null;
  }
  return digits;
}

export function formatUnitsCapacityForExcel(capacity: number | null): string {
  return capacity === null ? "" : String(capacity);
}

export function parseUnitsCapacityFromExcel(raw: string): number | null | "invalid" {
  const text = raw.trim();
  if (!text) {
    return null;
  }
  if (UNLIMITED_ALIASES.includes(text.toLowerCase())) {
    return null;
  }
  const digits = text.replace(/\s/g, "");
  if (!/^\d+$/.test(digits)) {
    return "invalid";
  }
  const value = Number(digits);
  if (!Number.isInteger(value) || value < 1) {
    return "invalid";
  }
  return value;
}

export function formatKituStatusForExcel(status: string): string {
  if (status === "generated") {
    return KITU_STATUS_GENERATED;
  }
  if (status === "unique") {
    return KITU_STATUS_UNIQUE;
  }
  if (status === "exists") {
    return KITU_STATUS_EXISTS;
  }
  if (status === "check_error") {
    return KITU_STATUS_CHECK_ERROR;
  }
  return status;
}

export function kituRecordToExcelRow(record: KituExcelRecord): Record<string, string> {
  return {
    [KITU_EXCEL_HEADERS.kitu]: record.kitu_code,
    [KITU_EXCEL_HEADERS.unitsCapacity]: formatUnitsCapacityForExcel(record.units_capacity),
    [KITU_EXCEL_HEADERS.status]: record.status,
  };
}

export function exportKituToXlsx(
  items: KituExcelRecord[],
  filename: string,
): void {
  const data = items.map((item) => kituRecordToExcelRow(item));
  const ws = XLSX.utils.json_to_sheet(data, {
    header: [...KITU_EXCEL_HEADER_LIST],
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "КИТУ");
  XLSX.writeFile(wb, filename);
}

function findColumnKey(
  row: Record<string, unknown>,
  normalizedHeader: string,
): string | null {
  for (const header of Object.keys(row)) {
    if (normalizeHeader(header) === normalizedHeader) {
      return header;
    }
  }
  return null;
}

function resolveKituColumns(firstRow: Record<string, unknown>): {
  kituKey: string | null;
  capacityKey: string | null;
  statusKey: string | null;
} {
  return {
    kituKey: findColumnKey(firstRow, normalizeHeader(KITU_EXCEL_HEADERS.kitu)),
    capacityKey: findColumnKey(firstRow, normalizeHeader(KITU_EXCEL_HEADERS.unitsCapacity)),
    statusKey: findColumnKey(firstRow, normalizeHeader(KITU_EXCEL_HEADERS.status)),
  };
}

export function parseKituExcel(
  buffer: ArrayBuffer,
  existingKituCodes: Set<string>,
): { preview: KituExcelImportPreview | null; error: string | null } {
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

  const { kituKey, capacityKey } = resolveKituColumns(rawRows[0]);
  if (!kituKey) {
    return {
      preview: null,
      error: `В файле отсутствует обязательная колонка «${KITU_EXCEL_HEADERS.kitu}».`,
    };
  }

  const parsedByKitu = new Map<string, KituExcelImportItem>();
  let skippedEmpty = 0;
  let skippedDuplicateInFile = 0;
  let skippedDuplicateExisting = 0;
  const skippedInvalid: KituExcelInvalidRow[] = [];

  rawRows.forEach((rawRow, index) => {
    const rowNum = index + 2;
    const kituRaw = cellToString(rawRow[kituKey]);
    if (!kituRaw) {
      skippedEmpty += 1;
      return;
    }

    const capacityRaw = capacityKey ? cellToString(rawRow[capacityKey]) : "";
    const capacity = parseUnitsCapacityFromExcel(capacityRaw);
    if (capacity === "invalid") {
      skippedInvalid.push({
        row: rowNum,
        kitu: kituRaw,
        reason: "Некорректное количество вложений",
      });
      return;
    }

    const kituCode = normalizeKituCode(kituRaw);
    if (!kituCode) {
      const digits = kituRaw.replace(/\D/g, "");
      let reason = "Невалидный SSCC";
      if (digits.length !== 18) {
        reason = `SSCC должен содержать 18 цифр (найдено ${digits.length})`;
      } else {
        reason = "Неверная контрольная цифра GS1";
      }
      skippedInvalid.push({ row: rowNum, kitu: kituRaw, reason });
      return;
    }

    if (parsedByKitu.has(kituCode)) {
      skippedDuplicateInFile += 1;
    }
    parsedByKitu.set(kituCode, { kitu_code: kituCode, units_capacity: capacity });
  });

  const items: KituExcelImportItem[] = [];
  for (const item of parsedByKitu.values()) {
    if (existingKituCodes.has(item.kitu_code)) {
      skippedDuplicateExisting += 1;
      continue;
    }
    items.push(item);
  }

  if (items.length === 0 && skippedInvalid.length === 0 && skippedEmpty > 0) {
    return { preview: null, error: "Нет строк с заполненным КИТУ для импорта." };
  }

  if (items.length === 0 && skippedInvalid.length > 0) {
    const first = skippedInvalid[0];
    return {
      preview: null,
      error: `Нет валидных КИТУ для импорта. Строка ${first.row}: ${first.reason}.`,
    };
  }

  if (items.length === 0 && skippedDuplicateExisting > 0) {
    return {
      preview: null,
      error: "Все КИТУ из файла уже есть в таблице.",
    };
  }

  return {
    preview: {
      items,
      total: items.length,
      skippedEmpty,
      skippedInvalid,
      skippedDuplicateInFile,
      skippedDuplicateExisting,
    },
    error: null,
  };
}
