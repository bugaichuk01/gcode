import { useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import apiClient from "../api/client";
import Alert from "../components/ui/Alert";
import EmptyState from "../components/ui/EmptyState";

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

function formToPayload(form: FormState): Record<string, string | null> {
  const payload: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(form)) {
    const trimmed = value.trim();
    payload[key] = trimmed === "" ? null : trimmed;
  }
  return payload;
}

export default function ExtraFieldsPage() {
  const [items, setItems] = useState<ExtraField[]>([]);
  const [selected, setSelected] = useState<ExtraField | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

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
  }, []);

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
  }

  function newItem() {
    setSelected(null);
    setForm(EMPTY_FORM);
  }

  async function save() {
    setSaving(true);
    try {
      await apiClient.post("/extra-fields/", formToPayload(form));
      await load();
      newItem();
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(gtin: string) {
    if (!confirm(`Удалить доп. поля для GTIN ${gtin}?`)) return;
    await apiClient.delete(`/extra-fields/${encodeURIComponent(gtin)}`);
    await load();
    newItem();
  }

  const searchLower = search.trim().toLowerCase();
  const filtered = items.filter(
    (item) =>
      !searchLower ||
      item.gtin.includes(searchLower) ||
      (item.name || "").toLowerCase().includes(searchLower) ||
      (item.article || "").toLowerCase().includes(searchLower),
  );

  const fields = [
    { key: "name" as const, label: "Наименование" },
    { key: "article" as const, label: "Артикул" },
    { key: "size" as const, label: "Размер" },
    { key: "color" as const, label: "Цвет" },
    { key: "barcode" as const, label: "Баркод" },
    { key: "country" as const, label: "Страна производства" },
    { key: "brand" as const, label: "Бренд" },
    { key: "composition" as const, label: "Состав" },
    { key: "edo_inn" as const, label: "ИНН (ЭДО)" },
    { key: "edo_kpp" as const, label: "КПП (ЭДО)" },
    { key: "edo_address" as const, label: "Адрес (ЭДО)" },
  ];

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-b border-forest-100 bg-white lg:w-80 lg:border-b-0 lg:border-r">
        <div className="border-b border-forest-100 p-4">
          <h2 className="mb-1 text-lg font-bold text-forest-950">Доп. поля</h2>
          <p className="mb-4 text-xs text-sage-500">Атрибуты для этикеток и документов</p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sage-400" />
            <input
              type="text"
              placeholder="Поиск по GTIN или названию..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="input-field pl-10"
            />
          </div>
          <button type="button" onClick={newItem} className="btn-primary mt-3 w-full">
            <Plus className="h-4 w-4" />
            Добавить GTIN
          </button>
          {loadError ? (
            <Alert variant="error" className="mt-3 !py-2 text-xs">
              {loadError}
            </Alert>
          ) : null}
        </div>
        <div className="max-h-64 flex-1 overflow-y-auto lg:max-h-none">
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => selectItem(item)}
              className={[
                "w-full border-b border-forest-50 px-4 py-3.5 text-left transition hover:bg-forest-50/60",
                selected?.id === item.id
                  ? "border-l-[3px] border-l-forest-700 bg-forest-50/80"
                  : "border-l-[3px] border-l-transparent",
              ].join(" ")}
            >
              <div className="font-mono text-sm font-medium text-forest-900">{item.gtin}</div>
              <div className="truncate text-xs text-sage-500">
                {item.name || item.article || "—"}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <EmptyState
              title="Нет записей"
              description="Добавьте GTIN, чтобы заполнить дополнительные поля для печати."
              action={
                <button type="button" onClick={newItem} className="btn-primary btn-sm">
                  + Добавить GTIN
                </button>
              }
            />
          )}
        </div>
      </aside>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <div className="card mx-auto max-w-2xl p-6">
          <h3 className="mb-6 text-xl font-bold text-forest-950">
            {selected ? `GTIN: ${selected.gtin}` : "Новая запись"}
          </h3>

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

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !form.gtin.trim()}
              className="btn-primary"
            >
              {saving ? "Сохранение..." : "Сохранить"}
            </button>
            {selected ? (
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
    </div>
  );
}
