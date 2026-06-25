import apiClient from "../api/client";

export interface LabelPdfFileListItem {
  id: string;
  filename: string;
  pages_count: number;
  codes_count: number;
  created_at: string;
}

export interface LabelPdfSplitFileItem {
  id: string;
  filename: string;
  pages_count: number;
}

export interface LabelPdfSplitResponse {
  files: LabelPdfSplitFileItem[];
}

export async function fetchLabelPdfFiles(): Promise<LabelPdfFileListItem[]> {
  const res = await apiClient.get<LabelPdfFileListItem[]>("/labels/pdf-files");
  return res.data;
}

export async function downloadLabelPdfFile(file: LabelPdfFileListItem): Promise<void> {
  const res = await apiClient.get(`/labels/pdf-files/${file.id}`, {
    responseType: "blob",
  });
  const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function formatPdfFileDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type LabelPreviewParams = {
  code: string;
  templateId?: string;
  widthMm: number;
  heightMm: number;
  startNumber?: number;
  barcodeType?: "ean13" | "code128";
  barcodeColumn?: string;
  barcodeKeepLeadingZero?: boolean;
  barcodeFromExtra?: boolean;
};

export async function fetchLabelPreview(params: LabelPreviewParams): Promise<Blob> {
  const response = await apiClient.post(
    "/labels/pdf/preview",
    {
      code: params.code,
      template_id: params.templateId ?? null,
      width_mm: params.widthMm,
      height_mm: params.heightMm,
      start_number: params.startNumber ?? 1,
      barcode_type: params.barcodeType ?? "ean13",
      barcode_column: params.barcodeColumn ?? "gtin",
      barcode_keep_leading_zero: params.barcodeKeepLeadingZero ?? true,
      barcode_from_extra: params.barcodeFromExtra ?? false,
    },
    { responseType: "blob" },
  );
  return response.data as Blob;
}

export type SsccPrintParams = {
  kituCodes: string[];
  widthMm: number;
  heightMm: number;
  copies: number;
  templateId?: string;
  startNumber?: number;
  splitFiles?: boolean;
  pagesPerFile?: number;
  continuousNumbering?: boolean;
};

export type SsccPreviewParams = {
  kituCode: string;
  templateId?: string;
  widthMm: number;
  heightMm: number;
  startNumber?: number;
};

export async function fetchSsccLabelPreview(params: SsccPreviewParams): Promise<Blob> {
  const response = await apiClient.post(
    "/labels/pdf/sscc/preview",
    {
      kitu_code: params.kituCode,
      template_id: params.templateId ?? null,
      width_mm: params.widthMm,
      height_mm: params.heightMm,
      start_number: params.startNumber ?? 1,
    },
    { responseType: "blob" },
  );
  return response.data as Blob;
}

export async function downloadAggregationSystemBarcodesPdf(): Promise<void> {
  const response = await apiClient.get("/labels/pdf/aggregation-system-barcodes", {
    responseType: "blob",
  });
  const url = URL.createObjectURL(new Blob([response.data], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "aggregation_system_barcodes.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function printSsccLabelPdf(
  params: SsccPrintParams,
): Promise<{ kind: "inline" } | { kind: "split"; filesCount: number }> {
  const requestBody = {
    kitu_codes: params.kituCodes,
    copies: params.copies,
    start_number: params.startNumber ?? 1,
    split_files: params.splitFiles ?? false,
    pages_per_file: params.pagesPerFile ?? 100,
    continuous_numbering: params.continuousNumbering ?? false,
  };

  if (params.splitFiles) {
    const response = await apiClient.post("/labels/pdf/sscc", {
      ...requestBody,
      template_id: params.templateId ?? null,
      width_mm: params.widthMm,
      height_mm: params.heightMm,
    });
    const filesCount = Array.isArray(response.data?.files) ? response.data.files.length : 0;
    return { kind: "split", filesCount };
  }

  const response = await apiClient.post(
    "/labels/pdf/sscc",
    {
      ...requestBody,
      template_id: params.templateId ?? null,
      width_mm: params.widthMm,
      height_mm: params.heightMm,
    },
    { responseType: "blob" },
  );

  const url = URL.createObjectURL(new Blob([response.data], { type: "application/pdf" }));
  const win = window.open(url, "_blank");
  if (win) {
    win.onload = () => {
      win.print();
    };
  }
  return { kind: "inline" };
}

export type AggregationPrintParams = {
  docIds?: string[];
  kituCodes?: string[];
  kituTemplateId: string;
  unitTemplateId: string;
  startNumber?: number;
  save?: boolean;
};

export async function printAggregationLabelsPdf(
  params: AggregationPrintParams,
): Promise<void> {
  const response = await apiClient.post(
    "/labels/pdf/aggregation",
    {
      doc_ids: params.docIds ?? null,
      kitu_codes: params.kituCodes ?? null,
      kitu_template_id: params.kituTemplateId,
      unit_template_id: params.unitTemplateId,
      start_number: params.startNumber ?? 1,
      save: params.save ?? true,
      single_file: true,
      split_files: false,
    },
    { responseType: "blob" },
  );

  const url = URL.createObjectURL(new Blob([response.data], { type: "application/pdf" }));
  const win = window.open(url, "_blank");
  if (win) {
    win.onload = () => {
      win.print();
    };
  }
}
