import type { FieldCatalogItem } from "../labels/blockRegistry";

export const EXTRA_JSON_SOURCE_PREFIX = "extra_fields.extra.";

export type ExtraCatalogField = {
  catalogKey: string;
  label: string;
  extraKey: string;
};

export function extraKeyFromCatalogSource(source: string): string | null {
  if (!source.startsWith(EXTRA_JSON_SOURCE_PREFIX)) {
    return null;
  }
  const key = source.slice(EXTRA_JSON_SOURCE_PREFIX.length);
  return key || null;
}

export function extraCatalogFieldsFromFieldCatalog(
  catalog: FieldCatalogItem[],
): ExtraCatalogField[] {
  return catalog
    .map((item) => {
      const extraKey = extraKeyFromCatalogSource(item.source);
      if (!extraKey) {
        return null;
      }
      return { catalogKey: item.key, label: item.label, extraKey };
    })
    .filter((item): item is ExtraCatalogField => item !== null);
}

export function emptyExtraFormState(fields: ExtraCatalogField[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.extraKey, ""]));
}

export function extraFormStateFromRecord(
  fields: ExtraCatalogField[],
  extra: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const source = extra && typeof extra === "object" ? extra : {};
  return Object.fromEntries(
    fields.map((field) => {
      const value = source[field.extraKey];
      return [field.extraKey, value != null ? String(value) : ""];
    }),
  );
}

export function buildExtraPayload(
  fields: ExtraCatalogField[],
  form: Record<string, string>,
): Record<string, string | null> {
  const extra: Record<string, string | null> = {};
  for (const { extraKey } of fields) {
    const trimmed = (form[extraKey] ?? "").trim();
    extra[extraKey] = trimmed === "" ? null : trimmed;
  }
  return extra;
}
