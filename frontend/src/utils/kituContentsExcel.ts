import * as XLSX from "xlsx";

export const KITU_CONTENTS_EXCEL_HEADERS = {
  code: "КМ",
  gtin: "GTIN",
  product: "Товар",
} as const;

export const KITU_CONTENTS_EXCEL_HEADER_LIST = [
  KITU_CONTENTS_EXCEL_HEADERS.code,
  KITU_CONTENTS_EXCEL_HEADERS.gtin,
  KITU_CONTENTS_EXCEL_HEADERS.product,
] as const;

export type KituContentsExcelRecord = {
  code: string;
  gtin: string;
  product: string;
};

function recordToExcelRow(item: KituContentsExcelRecord): Record<string, string> {
  return {
    [KITU_CONTENTS_EXCEL_HEADERS.code]: item.code,
    [KITU_CONTENTS_EXCEL_HEADERS.gtin]: item.gtin,
    [KITU_CONTENTS_EXCEL_HEADERS.product]: item.product,
  };
}

export function exportKituContentsToXlsx(
  items: KituContentsExcelRecord[],
  filename: string,
): void {
  const data = items.map((item) => recordToExcelRow(item));
  const ws = XLSX.utils.json_to_sheet(data, {
    header: [...KITU_CONTENTS_EXCEL_HEADER_LIST],
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Вложения КИТУ");
  XLSX.writeFile(wb, filename);
}
