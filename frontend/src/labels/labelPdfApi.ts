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
