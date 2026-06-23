import apiClient from "../api/client";

export const CIS_STATUS_BATCH_SIZE = 50;

export type CisStatusApiItem = {
  cis: string;
  status?: string | null;
  owner_inn?: string | null;
  owner_name?: string | null;
  gtin?: string | null;
  produced_date?: string | null;
  error?: string | null;
};

/** Поля строки кода, которые заполняются из ответа POST /emission-orders/codes/check-status */
export type CisStatusRowFields = {
  status: string;
  gtin: string | null;
  ownerInn: string | null;
  ownerName: string | null;
  producedDate: string | null;
};

export const CIS_STATUS_FIELD_MAP = {
  status: (item: CisStatusApiItem) => item.status || item.error || "unknown",
  gtin: (item: CisStatusApiItem) => item.gtin ?? null,
  ownerInn: (item: CisStatusApiItem) => item.owner_inn ?? null,
  ownerName: (item: CisStatusApiItem) => item.owner_name ?? null,
  producedDate: (item: CisStatusApiItem) => item.produced_date ?? null,
} as const satisfies Record<keyof CisStatusRowFields, (item: CisStatusApiItem) => string | null>;

export function mapCisStatusItemToRowFields(item: CisStatusApiItem): CisStatusRowFields {
  return {
    status: CIS_STATUS_FIELD_MAP.status(item),
    gtin: CIS_STATUS_FIELD_MAP.gtin(item),
    ownerInn: CIS_STATUS_FIELD_MAP.ownerInn(item),
    ownerName: CIS_STATUS_FIELD_MAP.ownerName(item),
    producedDate: CIS_STATUS_FIELD_MAP.producedDate(item),
  };
}

export function mergeCisStatusBatch(
  existing: Record<string, CisStatusRowFields>,
  batch: CisStatusApiItem[],
  requestCodes: string[],
): Record<string, CisStatusRowFields> {
  const next = { ...existing };
  batch.forEach((item, idx) => {
    const requestCode = requestCodes[idx];
    if (!requestCode) {
      return;
    }
    const fields = mapCisStatusItemToRowFields(item);
    next[requestCode] = fields;
    if (item.cis && item.cis !== requestCode) {
      next[item.cis] = fields;
    }
  });
  return next;
}

export async function fetchCisStatuses(
  codes: string[],
  onProgress?: (checked: number) => void,
): Promise<Record<string, CisStatusRowFields>> {
  let allResults: Record<string, CisStatusRowFields> = {};

  for (let i = 0; i < codes.length; i += CIS_STATUS_BATCH_SIZE) {
    const batch = codes.slice(i, i + CIS_STATUS_BATCH_SIZE);
    const res = await apiClient.post<{ results: CisStatusApiItem[] }>(
      "/emission-orders/codes/check-status",
      { cises: batch },
    );
    allResults = mergeCisStatusBatch(allResults, res.data.results, batch);
    onProgress?.(Math.min(i + batch.length, codes.length));
  }

  return allResults;
}

export const CIS_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  INTRODUCED: { label: "В обороте", className: "badge-published" },
  APPLIED: { label: "Нанесён", className: "badge-info" },
  EMITTED: { label: "Эмитирован", className: "badge-warning" },
  WRITTEN_OFF: { label: "Выбыл", className: "badge-draft" },
  RETIRED: { label: "Выбыл", className: "badge-draft" },
  not_found: { label: "Не найден в ЧЗ", className: "badge-draft" },
  error: { label: "Ошибка", className: "badge-error" },
  unknown: { label: "Неизвестен", className: "badge-warning" },
};

export function formatCisStatusLabel(status: string): string {
  return CIS_STATUS_LABELS[status]?.label ?? status;
}
