import type { FieldCatalogItem } from "../labels/blockRegistry";

export const EXTRA_JSON_SOURCE_PREFIX = "extra_fields.extra.";
export const USER_FIELD_COUNT = 10;
export const PRINT_NAME_EXTRA_KEY = "print_name";

export type ExtraCatalogField = {
  catalogKey: string;
  label: string;
  extraKey: string;
};

const USER_FIELD_VALUE_RE = /^field_(\d+)$/;
const USER_FIELD_LABEL_RE = /^field_(\d+)_label$/;

export function userFieldValueKey(n: number): string {
  return `field_${n}`;
}

export function userFieldLabelKey(n: number): string {
  return `field_${n}_label`;
}

export function isUserFieldValueExtraKey(key: string): boolean {
  return USER_FIELD_VALUE_RE.test(key);
}

export function isUserFieldLabelExtraKey(key: string): boolean {
  return USER_FIELD_LABEL_RE.test(key);
}

export function userFieldNumberFromValueKey(key: string): number | null {
  const match = key.match(USER_FIELD_VALUE_RE);
  if (!match) {
    return null;
  }
  const n = Number(match[1]);
  return n >= 1 && n <= USER_FIELD_COUNT ? n : null;
}

export function extraKeyFromCatalogSource(source: string): string | null {
  if (!source.startsWith(EXTRA_JSON_SOURCE_PREFIX)) {
    return null;
  }
  const key = source.slice(EXTRA_JSON_SOURCE_PREFIX.length);
  return key || null;
}

function isManagedExtraKey(key: string): boolean {
  return (
    isUserFieldValueExtraKey(key) ||
    isUserFieldLabelExtraKey(key) ||
    key === PRINT_NAME_EXTRA_KEY
  );
}

export function extraCatalogFieldsFromFieldCatalog(
  catalog: FieldCatalogItem[],
): ExtraCatalogField[] {
  return catalog
    .map((item) => {
      const extraKey = extraKeyFromCatalogSource(item.source);
      if (!extraKey || isManagedExtraKey(extraKey)) {
        return null;
      }
      return { catalogKey: item.key, label: item.label, extraKey };
    })
    .filter((item): item is ExtraCatalogField => item !== null);
}

export function emptyExtraFormState(
  fields: ExtraCatalogField[],
  includeUserFields = true,
): Record<string, string> {
  const state = Object.fromEntries(fields.map((field) => [field.extraKey, ""]));
  if (includeUserFields) {
    for (let n = 1; n <= USER_FIELD_COUNT; n += 1) {
      state[userFieldValueKey(n)] = "";
      state[userFieldLabelKey(n)] = "";
    }
    state[PRINT_NAME_EXTRA_KEY] = "";
  }
  return state;
}

export function extraFormStateFromRecord(
  fields: ExtraCatalogField[],
  extra: Record<string, unknown> | null | undefined,
  includeUserFields = true,
): Record<string, string> {
  const source = extra && typeof extra === "object" ? extra : {};
  const state = Object.fromEntries(
    fields.map((field) => {
      const value = source[field.extraKey];
      return [field.extraKey, value != null ? String(value) : ""];
    }),
  );
  if (includeUserFields) {
    for (let n = 1; n <= USER_FIELD_COUNT; n += 1) {
      const valueKey = userFieldValueKey(n);
      const labelKey = userFieldLabelKey(n);
      const value = source[valueKey];
      const label = source[labelKey];
      state[valueKey] = value != null ? String(value) : "";
      state[labelKey] = label != null ? String(label) : "";
    }
    const printName = source[PRINT_NAME_EXTRA_KEY];
    state[PRINT_NAME_EXTRA_KEY] = printName != null ? String(printName) : "";
  }
  return state;
}

function assignExtraKey(
  extra: Record<string, string | null>,
  key: string,
  value: string,
  forBulk: boolean,
): void {
  const trimmed = value.trim();
  if (forBulk) {
    if (trimmed !== "") {
      (extra as Record<string, string>)[key] = trimmed;
    }
    return;
  }
  extra[key] = trimmed === "" ? null : trimmed;
}

export function buildUserFieldsExtraPayload(
  form: Record<string, string>,
  forBulk: boolean,
): Record<string, string | null> | Record<string, string> {
  const extra: Record<string, string | null> = {};
  for (let n = 1; n <= USER_FIELD_COUNT; n += 1) {
    assignExtraKey(extra, userFieldValueKey(n), form[userFieldValueKey(n)] ?? "", forBulk);
    assignExtraKey(extra, userFieldLabelKey(n), form[userFieldLabelKey(n)] ?? "", forBulk);
  }
  return extra;
}

export function buildExtraPayload(
  fields: ExtraCatalogField[],
  form: Record<string, string>,
): Record<string, string | null> {
  const extra: Record<string, string | null> = {};
  for (const { extraKey } of fields) {
    assignExtraKey(extra, extraKey, form[extraKey] ?? "", false);
  }
  return extra;
}

export function buildFullExtraPayload(
  fields: ExtraCatalogField[],
  form: Record<string, string>,
  forBulk: boolean,
): Record<string, string | null> | Record<string, string> {
  const catalogExtra = forBulk
    ? buildBulkExtraPayload(fields, form)
    : buildExtraPayload(fields, form);
  const userFieldsExtra = buildUserFieldsExtraPayload(form, forBulk);
  const printName = (form[PRINT_NAME_EXTRA_KEY] ?? "").trim();
  const merged: Record<string, string | null | string> = {
    ...catalogExtra,
    ...userFieldsExtra,
  };
  if (forBulk) {
    if (printName !== "") {
      merged[PRINT_NAME_EXTRA_KEY] = printName;
    }
    return merged as Record<string, string>;
  }
  merged[PRINT_NAME_EXTRA_KEY] = printName === "" ? null : printName;
  return merged as Record<string, string | null>;
}

/** Только непустые extra-поля для массового применения (пустые не отправляются). */
export function buildBulkExtraPayload(
  fields: ExtraCatalogField[],
  form: Record<string, string>,
): Record<string, string> {
  return buildFullExtraPayload(fields, form, true) as Record<string, string>;
}

const BULK_FORM_KEYS = [
  "name",
  "article",
  "size",
  "color",
  "barcode",
  "country",
  "brand",
  "composition",
  "edo_inn",
  "edo_kpp",
  "edo_address",
] as const;

export type BulkFormKey = (typeof BULK_FORM_KEYS)[number];

export const FORM_COLUMN_FIELDS: { key: BulkFormKey; label: string }[] = [
  { key: "name", label: "Наименование" },
  { key: "article", label: "Артикул" },
  { key: "size", label: "Размер" },
  { key: "color", label: "Цвет" },
  { key: "barcode", label: "Баркод" },
  { key: "country", label: "Страна производства" },
  { key: "brand", label: "Бренд" },
  { key: "composition", label: "Состав" },
  { key: "edo_inn", label: "ИНН (ЭДО)" },
  { key: "edo_kpp", label: "КПП (ЭДО)" },
  { key: "edo_address", label: "Адрес (ЭДО)" },
];

export type ClearableFieldOption = {
  /** API-формат: колонка (`brand`) или extra (`extra.phone`). */
  field: string;
  label: string;
};

/** Список полей для массовой очистки (data-driven из формы и каталога). */
export function buildClearableFields(
  catalogFields: ExtraCatalogField[],
): ClearableFieldOption[] {
  const options: ClearableFieldOption[] = FORM_COLUMN_FIELDS.map(({ key, label }) => ({
    field: key,
    label,
  }));

  options.push({
    field: `extra.${PRINT_NAME_EXTRA_KEY}`,
    label: "Наименование для печати",
  });

  for (let n = 1; n <= USER_FIELD_COUNT; n += 1) {
    options.push({
      field: `extra.${userFieldLabelKey(n)}`,
      label: `Поле ${n} — наименование`,
    });
    options.push({
      field: `extra.${userFieldValueKey(n)}`,
      label: `Поле ${n} — значение`,
    });
  }

  for (const { extraKey, label } of catalogFields) {
    options.push({
      field: `extra.${extraKey}`,
      label,
    });
  }

  return options;
}

/** Только непустые колонки формы для массового применения. */
export function buildBulkFormPayload(
  form: Record<BulkFormKey, string>,
): Partial<Record<BulkFormKey, string>> {
  const payload: Partial<Record<BulkFormKey, string>> = {};
  for (const key of BULK_FORM_KEYS) {
    const trimmed = (form[key] ?? "").trim();
    if (trimmed !== "") {
      payload[key] = trimmed;
    }
  }
  return payload;
}

export type TemplateFieldsPayload = Partial<Record<BulkFormKey, string>> & {
  extra?: Record<string, string>;
};

/** Снимок заполненных полей формы для шаблона автозаполнения. */
export function buildTemplateFieldsPayload(
  form: Record<BulkFormKey, string>,
  catalogFields: ExtraCatalogField[],
  extraForm: Record<string, string>,
): TemplateFieldsPayload {
  const payload: TemplateFieldsPayload = {
    ...buildBulkFormPayload(form),
  };
  const extra = buildBulkExtraPayload(catalogFields, extraForm);
  if (Object.keys(extra).length > 0) {
    payload.extra = extra;
  }
  return payload;
}

export function applyTemplateFieldsToForm(
  templateFields: TemplateFieldsPayload,
  form: Record<BulkFormKey, string>,
  catalogFields: ExtraCatalogField[],
  extraForm: Record<string, string>,
): { form: Record<BulkFormKey, string>; extraForm: Record<string, string> } {
  const nextForm = { ...form };
  for (const key of BULK_FORM_KEYS) {
    const value = templateFields[key];
    if (typeof value === "string" && value.trim() !== "") {
      nextForm[key] = value;
    }
  }

  const nextExtraForm = { ...extraForm };
  const templateExtra = templateFields.extra;
  if (templateExtra && typeof templateExtra === "object") {
    for (const field of catalogFields) {
      const value = templateExtra[field.extraKey];
      if (typeof value === "string" && value.trim() !== "") {
        nextExtraForm[field.extraKey] = value;
      }
    }
    for (let n = 1; n <= USER_FIELD_COUNT; n += 1) {
      const valueKey = userFieldValueKey(n);
      const labelKey = userFieldLabelKey(n);
      const value = templateExtra[valueKey];
      const label = templateExtra[labelKey];
      if (typeof value === "string" && value.trim() !== "") {
        nextExtraForm[valueKey] = value;
      }
      if (typeof label === "string" && label.trim() !== "") {
        nextExtraForm[labelKey] = label;
      }
    }
    const printName = templateExtra[PRINT_NAME_EXTRA_KEY];
    if (typeof printName === "string" && printName.trim() !== "") {
      nextExtraForm[PRINT_NAME_EXTRA_KEY] = printName;
    }
  }

  return { form: nextForm, extraForm: nextExtraForm };
}
