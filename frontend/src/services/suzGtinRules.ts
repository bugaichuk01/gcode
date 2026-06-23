const RELEASE_METHOD_LOCAL = [
  "PRODUCTION",
  "IMPORT",
  "REMARK",
  "REMAINS",
  "COMMISSION",
  "REAPPLY",
] as const;

const RELEASE_METHOD_GLOBAL = ["IMPORT", "REMARK", "REMAINS", "COMMISSION", "REAPPLY"] as const;

export type ReleaseMethodType =
  | (typeof RELEASE_METHOD_LOCAL)[number]
  | (typeof RELEASE_METHOD_GLOBAL)[number];

export function normalizeGtin14(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const core = digits.length > 14 ? digits.slice(-14) : digits;
  return core.padStart(14, "0");
}

export function releaseMethodOptionsForGtin(gtin14: string): {
  defaultMethod: ReleaseMethodType;
  allowed: ReleaseMethodType[];
} {
  if (gtin14.startsWith("029")) {
    return { defaultMethod: "REMARK", allowed: ["REMARK", "REMAINS"] };
  }
  if (gtin14.startsWith("046") || gtin14.startsWith("004")) {
    return { defaultMethod: "PRODUCTION", allowed: [...RELEASE_METHOD_LOCAL] };
  }
  return { defaultMethod: "IMPORT", allowed: [...RELEASE_METHOD_GLOBAL] };
}

export function validateGtin14(gtin: string): string | null {
  const normalized = normalizeGtin14(gtin);
  if (!normalized || normalized.length !== 14) {
    return "GTIN должен содержать 14 цифр.";
  }
  return null;
}

export const RELEASE_METHOD_LABELS: Record<string, string> = {
  PRODUCTION: "Произведён в РФ",
  IMPORT: "Ввезён в РФ",
  REMAINS: "Маркировка остатков",
  REMARK: "Перемаркировка",
  COMMISSION: "Принят на комиссию от физлица",
  REAPPLY: "Маркировка вне производства",
};
