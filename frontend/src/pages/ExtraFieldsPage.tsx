import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Plus, Upload } from "lucide-react";
import apiClient from "../api/client";
import Alert from "../components/ui/Alert";
import EmptyState from "../components/ui/EmptyState";
import Modal from "../components/ui/Modal";
import type { FieldCatalogItem } from "../labels/blockRegistry";
import {
  applyTemplateFieldsToForm,
  buildBulkExtraPayload,
  buildBulkFormPayload,
  buildClearableFields,
  buildFullExtraPayload,
  buildTemplateFieldsPayload,
  emptyExtraFormState,
  extraCatalogFieldsFromFieldCatalog,
  extraFormStateFromRecord,
  FORM_COLUMN_FIELDS,
  PRINT_NAME_EXTRA_KEY,
  USER_FIELD_COUNT,
  userFieldLabelKey,
  userFieldValueKey,
  type ExtraCatalogField,
  type TemplateFieldsPayload,
} from "../utils/extraFieldsCatalog";
import {
  buildExtraFieldsExcelColumns,
  exportExtraFieldsToXlsx,
  parseExtraFieldsExcel,
  type ExtraFieldsImportPreview,
} from "../utils/extraFieldsExcel";

interface ExtraField {
  id: string;
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
}

type FormState = {
  gtin: string;
  name: string;
  article: string;
  size: string;
  color: string;
  barcode: string;
  country: string;
  brand: string;
  composition: string;
  edo_inn: string;
  edo_kpp: string;
  edo_address: string;
};

const EMPTY_FORM: FormState = {
  gtin: "",
  name: "",
  article: "",
  size: "",
  color: "",
  barcode: "",
  country: "",
  brand: "",
  composition: "",
  edo_inn: "",
  edo_kpp: "",
  edo_address: "",
};

const TABLE_COLUMNS: { key: keyof ExtraField | "print_name"; label: string }[] = [
  { key: "gtin", label: "GTIN" },
  { key: "name", label: "Наименование товара" },
  { key: "brand", label: "Бренд" },
  { key: "print_name", label: "Наименование для печати" },
  { key: "article", label: "Артикул" },
  { key: "size", label: "Размер" },
  { key: "country", label: "Страна" },
];

const PAGE_SIZE_OPTIONS = [50, 100, 500] as const;

interface ExtraFieldsTemplateListItem {
  id: string;
  name: string;
  created_at: string;
}

function formToPayload(form: FormState): Record<string, string | null> {
  const payload: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(form)) {
    const trimmed = value.trim();
    payload[key] = trimmed === "" ? null : trimmed;
  }
  return payload;
}

function cellValue(item: ExtraField, key: keyof ExtraField | "print_name"): string {
  if (key === "print_name") {
    const extraPrint = item.extra?.print_name;
    if (extraPrint != null && String(extraPrint).trim() !== "") {
      return String(extraPrint);
    }
    return item.name || "";
  }
  const value = item[key as keyof ExtraField];
  return value != null ? String(value) : "";
}

export default function ExtraFieldsPage() {
  const [items, setItems] = useState<ExtraField[]>([]);
  const [selected, setSelected] = useState<ExtraField | null>(null);
  const [selectedGtins, setSelectedGtins] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [extraCatalogFields, setExtraCatalogFields] = useState<ExtraCatalogField[]>([]);
  const [extraForm, setExtraForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ExtraFieldsTemplateListItem[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateMessage, setTemplateMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ExtraFieldsImportPreview | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [clearFieldKey, setClearFieldKey] = useState("");
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function loadTemplates() {
    try {
      const res = await apiClient.get<ExtraFieldsTemplateListItem[]>("/extra-fields/templates");
      setTemplates(res.data);
    } catch {
      setLoadError("Не удалось загрузить шаблоны автозаполнения.");
    }
  }

  async function load() {
    try {
      const res = await apiClient.get<{ items: ExtraField[] }>("/extra-fields/");
      setItems(res.data.items);
      setLoadError(null);
    } catch {
      setLoadError("Не удалось загрузить список доп. полей.");
    }
  }

  useEffect(() => {
    void load();
    void loadTemplates();
  }, []);

  useEffect(() => {
    async function loadCatalog() {
      try {
        const res = await apiClient.get<FieldCatalogItem[]>("/labels/field-catalog");
        const fields = extraCatalogFieldsFromFieldCatalog(res.data);
        setExtraCatalogFields(fields);
        setExtraForm((prev) => {
          const next = emptyExtraFormState(fields);
          for (const field of fields) {
            if (field.extraKey in prev) {
              next[field.extraKey] = prev[field.extraKey];
            }
          }
          return next;
        });
      } catch {
        setLoadError("Не удалось загрузить каталог полей для этикетки.");
      }
    }
    void loadCatalog();
  }, []);

  useEffect(() => {
    if (selected && extraCatalogFields.length > 0) {
      setExtraForm(extraFormStateFromRecord(extraCatalogFields, selected.extra));
    }
  }, [extraCatalogFields, selected]);

  useEffect(() => {
    setPage(0);
  }, [columnFilters, pageSize]);

  function selectItem(item: ExtraField) {
    setSelected(item);
    setForm({
      gtin: item.gtin,
      name: item.name || "",
      article: item.article || "",
      size: item.size || "",
      color: item.color || "",
      barcode: item.barcode || "",
      country: item.country || "",
      brand: item.brand || "",
      composition: item.composition || "",
      edo_inn: item.edo_inn || "",
      edo_kpp: item.edo_kpp || "",
      edo_address: item.edo_address || "",
    });
    setExtraForm(extraFormStateFromRecord(extraCatalogFields, item.extra));
  }

  function newItem() {
    setSelected(null);
    setForm(EMPTY_FORM);
    setExtraForm(emptyExtraFormState(extraCatalogFields));
  }

  const filtered = useMemo(() => {
    return items.filter((item) => {
      for (const col of TABLE_COLUMNS) {
        const filterValue = (columnFilters[col.key] ?? "").trim().toLowerCase();
        if (!filterValue) continue;
        if (!cellValue(item, col.key).toLowerCase().includes(filterValue)) {
          return false;
        }
      }
      return true;
    });
  }, [items, columnFilters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pagedItems = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const pageGtins = useMemo(() => pagedItems.map((item) => item.gtin), [pagedItems]);
  const allPageSelected =
    pageGtins.length > 0 && pageGtins.every((gtin) => selectedGtins.has(gtin));

  function toggleGtin(gtin: string) {
    setSelectedGtins((prev) => {
      const next = new Set(prev);
      if (next.has(gtin)) {
        next.delete(gtin);
      } else {
        next.add(gtin);
      }
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelectedGtins((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const gtin of pageGtins) {
          next.delete(gtin);
        }
      } else {
        for (const gtin of pageGtins) {
          next.add(gtin);
        }
      }
      return next;
    });
  }

  const bulkFieldsPayload = useMemo(() => {
    const fields = {
      ...buildBulkFormPayload(form),
    } as Record<string, unknown>;
    const extra = buildBulkExtraPayload(extraCatalogFields, extraForm);
    if (Object.keys(extra).length > 0) {
      fields.extra = extra;
    }
    return fields;
  }, [form, extraCatalogFields, extraForm]);

  const hasBulkFields = Object.keys(bulkFieldsPayload).length > 0;
  const isBulkMode = selectedGtins.size > 0;

  const excelColumns = useMemo(
    () => buildExtraFieldsExcelColumns(extraCatalogFields),
    [extraCatalogFields],
  );

  const clearableFields = useMemo(
    () => buildClearableFields(extraCatalogFields),
    [extraCatalogFields],
  );

  const selectedClearField = useMemo(
    () => clearableFields.find((option) => option.field === clearFieldKey) ?? null,
    [clearableFields, clearFieldKey],
  );

  const existingGtins = useMemo(() => new Set(items.map((item) => item.gtin)), [items]);

  const templateFieldsPayload = useMemo(
    () => buildTemplateFieldsPayload(form, extraCatalogFields, extraForm),
    [form, extraCatalogFields, extraForm],
  );
  const hasTemplateFields = Object.keys(templateFieldsPayload).length > 0;

  async function saveTemplate() {
    const name = templateName.trim();
    if (!name || !hasTemplateFields) return;
    setTemplateSaving(true);
    setTemplateMessage(null);
    try {
      const res = await apiClient.post<ExtraFieldsTemplateListItem>("/extra-fields/templates", {
        name,
        fields: templateFieldsPayload,
      });
      await loadTemplates();
      setSelectedTemplateId(res.data.id);
      setTemplateMessage(`Шаблон «${res.data.name}» сохранён.`);
    } catch {
      setLoadError("Не удалось сохранить шаблон автозаполнения.");
    } finally {
      setTemplateSaving(false);
    }
  }

  async function applyTemplate(templateId: string) {
    if (!templateId) return;
    setTemplateMessage(null);
    try {
      const res = await apiClient.get<{ name: string; fields: TemplateFieldsPayload }>(
        `/extra-fields/templates/${templateId}`,
      );
      const applied = applyTemplateFieldsToForm(
        res.data.fields,
        form,
        extraCatalogFields,
        extraForm,
      );
      setForm((prev) => ({ ...prev, ...applied.form }));
      setExtraForm((prev) => ({ ...prev, ...applied.extraForm }));
      setTemplateName(res.data.name);
      setTemplateMessage(`Шаблон «${res.data.name}» применён к форме.`);
    } catch {
      setLoadError("Не удалось применить шаблон автозаполнения.");
    }
  }

  async function deleteTemplate() {
    if (!selectedTemplateId) return;
    const template = templates.find((item) => item.id === selectedTemplateId);
    const label = template?.name ?? "шаблон";
    if (!confirm(`Удалить шаблон «${label}»?`)) return;
    setTemplateSaving(true);
    setTemplateMessage(null);
    try {
      await apiClient.delete(`/extra-fields/templates/${selectedTemplateId}`);
      setSelectedTemplateId("");
      if (template?.name === templateName) {
        setTemplateName("");
      }
      await loadTemplates();
      setTemplateMessage(`Шаблон «${label}» удалён.`);
    } catch {
      setLoadError("Не удалось удалить шаблон автозаполнения.");
    } finally {
      setTemplateSaving(false);
    }
  }

  function handleTemplateSelect(templateId: string) {
    setSelectedTemplateId(templateId);
    if (templateId) {
      void applyTemplate(templateId);
      return;
    }
    setTemplateMessage(null);
  }

  function handleExportExcel() {
    if (items.length === 0) {
      setLoadError("Нет данных для экспорта.");
      return;
    }
    setExporting(true);
    setLoadError(null);
    try {
      exportExtraFieldsToXlsx(
        items,
        excelColumns,
        `extra_fields_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      setBulkResult(`Экспортировано ${items.length} записей в Excel.`);
    } catch {
      setLoadError("Не удалось выгрузить файл Excel.");
    } finally {
      setExporting(false);
    }
  }

  async function handleImportFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setLoadError("Допустим только формат .xlsx");
      return;
    }

    setLoadError(null);
    setBulkResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const { preview, error } = parseExtraFieldsExcel(buffer, excelColumns, existingGtins);
      if (error || !preview) {
        setLoadError(error ?? "Не удалось разобрать файл Excel.");
        return;
      }
      setImportPreview(preview);
      setImportConfirmOpen(true);
    } catch {
      setLoadError("Не удалось прочитать файл Excel.");
    }
  }

  async function applyImport() {
    if (!importPreview) {
      return;
    }
    setImporting(true);
    setImportConfirmOpen(false);
    try {
      const res = await apiClient.post<{
        updated: number;
        created: number;
        total: number;
        skipped: number;
      }>("/extra-fields/import", {
        rows: importPreview.rows,
      });
      const { updated, created, total, skipped } = res.data;
      setBulkResult(
        `Импорт завершён: обработано ${total} GTIN (обновлено ${updated}, создано ${created}${skipped > 0 ? `, пропущено ${skipped}` : ""}).`,
      );
      setImportPreview(null);
      await load();
    } catch {
      setLoadError("Не удалось применить импорт из Excel.");
    } finally {
      setImporting(false);
    }
  }

  async function applyClearField() {
    if (!clearFieldKey || selectedGtins.size === 0) {
      return;
    }
    setClearing(true);
    setClearConfirmOpen(false);
    try {
      const res = await apiClient.post<{ cleared: number; skipped: number }>(
        "/extra-fields/clear-field",
        {
          gtins: [...selectedGtins],
          field: clearFieldKey,
        },
      );
      const { cleared, skipped } = res.data;
      setBulkResult(
        `Поле очищено у ${cleared} GTIN${skipped > 0 ? ` (пропущено ${skipped})` : ""}.`,
      );
      await load();
    } catch {
      setLoadError("Не удалось очистить выбранное поле.");
    } finally {
      setClearing(false);
    }
  }

  async function saveSingle() {
    setSaving(true);
    try {
      await apiClient.post("/extra-fields/", {
        ...formToPayload(form),
        extra: buildFullExtraPayload(extraCatalogFields, extraForm, false),
      });
      await load();
      newItem();
      setBulkResult(null);
    } finally {
      setSaving(false);
    }
  }

  async function applyBulk() {
    setSaving(true);
    setBulkConfirmOpen(false);
    try {
      const res = await apiClient.post<{
        updated: number;
        created: number;
        total: number;
      }>("/extra-fields/bulk", {
        gtins: [...selectedGtins],
        fields: bulkFieldsPayload,
      });
      const { updated, created, total } = res.data;
      setBulkResult(
        `Применено к ${total} GTIN: обновлено ${updated}, создано ${created}.`,
      );
      setSelectedGtins(new Set());
      await load();
    } catch {
      setLoadError("Не удалось применить изменения к выделенным GTIN.");
    } finally {
      setSaving(false);
    }
  }

  function handleSaveClick() {
    if (isBulkMode) {
      if (!hasBulkFields) return;
      setBulkConfirmOpen(true);
      return;
    }
    void saveSingle();
  }

  async function deleteItem(gtin: string) {
    if (!confirm(`Удалить доп. поля для GTIN ${gtin}?`)) return;
    await apiClient.delete(`/extra-fields/${encodeURIComponent(gtin)}`);
    setSelectedGtins((prev) => {
      const next = new Set(prev);
      next.delete(gtin);
      return next;
    });
    await load();
    newItem();
  }

  const fields = FORM_COLUMN_FIELDS;

  const clearDisabled =
    clearing || selectedGtins.size === 0 || !clearFieldKey;

  const saveDisabled =
    saving ||
    (isBulkMode ? !hasBulkFields : !form.gtin.trim());

  const saveLabel = saving
    ? "Сохранение..."
    : isBulkMode
      ? `Применить к выделенным (${selectedGtins.size})`
      : "Сохранить";

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-forest-100 bg-white lg:border-b-0 lg:border-r">
        <div className="border-b border-forest-100 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="mb-1 text-lg font-bold text-forest-950">Доп. поля</h2>
              <p className="text-xs text-sage-500">
                Атрибуты для этикеток и документов. Выделите GTIN для массового применения.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={exporting || items.length === 0}
                className="btn-secondary btn-sm"
              >
                <Download className="h-4 w-4" />
                {exporting ? "Экспорт..." : "Экспорт в Excel"}
              </button>
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                disabled={importing}
                className="btn-secondary btn-sm"
              >
                <Upload className="h-4 w-4" />
                {importing ? "Импорт..." : "Импортировать файл"}
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(event) => void handleImportFileChange(event)}
              />
              <button type="button" onClick={newItem} className="btn-primary btn-sm">
                <Plus className="h-4 w-4" />
                Добавить GTIN
              </button>
            </div>
          </div>
          {loadError ? (
            <Alert variant="error" className="mt-3 !py-2 text-xs">
              {loadError}
            </Alert>
          ) : null}
          {bulkResult ? (
            <Alert variant="success" className="mt-3 !py-2 text-xs">
              {bulkResult}
            </Alert>
          ) : null}
          {selectedGtins.size > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-sage-600">
              <span>Выбрано: {selectedGtins.size}</span>
              <button
                type="button"
                onClick={() => setSelectedGtins(new Set())}
                className="btn-ghost btn-sm"
              >
                Снять выбор
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full min-w-max border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr>
                <th className="w-8 border-b border-slate-200 px-2 py-2 text-left">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={toggleAllOnPage}
                    className="checkbox-field"
                    disabled={pagedItems.length === 0}
                  />
                </th>
                {TABLE_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className="whitespace-nowrap border-b border-slate-200 px-2 py-2 text-left font-medium text-slate-600"
                  >
                    <div>{col.label}</div>
                    <div className="mt-1">
                      <input
                        type="text"
                        value={columnFilters[col.key] ?? ""}
                        onChange={(event) =>
                          setColumnFilters((prev) => ({
                            ...prev,
                            [col.key]: event.target.value,
                          }))
                        }
                        className="w-full min-w-[4rem] rounded border border-slate-200 px-1 py-0.5 text-xs"
                        placeholder="▼"
                      />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedItems.length === 0 ? (
                <tr>
                  <td colSpan={TABLE_COLUMNS.length + 1} className="px-4 py-12">
                    <EmptyState
                      title="Нет записей"
                      description="Добавьте GTIN, чтобы заполнить дополнительные поля для печати."
                      action={
                        <button type="button" onClick={newItem} className="btn-primary btn-sm">
                          + Добавить GTIN
                        </button>
                      }
                    />
                  </td>
                </tr>
              ) : (
                pagedItems.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => selectItem(item)}
                    className={[
                      "cursor-pointer border-b border-slate-100 hover:bg-slate-50",
                      selected?.id === item.id ? "bg-forest-50/80" : "",
                    ].join(" ")}
                  >
                    <td className="px-2 py-1.5" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedGtins.has(item.gtin)}
                        onChange={() => toggleGtin(item.gtin)}
                        className="checkbox-field"
                      />
                    </td>
                    {TABLE_COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        className={[
                          "max-w-[12rem] truncate px-2 py-1.5",
                          col.key === "gtin" ? "font-mono" : "",
                        ].join(" ")}
                        title={cellValue(item, col.key) || undefined}
                      >
                        {cellValue(item, col.key) || "—"}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
          <div className="flex flex-wrap items-center gap-2">
            <span>Размер страницы:</span>
            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              className="rounded border border-slate-300 px-1 py-0.5"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <span>
              {filtered.length === 0
                ? "0 по 0 из 0"
                : `${safePage * pageSize + 1} по ${Math.min((safePage + 1) * pageSize, filtered.length)} из ${filtered.length}`}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={safePage <= 0}
              onClick={() => setPage(0)}
              className="rounded p-1 hover:bg-slate-100 disabled:opacity-40"
              aria-label="Первая страница"
            >
              <ChevronLeft className="h-4 w-4" />
              <ChevronLeft className="-ml-3 h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={safePage <= 0}
              onClick={() => setPage((prev) => Math.max(0, prev - 1))}
              className="rounded p-1 hover:bg-slate-100 disabled:opacity-40"
              aria-label="Предыдущая страница"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-1">
              Страница {filtered.length === 0 ? 0 : safePage + 1} из{" "}
              {filtered.length === 0 ? 0 : totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((prev) => Math.min(totalPages - 1, prev + 1))}
              className="rounded p-1 hover:bg-slate-100 disabled:opacity-40"
              aria-label="Следующая страница"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage(totalPages - 1)}
              className="rounded p-1 hover:bg-slate-100 disabled:opacity-40"
              aria-label="Последняя страница"
            >
              <ChevronRight className="h-4 w-4" />
              <ChevronRight className="-ml-3 h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="w-full shrink-0 overflow-y-auto p-4 sm:p-6 lg:w-96 xl:w-[28rem]">
        <div className="card p-6">
          <h3 className="mb-2 text-xl font-bold text-forest-950">
            {isBulkMode
              ? `Массовое применение (${selectedGtins.size})`
              : selected
                ? `GTIN: ${selected.gtin}`
                : "Новая запись"}
          </h3>
          {isBulkMode ? (
            <p className="mb-4 text-xs text-sage-500">
              Заполните только те поля, которые нужно изменить у выделенных GTIN. Пустые поля
              не затрагивают существующие значения.
            </p>
          ) : null}

          <div className="mb-6 rounded-lg border border-forest-100 bg-surface-subtle/50 p-4">
            <h4 className="mb-3 text-sm font-semibold text-forest-900">Очистить поле</h4>
            <div className="space-y-3">
              <div>
                <label className="label-text">Выберите поле</label>
                <select
                  value={clearFieldKey}
                  onChange={(event) => setClearFieldKey(event.target.value)}
                  className="input-field"
                >
                  <option value="">—</option>
                  {clearableFields.map((option) => (
                    <option key={option.field} value={option.field}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {selectedGtins.size === 0 ? (
                <p className="text-xs text-sage-500">Выделите GTIN в таблице для очистки поля.</p>
              ) : null}
              <button
                type="button"
                onClick={() => setClearConfirmOpen(true)}
                disabled={clearDisabled}
                className="btn-danger btn-sm"
              >
                {clearing ? "Очистка..." : "Очистить"}
              </button>
            </div>
          </div>

          <div className="mb-6 rounded-lg border border-forest-100 bg-surface-subtle/50 p-4">
            <h4 className="mb-3 text-sm font-semibold text-forest-900">Автозаполнение полей</h4>
            <div className="space-y-3">
              <div>
                <label className="label-text">Выберите шаблон</label>
                <select
                  value={selectedTemplateId}
                  onChange={(event) => handleTemplateSelect(event.target.value)}
                  className="input-field"
                >
                  <option value="">—</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label-text">Название шаблона</label>
                <input
                  type="text"
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder="Например, Реквизиты MZ"
                  className="input-field"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void saveTemplate()}
                  disabled={templateSaving || !templateName.trim() || !hasTemplateFields}
                  className="btn-secondary btn-sm"
                >
                  {templateSaving ? "Сохранение..." : "Сохранить"}
                </button>
                <button
                  type="button"
                  onClick={() => void deleteTemplate()}
                  disabled={templateSaving || !selectedTemplateId}
                  className="btn-danger btn-sm"
                >
                  Удалить
                </button>
              </div>
              {templateMessage ? (
                <p className="text-xs text-sage-600">{templateMessage}</p>
              ) : null}
            </div>
          </div>

          {!isBulkMode ? (
            <div className="mb-5">
              <label className="label-text">GTIN *</label>
              <input
                type="text"
                value={form.gtin}
                onChange={(event) => setForm((prev) => ({ ...prev, gtin: event.target.value }))}
                disabled={!!selected}
                placeholder="14 цифр"
                className="input-field font-mono disabled:bg-surface-subtle"
              />
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {fields.map(({ key, label }) => (
              <div key={key}>
                <label className="label-text">{label}</label>
                <input
                  type="text"
                  value={form[key]}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, [key]: event.target.value }))
                  }
                  className="input-field"
                />
              </div>
            ))}
          </div>

          <div className="mt-8 border-t border-forest-100 pt-6">
            <h4 className="mb-4 text-sm font-semibold text-forest-900">Данные для печати</h4>
            <div>
              <label className="label-text">Наименование для печати</label>
              <input
                type="text"
                value={extraForm[PRINT_NAME_EXTRA_KEY] ?? ""}
                onChange={(event) =>
                  setExtraForm((prev) => ({
                    ...prev,
                    [PRINT_NAME_EXTRA_KEY]: event.target.value,
                  }))
                }
                className="input-field"
                placeholder="Если пусто — используется наименование товара"
              />
            </div>
          </div>

          <div className="mt-8 border-t border-forest-100 pt-6">
            <h4 className="mb-4 text-sm font-semibold text-forest-900">Произвольные поля</h4>
            <div className="space-y-4">
              {Array.from({ length: USER_FIELD_COUNT }, (_, index) => {
                const n = index + 1;
                const valueKey = userFieldValueKey(n);
                const labelKey = userFieldLabelKey(n);
                return (
                  <div
                    key={valueKey}
                    className="grid grid-cols-1 gap-3 rounded-lg border border-forest-100 bg-surface-subtle/40 p-3 sm:grid-cols-2"
                  >
                    <div>
                      <label className="label-text">Поле {n} — наименование</label>
                      <input
                        type="text"
                        value={extraForm[labelKey] ?? ""}
                        onChange={(event) =>
                          setExtraForm((prev) => ({ ...prev, [labelKey]: event.target.value }))
                        }
                        className="input-field"
                        placeholder={`Поле ${n}`}
                      />
                    </div>
                    <div>
                      <label className="label-text">Поле {n} — значение</label>
                      <input
                        type="text"
                        value={extraForm[valueKey] ?? ""}
                        onChange={(event) =>
                          setExtraForm((prev) => ({ ...prev, [valueKey]: event.target.value }))
                        }
                        className="input-field"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {extraCatalogFields.length > 0 ? (
            <div className="mt-8 border-t border-forest-100 pt-6">
              <h4 className="mb-4 text-sm font-semibold text-forest-900">
                Дополнительные поля для этикетки
              </h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {extraCatalogFields.map(({ extraKey, label }) => (
                  <div key={extraKey}>
                    <label className="label-text">{label}</label>
                    <input
                      type="text"
                      value={extraForm[extraKey] ?? ""}
                      onChange={(event) =>
                        setExtraForm((prev) => ({ ...prev, [extraKey]: event.target.value }))
                      }
                      className="input-field"
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleSaveClick}
              disabled={saveDisabled}
              className="btn-primary"
            >
              {saveLabel}
            </button>
            {selected && !isBulkMode ? (
              <button
                type="button"
                onClick={() => void deleteItem(selected.gtin)}
                className="btn-danger"
              >
                Удалить
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <Modal
        open={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        title="Подтверждение очистки"
        footer={
          <>
            <button
              type="button"
              onClick={() => setClearConfirmOpen(false)}
              className="btn-secondary"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => void applyClearField()}
              disabled={clearing}
              className="btn-danger"
            >
              Очистить
            </button>
          </>
        }
      >
        <p className="text-sm text-sage-700">
          Очистить поле «{selectedClearField?.label ?? "—"}» у {selectedGtins.size} GTIN? Это
          действие нельзя отменить.
        </p>
      </Modal>

      <Modal
        open={importConfirmOpen}
        onClose={() => {
          setImportConfirmOpen(false);
          setImportPreview(null);
        }}
        title="Подтверждение импорта"
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setImportConfirmOpen(false);
                setImportPreview(null);
              }}
              className="btn-secondary"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => void applyImport()}
              disabled={importing}
              className="btn-primary"
            >
              Применить
            </button>
          </>
        }
      >
        <p className="text-sm text-sage-700">
          Подтвердите редактирование {importPreview?.total ?? 0} карточек.
        </p>
        {importPreview ? (
          <ul className="mt-3 space-y-1 text-xs text-sage-600">
            <li>Будет обновлено: {importPreview.toUpdate}</li>
            <li>Будет создано: {importPreview.toCreate}</li>
            {importPreview.skipped > 0 ? (
              <li>Пропущено строк в файле: {importPreview.skipped}</li>
            ) : null}
          </ul>
        ) : null}
        <p className="mt-3 text-xs text-sage-500">
          Пустые ячейки Excel не затирают существующие значения (семантика bulk).
        </p>
      </Modal>

      <Modal
        open={bulkConfirmOpen}
        onClose={() => setBulkConfirmOpen(false)}
        title="Подтверждение"
        footer={
          <>
            <button
              type="button"
              onClick={() => setBulkConfirmOpen(false)}
              className="btn-secondary"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => void applyBulk()}
              disabled={saving}
              className="btn-primary"
            >
              Редактировать
            </button>
          </>
        }
      >
        <p className="text-sm text-sage-700">
          Вы собираетесь отредактировать {selectedGtins.size} GTIN. Вы уверены?
        </p>
      </Modal>
    </div>
  );
}
