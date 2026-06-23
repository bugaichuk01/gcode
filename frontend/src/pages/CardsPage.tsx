import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as XLSX from "xlsx";
import { Check, ChevronDown } from "lucide-react";
import apiClient from "../api/client";
import {
  getUserCertificates,
  parseCertIndex,
  type UserCertificate,
} from "../services/signingService";

type ProductCardType = "unit" | "set" | "tech_card" | "bundle";
type ProductCardStatus = "draft" | "sent" | "awaiting_sign" | "published" | "archived";

interface NkAttr {
  attr_id: number;
  attr_name: string;
  attr_field_type: string;
  attr_preset: string[];
  attr_preset_only: boolean;
  attr_multiplicity: boolean;
  attr_value_type: string[];
  first_layer: boolean;
  second_layer: boolean;
  attr_type: string;
}

interface NkCategory {
  cat_id: number;
  cat_name?: string;
  category_active?: boolean;
}

interface ProductCard {
  id: string;
  type: ProductCardType;
  tn_ved: string;
  gtin: string | null;
  name: string;
  status: ProductCardStatus;
  brand: string | null;
  color: string | null;
  size: string | null;
  size_type: string | null;
  composition: string | null;
  country: string | null;
  gender: string | null;
  product_kind: string | null;
  regulation: string | null;
  tn_ved_code: string | null;
  model_article_type: string | null;
  model_article: string | null;
  national_catalog_feed_id: string | null;
  national_catalog_feed_status: string | null;
  national_catalog_feed_payload?: Record<string, unknown> | null;
  extra_attrs?: {
    nk_attrs?: Record<string, string | string[]>;
    nk_optional_attrs?: Record<string, string | string[]>;
    nk_attrs_names?: Record<string, string>;
    nk_cat_id?: number;
  } | null;
  is_set?: boolean;
  set_items?: Array<{ gtin: string; quantity: number }> | null;
  created_at: string;
}

interface ProductCardListResponse {
  items: ProductCard[];
  total: number;
  limit: number;
  offset: number;
}

interface DeviceResponse {
  id: string;
  name: string;
  oms_id: string;
  connection_id: string;
  inn: string | null;
  created_at: string;
}

const PRODUCT_CATEGORIES = [
  "Одежда",
  "Духи",
  "Обувь",
  "Табак",
  "Молочная продукция",
  "Вода",
  "Пиво",
];

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Все статусы" },
  { value: "draft", label: "Черновик" },
  { value: "sent", label: "На модерации" },
  { value: "awaiting_sign", label: "Ожидает подписания" },
  { value: "published", label: "Опубликована" },
  { value: "archived", label: "В архиве" },
];

const TECH_GTIN_ALLOWED = [
  "perfumery",
  "lp",
  "shoes",
  "tires",
  "tobacco",
  "water",
  "antiseptic",
  "photo",
  "bicycle",
] as const;

function digitsOnlyGtin(raw: string): string {
  return raw.replace(/\D/g, "");
}

function normalizeGtinForStorage(gtin: string): string {
  const digits = digitsOnlyGtin(gtin);
  if (digits.length === 13) return `0${digits}`;
  return digits;
}

function validateGtin(gtin: string): string | null {
  const digits = digitsOnlyGtin(gtin);
  if (!digits) return null;
  if (![8, 12, 13, 14].includes(digits.length)) {
    return `GTIN должен содержать 8, 12, 13 или 14 цифр (сейчас ${digits.length})`;
  }
  return null;
}

const EMPTY_FORM = {
  type: "unit" as ProductCardType,
  name: "",
  tn_ved: "",
  gtin: "",
  cat_id: "",
  brand: "",
  color: "",
  size: "",
  size_type: "",
  composition: "",
  country: "",
  gender: "",
  product_kind: "",
  regulation: "",
  tn_ved_code: "",
  model_article_type: "Артикул",
  model_article: "",
  custom_name: false,
};

const statusColors: Record<string, string> = {
  draft: "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-slate-100 text-slate-600",
  sent: "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-amber-100 text-amber-700",
  awaiting_sign:
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700",
  published:
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-700",
  archived:
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-slate-200 text-slate-400",
};

const statusLabels: Record<string, string> = {
  draft: "Черновик",
  sent: "На модерации",
  awaiting_sign: "Ожидает подписания",
  published: "Опубликована",
  archived: "В архиве",
};

function getLockedFields(status: string): Set<string> {
  switch (status) {
    case "draft":
      // Черновик: brand и 4-значный ТНВЭД заблокированы
      return new Set(["brand", "tn_ved"]);
    case "awaiting_sign":
    case "published":
      // Обязательные для маркировки поля заблокированы
      return new Set(["brand", "tn_ved", "tn_ved_code", "gtin", "type"]);
    case "archived":
      // Всё заблокировано
      return new Set([
        "brand",
        "tn_ved",
        "tn_ved_code",
        "gtin",
        "type",
        "name",
        "color",
        "size",
        "country",
      ]);
    default:
      return new Set();
  }
}

function getCardError(card: ProductCard): string | null {
  const payload = card.national_catalog_feed_payload;
  if (!payload) return null;

  const result = payload.result as Record<string, unknown> | undefined;
  if (!result) return null;

  if (result.status === "Rejected" || result.status_id === 0) {
    const items = result.error_details as { items?: Array<{ errors?: Array<{ text?: string }>; message?: string }> } | undefined;
    const itemList = items?.items;
    if (Array.isArray(itemList) && itemList.length > 0) {
      const errors = itemList[0].errors;
      if (Array.isArray(errors) && errors.length > 0) {
        return errors[0].text || "Карточка отклонена НК";
      }
      return itemList[0].message || "Карточка отклонена НК";
    }
    return "Карточка отклонена Национальным каталогом";
  }
  return null;
}

type CardFormData = typeof EMPTY_FORM;

interface CardRowSnapshot {
  form: CardFormData;
  attrValues: Record<number, string | string[]>;
  optionalAttrValues: Record<number, string | string[]>;
  setItems: Array<{ gtin: string; quantity: number }>;
  nkAttrs: NkAttr[];
  nkOptionalAttrs: NkAttr[];
  _status?: "draft" | "sending" | "sent" | "error";
  _error?: string;
}

const EXCEL_COLUMNS: { key: keyof CardFormData | "set_items"; header: string }[] = [
  { key: "type", header: "Тип" },
  { key: "tn_ved", header: "Группа ТН ВЭД" },
  { key: "tn_ved_code", header: "Код ТНВЭД" },
  { key: "gtin", header: "GTIN" },
  { key: "name", header: "Наименование" },
  { key: "brand", header: "Бренд" },
  { key: "product_kind", header: "Вид товара" },
  { key: "color", header: "Цвет" },
  { key: "gender", header: "Целевой пол" },
  { key: "size_type", header: "Тип размера" },
  { key: "size", header: "Размер" },
  { key: "composition", header: "Состав" },
  { key: "country", header: "Страна" },
  { key: "model_article_type", header: "Тип артикула" },
  { key: "model_article", header: "Артикул" },
  { key: "regulation", header: "Регламент" },
  { key: "set_items", header: "Состав набора (GTIN:кол-во через ;)" },
];

const TYPE_LABEL_TO_CODE: Record<string, ProductCardType> = {
  "единица": "unit",
  "единица товара": "unit",
  "комплект": "set",
  "техническая": "tech_card",
  "техническая карточка": "tech_card",
  "набор": "bundle",
};
const TYPE_CODE_TO_LABEL: Record<string, string> = {
  unit: "Единица товара",
  set: "Комплект",
  tech_card: "Техническая карточка",
  bundle: "Набор",
};

const SPECIAL_ATTR = {
  NAME: 2478,
  BRAND: 2504,
  TNVED_GROUP: 3959,
  TNVED_CODE: 13933,
  REGULATION: 13836,
} as const;

function isTnvedCodeAttrName(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    (normalized.includes("тнвэд") || normalized.includes("тн вэд")) &&
    !normalized.includes("группа")
  );
}

function findTnvedCodeAttr(attrs: NkAttr[]): NkAttr | undefined {
  return attrs.find(
    (attr) =>
      attr.attr_id === SPECIAL_ATTR.TNVED_CODE ||
      (isTnvedCodeAttrName(attr.attr_name) && attr.attr_preset.length > 0),
  );
}

function tnvedCodePresetsFromAttr(attr: NkAttr | undefined): string[] {
  if (!attr) return [];
  return attr.attr_preset.filter((p) => /^\d{10}$/.test(String(p).trim()));
}

const CARD_ROW_COLUMNS: { key: string; label: string }[] = [
  { key: "type", label: "Тип" },
  { key: "tn_ved", label: "Группа ТН ВЭД" },
  { key: "name", label: "Наименование" },
  { key: "brand", label: "Бренд" },
  { key: "gtin", label: "GTIN" },
  { key: "product_kind", label: "Вид изд." },
  { key: "color", label: "Цвет" },
  { key: "size", label: "Размер" },
  { key: "country", label: "Страна" },
  { key: "tn_ved_code", label: "Код ТНВЭД" },
];

const SELECT_CELL_OPTIONS: Record<string, { value: string; label: string }[]> = {
  type: [
    { value: "unit", label: "Единица" },
    { value: "set", label: "Комплект" },
    { value: "tech_card", label: "Техническая" },
    { value: "bundle", label: "Набор" },
  ],
};

function isCellEditable(row: CardRowSnapshot, key: string): boolean {
  if (key === "gtin" && row.form.type === "tech_card") return false;
  if (key === "tn_ved" || key === "tn_ved_code") return false;
  return true;
}

function formatRowCell(row: CardRowSnapshot, key: string): ReactNode {
  if (key === "type") {
    const labels: Record<string, string> = {
      unit: "Единица",
      set: "Комплект",
      tech_card: "Техническая",
      bundle: "Набор",
    };
    const label = labels[row.form.type] || row.form.type;
    if (row.form.type === "bundle" && row.setItems.length === 0) {
      return (
        <span>
          {label}{" "}
          <span className="text-red-500" title="Состав не заполнен">
            ⚠
          </span>
        </span>
      );
    }
    return label;
  }
  if (key === "gtin") {
    if (row.form.type === "tech_card") {
      return <span className="text-slate-400 italic">авто (029)</span>;
    }
    return row.form.gtin || "—";
  }
  return String(row.form[key as keyof CardFormData] ?? "") || "—";
}

function optionalField(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function exportCardsToCsv(rows: ProductCard[]) {
  const headers = [
    "GTIN",
    "Наименование",
    "Бренд",
    "Вид товара",
    "Код ТН ВЭД",
    "Страна",
    "Статус",
  ];
  const lines = rows.map((c) =>
    [
      c.gtin ?? "",
      c.name,
      c.brand ?? "",
      c.product_kind ?? "",
      c.tn_ved_code || c.tn_ved,
      c.country ?? "",
      statusLabels[c.status] ?? c.status,
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  const blob = new Blob([`\uFEFF${headers.join(",")}\n${lines.join("\n")}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `product-cards-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function ColumnHeader({
  label,
  field,
  onFilter,
  filters,
}: {
  label: string;
  field: string;
  onFilter: (field: string, value: string) => void;
  filters: Record<string, string>;
}) {
  const [showFilter, setShowFilter] = useState(false);
  const value = filters[field] ?? "";

  return (
    <th className="whitespace-nowrap px-2 py-2 text-left align-top">
      <div
        className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-sage-700"
        onClick={() => setShowFilter(!showFilter)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setShowFilter(!showFilter)}
      >
        {label}
        <span className="text-slate-400">▼</span>
      </div>
      {showFilter && (
        <input
          type="text"
          value={value}
          onChange={(e) => onFilter(field, e.target.value)}
          className="input-field-sm mt-1 w-full min-w-[4rem]"
          placeholder="Фильтр..."
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </th>
  );
}

function resolveName(form: typeof EMPTY_FORM): string {
  const trimmed = form.name.trim();
  if (trimmed) return trimmed;
  if (form.custom_name) return "";
  const parts = [
    form.product_kind,
    form.brand,
    form.color && `цвет ${form.color}`,
    form.size && `размер ${form.size}`,
    form.model_article,
  ].filter(Boolean);
  return parts.join(", ") || "Товар";
}

function attrValueAsString(value: string | string[] | undefined): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join("; ");
  return value;
}

function buildPayload(
  form: typeof EMPTY_FORM,
  attrValues: Record<number, string | string[]>,
  nkAttrs: NkAttr[],
  optionalAttrValues: Record<number, string | string[]>,
  nkOptionalAttrs: NkAttr[],
  setItems: Array<{ gtin: string; quantity: number }> = [],
) {
  const merged: Record<number, string | string[]> = { ...attrValues };
  if (form.name.trim()) merged[SPECIAL_ATTR.NAME] = form.name.trim();
  if (form.brand.trim()) merged[SPECIAL_ATTR.BRAND] = form.brand.trim();
  if (form.tn_ved.trim()) merged[SPECIAL_ATTR.TNVED_GROUP] = form.tn_ved.trim().slice(0, 4);

  const nkAttrsPayload: Record<string, string | string[]> = {};
  for (const [id, value] of Object.entries(merged)) {
    if (Array.isArray(value)) {
      if (value.length > 0) nkAttrsPayload[id] = value;
    } else if (value.trim()) {
      nkAttrsPayload[id] = value;
    }
  }

  const nkOptionalPayload: Record<string, string | string[]> = {};
  for (const [id, value] of Object.entries(optionalAttrValues)) {
    if (Array.isArray(value)) {
      if (value.length > 0) nkOptionalPayload[id] = value;
    } else if (value.trim()) {
      nkOptionalPayload[id] = value;
    }
  }

  const catId = form.cat_id ? parseInt(form.cat_id, 10) : undefined;
  const extraAttrs: {
    nk_attrs?: Record<string, string | string[]>;
    nk_optional_attrs?: Record<string, string | string[]>;
    nk_attrs_names?: Record<string, string>;
    nk_cat_id?: number;
  } = {
    nk_attrs: nkAttrsPayload,
    nk_optional_attrs: nkOptionalPayload,
    nk_attrs_names: Object.fromEntries(
      [...nkAttrs, ...nkOptionalAttrs].map((a) => [String(a.attr_id), a.attr_name]),
    ),
  };
  if (catId) extraAttrs.nk_cat_id = catId;

  const regulation =
    optionalField(form.regulation) ||
    optionalField(attrValueAsString(merged[SPECIAL_ATTR.REGULATION]));
  const tnVedCode =
    optionalField(form.tn_ved_code) ||
    optionalField(attrValueAsString(merged[SPECIAL_ATTR.TNVED_CODE]));

  return {
    type: form.type,
    name: form.name.trim() || resolveName(form),
    tn_ved: form.tn_ved.trim(),
    gtin: optionalField(normalizeGtinForStorage(form.gtin)),
    cat_id: catId,
    brand: optionalField(form.brand),
    color: optionalField(form.color),
    size: optionalField(form.size),
    size_type: optionalField(form.size_type),
    composition: optionalField(form.composition),
    country: optionalField(form.country) || undefined,
    gender: optionalField(form.gender) || undefined,
    product_kind: optionalField(form.product_kind) || optionalField(attrValueAsString(merged[1034])),
    regulation,
    tn_ved_code: tnVedCode,
    model_article_type: optionalField(form.model_article_type),
    model_article: optionalField(form.model_article),
    custom_name: form.custom_name,
    extra_attrs: extraAttrs,
    ...(form.type === "bundle" && setItems.length > 0
      ? { set_items: setItems.filter((it) => it.gtin) }
      : {}),
  };
}

export default function CardsPage() {
  const [cards, setCards] = useState<ProductCard[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(500);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingCard, setEditingCard] = useState<ProductCard | null>(null);
  const [activeTab, setActiveTab] = useState<"basic" | "extra">("basic");
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  const [productCategory, setProductCategory] = useState(
    () => localStorage.getItem("cards_product_category") || PRODUCT_CATEGORIES[0],
  );
  const [certificates, setCertificates] = useState<UserCertificate[]>([]);
  const [selectedCertIndex, setSelectedCertIndex] = useState(() => {
    const stored = localStorage.getItem("cards_cert_index");
    if (stored) {
      const n = Number.parseInt(stored, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return parseCertIndex();
  });
  const [device, setDevice] = useState<DeviceResponse | null>(null);
  const [omsId, setOmsId] = useState(() => localStorage.getItem("cards_oms_id") || "");
  const [connectionId, setConnectionId] = useState(
    () => localStorage.getItem("cards_connection_id") || "",
  );

  const [nkAttrs, setNkAttrs] = useState<NkAttr[]>([]);
  const [nkOptionalAttrs, setNkOptionalAttrs] = useState<NkAttr[]>([]);
  const [nkCategories, setNkCategories] = useState<NkCategory[]>([]);
  const [loadingAttrs, setLoadingAttrs] = useState(false);
  const [attrValues, setAttrValues] = useState<Record<number, string | string[]>>({});
  const [optionalAttrValues, setOptionalAttrValues] = useState<Record<number, string | string[]>>({});
  const [setItems, setSetItems] = useState<Array<{ gtin: string; quantity: number }>>([]);

  const [tnvedSearch, setTnvedSearch] = useState("");
  const [showTnvedDropdown, setShowTnvedDropdown] = useState(false);
  const [tnvedGroups, setTnvedGroups] = useState<
    Array<{
      cat_id: number;
      cat_name: string;
      tnved: string;
      label: string;
      product_group?: string;
    }>
  >([]);
  const [tnvedLoading, setTnvedLoading] = useState(false);
  const [tnvedDisplayValue, setTnvedDisplayValue] = useState("");

  const [cardRows, setCardRows] = useState<CardRowSnapshot[]>([]);
  const [selectedRowIndexes, setSelectedRowIndexes] = useState<Set<number>>(new Set());
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<{ rowIdx: number; key: string } | null>(null);
  const [rowColumnFilters, setRowColumnFilters] = useState<Record<string, string>>({});
  const [rowsPageSize, setRowsPageSize] = useState(500);
  const [rowsPage, setRowsPage] = useState(0);

  const importRef = useRef<HTMLInputElement>(null);
  const importBufferRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [sendingList, setSendingList] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const loadCards = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<ProductCardListResponse>("/product-cards/", {
        params: {
          limit: pageSize,
          offset: page * pageSize,
          status: filterStatus,
        },
      });
      setCards(res.data.items ?? []);
      setTotal(res.data.total ?? 0);
      setError(null);
    } catch {
      setError("Не удалось загрузить карточки");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filterStatus]);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  useEffect(() => {
    setTnvedLoading(true);
    apiClient
      .get<
        Array<{
          cat_id: number;
          cat_name: string;
          tnved: string;
          label: string;
          product_group?: string;
        }>
      >("/product-cards/tnved-groups")
      .then((res) => setTnvedGroups(res.data || []))
      .catch((err) => {
        console.error("Ошибка загрузки ТНВЭД:", err);
        void import("../data/tnvedGroups").then((m) => {
          setTnvedGroups(
            m.TNVED_GROUPS.map((g) => ({
              cat_id: g.groupId,
              cat_name: g.name,
              tnved: g.code,
              label: `${g.code} — ${g.name}`,
              product_group: g.productGroup,
            })),
          );
        });
      })
      .finally(() => setTnvedLoading(false));
  }, []);

  useEffect(() => {
    setPage(0);
  }, [filterStatus, pageSize]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(".tnved-dropdown")) {
        setShowTnvedDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    void getUserCertificates()
      .then((certs) => {
        setCertificates(certs);
      })
      .catch(() => {});

    apiClient
      .get<DeviceResponse[]>("/devices")
      .then((res) => {
        if (res.data.length > 0) setDevice(res.data[0]);
      })
      .catch(() => {});

    apiClient
      .get<{ oms_id?: string | null; connection_id?: string | null }>("/devices/form-defaults")
      .then((r) => {
        if (!localStorage.getItem("cards_oms_id") && r.data.oms_id) {
          setOmsId(r.data.oms_id);
        }
        if (!localStorage.getItem("cards_connection_id") && r.data.connection_id) {
          setConnectionId(r.data.connection_id ?? "");
        }
      })
      .catch(() => {});
  }, []);

  function persistSettings() {
    localStorage.setItem("cards_product_category", productCategory);
    localStorage.setItem("cards_oms_id", omsId);
    localStorage.setItem("cards_connection_id", connectionId);
    localStorage.setItem("cards_cert_index", String(selectedCertIndex));
  }

  function handleColumnFilter(field: string, value: string) {
    setColumnFilters((prev) => ({ ...prev, [field]: value }));
  }

  function cardFieldValue(card: ProductCard, field: string): string {
    switch (field) {
      case "gtin":
        return card.gtin ?? "";
      case "created_at":
        return new Date(card.created_at).toLocaleDateString("ru-RU");
      case "name":
        return card.name;
      case "brand":
        return card.brand ?? "";
      case "product_kind":
        return card.product_kind ?? "";
      case "tn_ved_code":
        return card.tn_ved_code || card.tn_ved;
      case "country":
        return card.country ?? "";
      case "color":
        return card.color ?? "";
      case "size":
        return card.size ?? "";
      case "size_type":
        return card.size_type ?? "";
      case "gender":
        return card.gender ?? "";
      case "composition":
        return card.composition ?? "";
      case "status":
        return statusLabels[card.status] ?? card.status;
      default:
        return "";
    }
  }

  function normalizeNkAttr(raw: Partial<NkAttr> & { attr_id: number }): NkAttr {
    return {
      attr_id: raw.attr_id,
      attr_name: raw.attr_name ?? `Атрибут ${raw.attr_id}`,
      attr_field_type: raw.attr_field_type ?? "",
      attr_preset: Array.isArray(raw.attr_preset) ? raw.attr_preset : [],
      attr_preset_only: Boolean(raw.attr_preset_only),
      attr_multiplicity: Boolean(raw.attr_multiplicity),
      attr_value_type: Array.isArray(raw.attr_value_type) ? raw.attr_value_type : [],
      first_layer: Boolean(raw.first_layer),
      second_layer: Boolean(raw.second_layer),
      attr_type: raw.attr_type ?? "",
    };
  }

  function parseSavedAttrValue(
    saved: string | string[] | undefined,
    attr: NkAttr,
  ): string | string[] {
    if (saved === undefined) {
      if (attr.attr_multiplicity) return [];
      if (attr.attr_preset.length > 0 && attr.attr_preset_only) return attr.attr_preset[0];
      return "";
    }
    if (attr.attr_multiplicity) {
      if (Array.isArray(saved)) return saved;
      const text = String(saved).trim();
      if (!text) return [];
      if (text.startsWith("[")) {
        try {
          const parsed = JSON.parse(text) as unknown;
          if (Array.isArray(parsed)) return parsed.map(String);
        } catch {

        }
      }
      return text.split(";").map((s) => s.trim()).filter(Boolean);
    }
    return String(saved);
  }

  function resetNkAttrs() {
    setNkAttrs([]);
    setNkOptionalAttrs([]);
    setNkCategories([]);
    setAttrValues({});
    setOptionalAttrValues({});
    setLoadingAttrs(false);
  }

  async function loadAttrsForTnved(
    tnved: string,
    catId?: number,
    savedValues?: Record<string, string | string[]>,
    preserveCatId = false,
    savedOptionalValues?: Record<string, string | string[]>,
  ) {
    const trimmed = tnved.trim();
    if (!trimmed && !catId) {
      resetNkAttrs();
      return;
    }
    if (trimmed.length < 4 && !catId) {
      resetNkAttrs();
      return;
    }
    setLoadingAttrs(true);
    setNkAttrs([]);
    setNkOptionalAttrs([]);
    setAttrValues({});
    setOptionalAttrValues({});
    try {
      const params = new URLSearchParams();
      if (trimmed) params.set("tnved", trimmed);
      if (catId != null) params.set("cat_id", String(catId));
      const res = await apiClient.get<{
        attrs?: Partial<NkAttr>[];
        optional_attrs?: Partial<NkAttr>[];
        categories?: NkCategory[];
        resolved_cat_id?: number | null;
        error?: string;
      }>(`/product-cards/attributes-for-tnved?${params}`);
      const attrs = (res.data.attrs || []).map((a) =>
        normalizeNkAttr({ ...a, attr_id: Number(a.attr_id) }),
      );
      const optionalAttrs = (res.data.optional_attrs || []).map((a) =>
        normalizeNkAttr({ ...a, attr_id: Number(a.attr_id) }),
      );
      const categories = (res.data.categories || []).filter(
        (c) => c.category_active !== false && c.cat_id,
      );
      setNkAttrs(attrs);
      setNkOptionalAttrs(optionalAttrs);
      setNkCategories(categories);
      if (!preserveCatId) {
        const resolved = res.data.resolved_cat_id;
        if (catId) {

        } else if (resolved) {
          setForm((f) => ({ ...f, cat_id: String(resolved) }));
        } else if (categories.length === 1) {
          setForm((f) => ({ ...f, cat_id: String(categories[0].cat_id) }));
        }
      }

      const initValues: Record<number, string | string[]> = {};
      for (const attr of attrs) {
        initValues[attr.attr_id] = parseSavedAttrValue(
          savedValues?.[String(attr.attr_id)],
          attr,
        );
      }
      if (trimmed) {
        initValues[SPECIAL_ATTR.TNVED_GROUP] = trimmed.slice(0, 4);
      }
      const tnvedAttr = findTnvedCodeAttr(attrs);
      const savedTnvedCode = savedValues?.[String(SPECIAL_ATTR.TNVED_CODE)];
      if (tnvedAttr) {
        const codeValue =
          savedTnvedCode ||
          savedValues?.[String(tnvedAttr.attr_id)] ||
          undefined;
        if (codeValue) {
          initValues[tnvedAttr.attr_id] = String(codeValue);
        }
      }
      setAttrValues(initValues);

      const initOptionalValues: Record<number, string | string[]> = {};
      for (const attr of optionalAttrs) {
        initOptionalValues[attr.attr_id] = parseSavedAttrValue(
          savedOptionalValues?.[String(attr.attr_id)],
          attr,
        );
      }
      setOptionalAttrValues(initOptionalValues);

      const savedName = savedValues?.[String(SPECIAL_ATTR.NAME)];
      const savedBrand = savedValues?.[String(SPECIAL_ATTR.BRAND)];
      const savedRegulation = savedValues?.[String(SPECIAL_ATTR.REGULATION)];
      setForm((f) => ({
        ...f,
        name: f.name || (savedName ? String(savedName) : f.name),
        brand: f.brand || (savedBrand ? String(savedBrand) : f.brand),
        tn_ved_code:
          f.tn_ved_code ||
          (savedTnvedCode ? String(savedTnvedCode) : "") ||
          (tnvedAttr && initValues[tnvedAttr.attr_id]
            ? String(initValues[tnvedAttr.attr_id])
            : f.tn_ved_code),
        regulation:
          f.regulation ||
          (savedRegulation ? attrValueAsString(savedRegulation as string | string[]) : f.regulation),
      }));
    } catch {
      setNkAttrs([]);
      setNkOptionalAttrs([]);
      setNkCategories([]);
    } finally {
      setLoadingAttrs(false);
    }
  }

  function handleCategoryChange(catId: string) {
    setForm((f) => ({ ...f, cat_id: catId }));
    if (form.tn_ved.trim().length >= 4) {
      const parsed = catId ? parseInt(catId, 10) : undefined;
      void loadAttrsForTnved(
        form.tn_ved,
        parsed,
        attrValues as Record<string, string | string[]>,
        true,
        optionalAttrValues as Record<string, string | string[]>,
      );
    }
  }

  function isBasicLayerAttr(attr: NkAttr): boolean {
    return attr.first_layer || !attr.second_layer;
  }

  function isExtraLayerAttr(attr: NkAttr): boolean {
    return attr.second_layer;
  }

  function syncFormFieldFromAttr(attrId: number, value: string | string[]) {
    const text = attrValueAsString(value);
    if (attrId === SPECIAL_ATTR.TNVED_CODE || nkAttrs.some((a) => a.attr_id === attrId && isTnvedCodeAttrName(a.attr_name))) {
      setForm((f) => ({ ...f, tn_ved_code: text }));
    } else if (attrId === SPECIAL_ATTR.REGULATION) {
      setForm((f) => ({ ...f, regulation: text }));
    } else if (attrId === 1034) {
      setForm((f) => ({ ...f, product_kind: text }));
    }
  }

  function getMissingRequired(): string[] {
    const missing: string[] = [];
    const tnvedPresets = tnvedCodePresetsFromAttr(findTnvedCodeAttr(nkAttrs));
    if (tnvedPresets.length > 0 && !form.tn_ved_code.trim()) {
      missing.push("Код ТНВЭД");
    }
    for (const attr of nkAttrs) {
      if (attr.attr_id === SPECIAL_ATTR.TNVED_GROUP) continue;
      if (isTnvedCodeAttrName(attr.attr_name) && tnvedPresets.length > 0) continue;
      if (attr.attr_id === SPECIAL_ATTR.NAME) {
        if (!form.name.trim()) missing.push(attr.attr_name);
        continue;
      }
      if (attr.attr_id === SPECIAL_ATTR.BRAND) {
        if (!form.brand.trim()) missing.push(attr.attr_name);
        continue;
      }
      const val = attrValues[attr.attr_id];
      const isEmpty = Array.isArray(val) ? val.length === 0 : !val;
      if (isEmpty) missing.push(attr.attr_name);
    }
    if (form.type !== "tech_card" && !form.gtin) missing.push("GTIN");
    if (form.type === "bundle" && setItems.filter((it) => it.gtin).length === 0) {
      missing.push("Состав набора (вложенные GTIN)");
    }
    if (nkCategories.length > 0 && !form.cat_id) missing.push("Категория");
    return missing;
  }

  function renderAttrField(attr: NkAttr, isRequired: boolean = true) {
    const labelClass = isRequired
      ? "block text-xs font-medium text-orange-500 mb-1"
      : "block text-xs font-medium text-slate-500 mb-1";
    const labelSuffix = isRequired ? " *" : "";
    const values = isRequired ? attrValues : optionalAttrValues;
    const setValues = isRequired ? setAttrValues : setOptionalAttrValues;
    const fieldLocked = editingCard?.status === "archived";

    if (attr.attr_id === SPECIAL_ATTR.TNVED_GROUP) return null;

    if (
      (attr.attr_id === SPECIAL_ATTR.TNVED_CODE || isTnvedCodeAttrName(attr.attr_name)) &&
      attr.attr_preset.length > 0
    ) {
      return null;
    }

    if (attr.attr_id === SPECIAL_ATTR.NAME) {
      const nameLocked = lockedFields.has("name") || fieldLocked;
      return (
        <div key={attr.attr_id} className="space-y-1">
          <label className={labelClass}>{attr.attr_name}{labelSuffix}</label>
          <input
            type="text"
            value={form.name}
            disabled={nameLocked}
            onChange={(e) => {
              const val = e.target.value;
              setForm((f) => ({ ...f, name: val, custom_name: true }));
              setAttrValues((prev) => ({ ...prev, [attr.attr_id]: val }));
            }}
            className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm ${
              nameLocked ? "bg-slate-100 cursor-not-allowed" : ""
            }`}
          />
        </div>
      );
    }

    if (attr.attr_id === SPECIAL_ATTR.BRAND) {
      const brandLocked = lockedFields.has("brand");
      return (
        <div key={attr.attr_id} className="space-y-1">
          <label className={labelClass}>{attr.attr_name}{labelSuffix}</label>
          <input
            type="text"
            value={form.brand}
            disabled={brandLocked}
            onChange={(e) => {
              const val = e.target.value;
              setForm((f) => ({ ...f, brand: val }));
              setAttrValues((prev) => ({ ...prev, [attr.attr_id]: val }));
            }}
            placeholder="Без товарного знака"
            className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm ${
              brandLocked ? "bg-slate-100 cursor-not-allowed" : ""
            }`}
          />
          {brandLocked && (
            <p className="text-xs text-amber-600 mt-1">
              Бренд заблокирован для текущего статуса карточки
            </p>
          )}
        </div>
      );
    }

    const value = values[attr.attr_id] ?? "";

    function onChange(val: string) {
      setValues((prev) => ({ ...prev, [attr.attr_id]: val }));
      if (isRequired) syncFormFieldFromAttr(attr.attr_id, val);
    }

    if (attr.attr_value_type.length > 0 && attr.attr_value_type[0] !== "---") {
      const units = attr.attr_value_type.filter((v) => v !== "---");
      const valueStr = typeof value === "string" ? value : "";
      const [numVal, unit] = valueStr.includes("||")
        ? valueStr.split("||")
        : [valueStr, units[0]];
      return (
        <div key={attr.attr_id} className="space-y-1">
          <label className={labelClass}>{attr.attr_name}{labelSuffix}</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={numVal}
              onChange={(e) => onChange(`${e.target.value}||${unit || units[0]}`)}
              placeholder="Значение"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <select
              value={unit || units[0]}
              onChange={(e) => onChange(`${numVal}||${e.target.value}`)}
              className="w-20 rounded-lg border border-slate-300 px-2 py-2 text-sm"
            >
              {units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>
      );
    }

    if (attr.attr_multiplicity && attr.attr_preset.length > 0) {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div key={attr.attr_id} className="space-y-1">
          <label className={labelClass}>{attr.attr_name}{labelSuffix}</label>
          <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-300">
            {attr.attr_preset.map((p) => (
              <label
                key={p}
                className="flex cursor-pointer items-center gap-2 px-3 py-1 text-sm hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(p)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, p]
                      : selected.filter((s) => s !== p);
                    setValues((prev) => ({ ...prev, [attr.attr_id]: next }));
                    if (isRequired) syncFormFieldFromAttr(attr.attr_id, next);
                  }}
                />
                {p}
              </label>
            ))}
          </div>
        </div>
      );
    }

    if (attr.attr_preset_only && attr.attr_preset.length > 0) {
      return (
        <div key={attr.attr_id} className="space-y-1">
          <label className={labelClass}>{attr.attr_name}{labelSuffix}</label>
          <select
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Выберите...</option>
            {attr.attr_preset.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      );
    }

    return (
      <div key={attr.attr_id} className="space-y-1">
        <label className={labelClass}>{attr.attr_name}{labelSuffix}</label>
        <input
          type="text"
          value={typeof value === "string" ? value : ""}
          disabled={fieldLocked}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm ${
            fieldLocked ? "bg-slate-100 cursor-not-allowed" : ""
          }`}
        />
      </div>
    );
  }

  function handleAddRow() {
    if (!form.tn_ved.trim()) {
      setError("Укажите группу ТНВЭД перед добавлением");
      return;
    }
    const gtinError = form.type !== "tech_card" ? validateGtin(form.gtin || "") : null;
    if (gtinError) {
      setError(gtinError);
      return;
    }
    const missing = getMissingRequired();
    if (missing.length > 0) {
      setError(`Заполните обязательные поля: ${missing.join(", ")}`);
      return;
    }

    const snapshot: CardRowSnapshot = {
      form: { ...form },
      attrValues: { ...attrValues },
      optionalAttrValues: { ...optionalAttrValues },
      setItems: [...setItems],
      nkAttrs: [...nkAttrs],
      nkOptionalAttrs: [...nkOptionalAttrs],
      _status: "draft",
    };
    setCardRows((prev) => [...prev, snapshot]);
    setError(null);
    setSuccess(`Добавлено в список: ${cardRows.length + 1}`);

    setForm((f) => ({
      ...EMPTY_FORM,
      type: f.type,
      tn_ved: f.tn_ved,
      cat_id: f.cat_id,
      brand: f.brand,
    }));
    setAttrValues({});
    setOptionalAttrValues({});
    setSetItems([]);
  }

  async function handleSaveOnly() {
    await handleSubmit(false);
  }

  async function handleSubmitAndSend() {
    await handleSubmit(true);
  }

  function handleDeleteSelectedRows() {
    if (selectedRowIndexes.size === 0) return;
    setCardRows((prev) => prev.filter((_, idx) => !selectedRowIndexes.has(idx)));
    setSelectedRowIndexes(new Set());
  }

  function handleClearRows() {
    setCardRows([]);
    setSelectedRowIndexes(new Set());
    setRowColumnFilters({});
    setRowsPage(0);
  }

  function handleExportRows() {
    if (cardRows.length === 0) {
      setError("Список пуст — нечего экспортировать");
      return;
    }
    const data = cardRows.map((row) => {
      const obj: Record<string, string> = {};
      for (const col of EXCEL_COLUMNS) {
        if (col.key === "type") {
          obj[col.header] = TYPE_CODE_TO_LABEL[row.form.type] || row.form.type;
        } else if (col.key === "set_items") {
          obj[col.header] = row.setItems
            .filter((it) => it.gtin)
            .map((it) => `${it.gtin}:${it.quantity}`)
            .join("; ");
        } else {
          obj[col.header] = String(row.form[col.key as keyof CardFormData] ?? "");
        }
      }
      return obj;
    });

    const ws = XLSX.utils.json_to_sheet(data, {
      header: EXCEL_COLUMNS.map((c) => c.header),
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Карточки");
    XLSX.writeFile(wb, `cards_buffer_${new Date().toISOString().slice(0, 10)}.xlsx`);
    setSuccess(`Экспортировано ${cardRows.length} карточек в Excel`);
  }

  async function handleImportRows(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);

      if (rows.length === 0) {
        setError("Файл пуст");
        return;
      }
      if (rows.length > 500) {
        setError("Максимум 500 карточек (лимит ЧЗ)");
        return;
      }

      const headerToKey: Record<string, string> = {};
      for (const col of EXCEL_COLUMNS) {
        headerToKey[col.header.toLowerCase()] = col.key;
      }

      const snapshots: CardRowSnapshot[] = rows.map((r) => {
        const formData: Record<string, unknown> = { ...EMPTY_FORM };
        let setItemsParsed: Array<{ gtin: string; quantity: number }> = [];

        for (const [header, value] of Object.entries(r)) {
          const key = headerToKey[String(header).trim().toLowerCase()];
          if (!key) continue;
          const strVal = value == null ? "" : String(value).trim();

          if (key === "type") {
            formData.type = TYPE_LABEL_TO_CODE[strVal.toLowerCase()] || "unit";
          } else if (key === "set_items") {
            setItemsParsed = strVal
              .split(";")
              .map((part) => {
                const [g, q] = part.split(":").map((s) => s.trim());
                return { gtin: g || "", quantity: parseInt(q) || 1 };
              })
              .filter((it) => it.gtin);
          } else if (key === "gtin") {
            formData.gtin = strVal.replace(/\D/g, "");
          } else {
            formData[key] = strVal;
          }
        }
        formData.custom_name = Boolean(formData.name);

        return {
          form: formData as CardFormData,
          attrValues: {},
          optionalAttrValues: {},
          setItems: setItemsParsed,
          nkAttrs: [],
          nkOptionalAttrs: [],
          _status: "draft" as const,
        };
      });

      setCardRows((prev) => [...prev, ...snapshots]);
      setSuccess(
        `Импортировано ${snapshots.length} карточек в список. Обязательные атрибуты НК дозаполните двойным кликом по строке или они подставятся на бэкенде. Проверьте и отправьте.`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "неизвестно";
      setError("Ошибка чтения файла: " + message);
    } finally {
      e.target.value = "";
    }
  }

  function handleDownloadTemplate() {
    const example: Record<string, string> = {};
    for (const col of EXCEL_COLUMNS) {
      example[col.header] = "";
    }
    example["Тип"] = "Набор";
    example["Группа ТН ВЭД"] = "3303";
    example["GTIN"] = "04600000000001";
    example["Наименование"] = "Подарочный набор (пример)";
    example["Бренд"] = "Бренд";
    example["Состав набора (GTIN:кол-во через ;)"] = "04600000000002:1; 04600000000003:2";

    const ws = XLSX.utils.json_to_sheet([example], {
      header: EXCEL_COLUMNS.map((c) => c.header),
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Шаблон");
    XLSX.writeFile(wb, "template_cards.xlsx");
    setSuccess("Шаблон скачан. Заполните и импортируйте обратно.");
  }

  function toggleRowSelect(idx: number) {
    setSelectedRowIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function toggleRowExpand(idx: number) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function addSetItemToRow(rowIdx: number) {
    setCardRows((prev) =>
      prev.map((row, idx) =>
        idx === rowIdx
          ? { ...row, setItems: [...row.setItems, { gtin: "", quantity: 1 }] }
          : row,
      ),
    );
  }

  function updateSetItemInRow(
    rowIdx: number,
    itemIdx: number,
    field: "gtin" | "quantity",
    value: string,
  ) {
    setCardRows((prev) =>
      prev.map((row, idx) => {
        if (idx !== rowIdx) return row;
        const newItems = row.setItems.map((it, ii) => {
          if (ii !== itemIdx) return it;
          if (field === "gtin") {
            return { ...it, gtin: value.replace(/\D/g, "").slice(0, 14) };
          }
          return { ...it, quantity: Math.max(1, parseInt(value) || 1) };
        });
        return { ...row, setItems: newItems };
      }),
    );
  }

  function removeSetItemFromRow(rowIdx: number, itemIdx: number) {
    setCardRows((prev) =>
      prev.map((row, idx) =>
        idx === rowIdx
          ? { ...row, setItems: row.setItems.filter((_, ii) => ii !== itemIdx) }
          : row,
      ),
    );
  }

  function updateRowField(rowIdx: number, key: string, value: string) {
    setCardRows((prev) =>
      prev.map((row, idx) => {
        if (idx !== rowIdx) return row;
        let v = value;
        if (key === "gtin") {
          v = value.replace(/\D/g, "").slice(0, 14);
        }
        return {
          ...row,
          form: { ...row.form, [key]: v },
        };
      }),
    );
  }

  function finishCellEdit() {
    setEditingCell(null);
  }

  function openRowInForm(row: CardRowSnapshot) {
    setForm({ ...row.form });
    setAttrValues({ ...row.attrValues });
    setOptionalAttrValues({ ...row.optionalAttrValues });
    setSetItems([...row.setItems]);
    const catId = row.form.cat_id ? parseInt(row.form.cat_id, 10) : undefined;
    void loadAttrsForTnved(
      row.form.tn_ved,
      catId,
      row.attrValues,
      true,
      row.optionalAttrValues,
    );
  }

  function toggleAllRows() {
    if (selectedRowIndexes.size === filteredCardRows.length) {
      setSelectedRowIndexes(new Set());
    } else {
      setSelectedRowIndexes(new Set(filteredCardRows.map((r) => cardRows.indexOf(r))));
    }
  }

  function openCreate() {
    setEditingCard(null);
    setForm(EMPTY_FORM);
    resetNkAttrs();
    setTnvedSearch("");
    setTnvedDisplayValue("");
    setShowTnvedDropdown(false);
    setActiveTab("basic");
    setCardRows([]);
    setSelectedRowIndexes(new Set());
    setRowColumnFilters({});
    setRowsPage(0);
    setSetItems([]);
    setShowForm(true);
  }

  function openEdit(card: ProductCard) {
    setEditingCard(card);
    const savedNk = card.extra_attrs?.nk_attrs;
    const savedNkOptional = card.extra_attrs?.nk_optional_attrs;
    const savedCatId = card.extra_attrs?.nk_cat_id;
    const editForm = {
      type: card.type,
      name: card.name,
      tn_ved: card.tn_ved,
      gtin: card.gtin || "",
      cat_id: savedCatId ? String(savedCatId) : "",
      brand: card.brand || "",
      color: card.color || "",
      size: card.size || "",
      size_type: card.size_type || "",
      composition: card.composition || "",
      country: card.country || "",
      gender: card.gender || "",
      product_kind: card.product_kind || "",
      regulation: card.regulation || "",
      tn_ved_code: card.tn_ved_code || "",
      model_article_type: card.model_article_type || "Артикул",
      model_article: card.model_article || "",
      custom_name: true,
    };
    setForm(editForm);
    setSetItems(
      Array.isArray(card.set_items)
        ? card.set_items.map((it) => ({
            gtin: it.gtin || "",
            quantity: it.quantity || 1,
          }))
        : [],
    );
    setTnvedDisplayValue(
      card.tn_ved
        ? `${card.tn_ved}${card.name ? ` — ${card.name}` : ""}`
        : "",
    );
    setCardRows([]);
    setSelectedRowIndexes(new Set());
    setRowColumnFilters({});
    setRowsPage(0);
    setActiveTab("basic");
    setShowForm(true);
    void loadAttrsForTnved(card.tn_ved, savedCatId, savedNk, true, savedNkOptional);
  }

  async function handleGenerateGtin() {
    try {
      const res = await apiClient.post<{ gtin: string }>("/product-cards/generate-gtin");
      setForm((f) => ({ ...f, gtin: res.data.gtin }));
      setSuccess(`Сгенерирован GTIN: ${res.data.gtin}`);
    } catch {
      setError("Не удалось сгенерировать GTIN");
    }
  }

  async function handleFillAvailableGtin() {
    try {
      const res = await apiClient.get<{ gtins: string[] }>("/product-cards/available-gtins");
      if (res.data.gtins && res.data.gtins.length > 0) {
        setForm((f) => ({ ...f, gtin: res.data.gtins[0] }));
        setSuccess(`Использован доступный GTIN: ${res.data.gtins[0]}`);
      } else {
        await handleGenerateGtin();
      }
    } catch {
      await handleGenerateGtin();
    }
  }

  async function handleRefreshFromNk(id: string) {
    try {
      await apiClient.post(`/product-cards/${id}/refresh-from-nk`);
      setSuccess("Данные карточки обновлены из НК");
      await loadCards();
    } catch (err: unknown) {
      const detail =
        err &&
        typeof err === "object" &&
        "response" in err &&
        err.response &&
        typeof err.response === "object" &&
        "data" in err.response &&
        err.response.data &&
        typeof err.response.data === "object" &&
        "detail" in err.response.data
          ? String((err.response.data as { detail: unknown }).detail)
          : "Ошибка обновления из НК";
      setError(detail);
    }
  }

  async function handleSubmit(sendToNk: boolean = true) {
    if (!form.tn_ved.trim()) {
      setError("Укажите группу ТНВЭД");
      return;
    }

    const gtinError = form.type !== "tech_card" ? validateGtin(form.gtin || "") : null;
    if (gtinError) {
      setError(gtinError);
      return;
    }

    const missing = getMissingRequired();
    if (missing.length > 0) {
      setError(`Заполните обязательные поля: ${missing.join(", ")}`);
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = buildPayload(
        form,
        attrValues,
        nkAttrs,
        optionalAttrValues,
        nkOptionalAttrs,
        setItems,
      );

      if (editingCard) {
        await apiClient.patch(`/product-cards/${editingCard.id}`, payload);
        if (sendToNk) {
          try {
            await apiClient.post(`/product-cards/${editingCard.id}/send-to-nk`);
            setSuccess("Карточка сохранена и отправлена в НК");
          } catch (err: unknown) {
            setSuccess("Карточка сохранена локально");
            const detail =
              err &&
              typeof err === "object" &&
              "response" in err &&
              err.response &&
              typeof err.response === "object" &&
              "data" in err.response &&
              err.response.data &&
              typeof err.response.data === "object" &&
              "detail" in err.response.data
                ? String((err.response.data as { detail: unknown }).detail)
                : err instanceof Error
                  ? err.message
                  : "Неизвестная ошибка";
            setError(`Ошибка отправки в НК: ${detail}`);
          }
        } else {
          setSuccess("Карточка сохранена");
        }
      } else {
        await apiClient.post("/product-cards/", payload);
        setSuccess("Карточка создана и отправлена в НК");
      }

      await loadCards();
      setEditingCard(null);
      setShowForm(false);
    } catch (err: unknown) {
      const detail =
        err &&
        typeof err === "object" &&
        "response" in err &&
        err.response &&
        typeof err.response === "object" &&
        "data" in err.response &&
        err.response.data &&
        typeof err.response.data === "object" &&
        "detail" in err.response.data
          ? String((err.response.data as { detail: unknown }).detail)
          : "Ошибка при сохранении";
      setError(detail);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitAllRows() {
    if (cardRows.length === 0) {
      setError("Список пуст. Добавьте карточки через «+ Добавить»");
      return;
    }
    if (cardRows.length > 500) {
      setError("Максимум 500 карточек за раз (лимит ЧЗ)");
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < cardRows.length; i++) {
      const row = cardRows[i];
      if (row._status === "sent") {
        sent++;
        continue;
      }

      setCardRows((prev) =>
        prev.map((r, idx) => (idx === i ? { ...r, _status: "sending" as const } : r)),
      );

      try {
        const payload = buildPayload(
          row.form,
          row.attrValues,
          row.nkAttrs,
          row.optionalAttrValues,
          row.nkOptionalAttrs,
          row.setItems,
        );
        await apiClient.post("/product-cards/", payload);
        sent++;
        setCardRows((prev) =>
          prev.map((r, idx) =>
            idx === i ? { ...r, _status: "sent" as const, _error: undefined } : r,
          ),
        );
      } catch (err: unknown) {
        failed++;
        const detail =
          err &&
          typeof err === "object" &&
          "response" in err &&
          err.response &&
          typeof err.response === "object" &&
          "data" in err.response &&
          err.response.data &&
          typeof err.response.data === "object" &&
          "detail" in err.response.data
            ? String((err.response.data as { detail: unknown }).detail)
            : err instanceof Error
              ? err.message
              : "Ошибка";
        setCardRows((prev) =>
          prev.map((r, idx) =>
            idx === i ? { ...r, _status: "error" as const, _error: String(detail) } : r,
          ),
        );
      }
    }

    setSubmitting(false);
    if (failed === 0) {
      setSuccess(`Все ${sent} карточек отправлены в НК`);
    } else {
      setError(
        `Отправлено: ${sent}, с ошибками: ${failed}. Наведите на «Ошибка» в строке для деталей.`,
      );
    }
    await loadCards();
  }

  async function handleArchive(id: string) {
    try {
      await apiClient.post(`/product-cards/${id}/archive`);
      setSuccess("Карточка отправлена в архив");
      await loadCards();
    } catch (err: unknown) {
      const detail =
        err &&
        typeof err === "object" &&
        "response" in err &&
        err.response &&
        typeof err.response === "object" &&
        "data" in err.response &&
        err.response.data &&
        typeof err.response.data === "object" &&
        "detail" in err.response.data
          ? String((err.response.data as { detail: unknown }).detail)
          : "Ошибка архивации";
      setError(detail);
    }
  }

  async function handleUnarchive(id: string) {
    try {
      await apiClient.post(`/product-cards/${id}/unarchive`);
      setSuccess("Карточка восстановлена из архива (черновик)");
      await loadCards();
    } catch (err: unknown) {
      const detail =
        err &&
        typeof err === "object" &&
        "response" in err &&
        err.response &&
        typeof err.response === "object" &&
        "data" in err.response &&
        err.response.data &&
        typeof err.response.data === "object" &&
        "detail" in err.response.data
          ? String((err.response.data as { detail: unknown }).detail)
          : "Ошибка восстановления";
      setError(detail);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Удалить карточку?")) return;
    try {
      await apiClient.delete(`/product-cards/${id}`);
      setSuccess("Карточка удалена");
      await loadCards();
    } catch (err: unknown) {
      const detail =
        err &&
        typeof err === "object" &&
        "response" in err &&
        err.response &&
        typeof err.response === "object" &&
        "data" in err.response &&
        err.response.data &&
        typeof err.response.data === "object" &&
        "detail" in err.response.data
          ? String((err.response.data as { detail: unknown }).detail)
          : "Ошибка удаления";
      setError(detail);
    }
  }

  async function handleBulkDelete() {
    if (!confirm(`Удалить ${selectedIds.size} карточек?`)) return;
    await apiClient.post("/product-cards/bulk-delete", Array.from(selectedIds));
    setSelectedIds(new Set());
    await loadCards();
  }

  async function handleCopy(id: string) {
    await apiClient.post(`/product-cards/${id}/copy`);
    await loadCards();
    setSuccess("Создана копия карточки");
  }

  async function handleSyncStatus(id: string) {
    await apiClient.post(`/product-cards/${id}/sync-feed-status`);
    await loadCards();
    setSuccess("Статус обновлён");
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await apiClient.post<{ created: number; skipped: number; sent_to_nk?: number }>(
        "/product-cards/import-excel",
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      const sentNk = res.data.sent_to_nk ?? 0;
      setSuccess(
        `Импорт завершён: создано ${res.data.created}, отправлено в НК ${sentNk}, пропущено ${res.data.skipped}`,
      );
      await loadCards();
    } catch {
      setError("Ошибка при импорте");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  }

  async function handleSendToSuz() {
    if (selectedIds.size === 0) {
      setError("Выберите карточки для отправки в СУЗ");
      return;
    }
    setSuccess(`Отправлено в СУЗ: ${selectedIds.size} карточек (заглушка)`);
  }

  async function handleBulkCopy() {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    for (const id of selectedIds) {
      await apiClient.post(`/product-cards/${id}/copy`);
    }
    setSelectedIds(new Set());
    await loadCards();
    setSuccess(`Скопировано карточек: ${count}`);
  }

  function handleExportSelected() {
    const rows = cards.filter((c) => selectedIds.has(c.id));
    if (rows.length === 0) {
      setError("Выберите карточки для экспорта");
      return;
    }
    exportCardsToCsv(rows);
    setSuccess(`Экспортировано: ${rows.length}`);
  }

  async function handleDownloadList() {
    try {
      const res = await apiClient.get("/product-cards/export-excel", {
        responseType: "blob",
      });
      const url = URL.createObjectURL(
        new Blob([res.data], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "product_cards.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      setSuccess("Список карточек скачан");
    } catch {
      setError("Не удалось скачать список");
    }
  }

  async function handleSendList() {
    const draftCards = cards.filter((c) => c.status === "draft");
    if (draftCards.length === 0) {
      setError("Нет карточек в статусе Черновик для отправки");
      return;
    }

    setSendingList(true);
    setError(null);
    let sent = 0;
    let failed = 0;

    for (const card of draftCards) {
      try {
        await apiClient.post(`/product-cards/${card.id}/send-to-nk`);
        sent++;
      } catch {
        failed++;
      }
    }

    await loadCards();
    setSuccess(`Отправлено в НК: ${sent}. Ошибок: ${failed}`);
    setSendingList(false);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((c) => c.id)));
  }

  const filteredTnvedGroups = useMemo(() => {
    const q = tnvedSearch.toLowerCase().trim();
    if (!q) return tnvedGroups.slice(0, 100);
    return tnvedGroups
      .filter(
        (g) =>
          g.tnved.includes(q) ||
          g.cat_name.toLowerCase().includes(q) ||
          g.label.toLowerCase().includes(q),
      )
      .slice(0, 100);
  }, [tnvedSearch, tnvedGroups]);

  const selectedTnvedGroup = useMemo(
    () => tnvedGroups.find((g) => g.tnved === form.tn_ved),
    [tnvedGroups, form.tn_ved],
  );

  const tnvedCodeAttr = useMemo(() => findTnvedCodeAttr(nkAttrs), [nkAttrs]);
  const tnvedCodePresets = useMemo(
    () => tnvedCodePresetsFromAttr(tnvedCodeAttr),
    [tnvedCodeAttr],
  );

  const isTechForbidden = selectedTnvedGroup?.product_group
    ? !(TECH_GTIN_ALLOWED as readonly string[]).includes(selectedTnvedGroup.product_group)
    : false;

  useEffect(() => {
    if (isTechForbidden && form.type === "tech_card") {
      setForm((f) => ({ ...f, type: "unit" }));
    }
  }, [isTechForbidden, form.type]);

  const filteredCardRows = useMemo(() => {
    return cardRows.filter((row) => {
      for (const [field, value] of Object.entries(rowColumnFilters)) {
        if (!value.trim()) continue;
        const cell = String(row.form[field as keyof CardFormData] ?? "").toLowerCase();
        if (!cell.includes(value.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [cardRows, rowColumnFilters]);

  const rowsTotalPages = Math.max(1, Math.ceil(filteredCardRows.length / rowsPageSize));
  const pagedCardRows = filteredCardRows.slice(
    rowsPage * rowsPageSize,
    (rowsPage + 1) * rowsPageSize,
  );

  const filtered = cards.filter((c) => {
    for (const [field, value] of Object.entries(columnFilters)) {
      if (!value.trim()) continue;
      const cell = cardFieldValue(c, field).toLowerCase();
      if (!cell.includes(value.trim().toLowerCase())) return false;
    }
    return true;
  });

  const statusFilterLabel =
    STATUS_FILTER_OPTIONS.find((o) => o.value === filterStatus)?.label ?? "Все статусы";

  const lockedFields = editingCard
    ? getLockedFields(editingCard.status)
    : new Set<string>();

  const isArchived = editingCard?.status === "archived";

  function isSetRow(card: ProductCard) {
    return card.is_set || card.type === "set" || card.type === "bundle";
  }

  function isSigned(card: ProductCard) {
    return (
      card.status === "published" ||
      card.national_catalog_feed_status === "Signed"
    );
  }

  return (
    <div className="page-container-full bg-white">
      <div className="toolbar-muted">
          <label className="flex items-center gap-2">
            <span className="text-sage-600">Категория товаров:</span>
            <select
              value={productCategory}
              onChange={(e) => {
                setProductCategory(e.target.value);
                localStorage.setItem("cards_product_category", e.target.value);
              }}
              className="select-field input-field-sm !w-auto"
            >
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <Check size={14} className="text-forest-600" />
          </label>

          <label className="flex items-center gap-2">
            <span className="text-sage-600">Выберите ЭЦП:</span>
            <select
              value={selectedCertIndex}
              onChange={(e) => {
                const idx = Number(e.target.value);
                setSelectedCertIndex(idx);
                localStorage.setItem("cards_cert_index", String(idx));
                persistSettings();
              }}
              className="select-field input-field-sm max-w-[220px]"
            >
              {certificates.length === 0 ? (
                <option value={1}>ЭЦП не найдена</option>
              ) : (
                certificates.map((c, i) => (
                  <option key={c.thumbprint} value={i + 1}>
                    {c.ownerName.slice(0, 40)}…
                  </option>
                ))
              )}
            </select>
            <Check size={14} className="text-forest-600" />
          </label>

          <span className="flex items-center gap-2 text-sm">
            <span className="text-sage-600">ИНН:</span>
            <span className="font-mono">{device?.inn || "—"}</span>
          </span>

          <label className="flex items-center gap-2">
            <span className="text-sage-600">OMS ID:</span>
            <input
              type="text"
              value={omsId}
              onChange={(e) => setOmsId(e.target.value)}
              onBlur={persistSettings}
              className="input-field-sm w-48 font-mono text-xs"
            />
            <Check size={14} className="text-forest-600" />
          </label>

          <label className="flex items-center gap-2">
            <span className="text-sage-600">ID соединения:</span>
            <input
              type="text"
              value={connectionId}
              onChange={(e) => setConnectionId(e.target.value)}
              onBlur={persistSettings}
              className="input-field-sm w-48 font-mono text-xs"
            />
            <Check size={14} className="text-forest-600" />
          </label>
      </div>

      <div className="toolbar mx-4 my-4 !rounded-xl">
        <button type="button" onClick={openCreate} className="btn-primary">
          + Создать новую позицию
        </button>

        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setActionMenuOpen(!actionMenuOpen)}
            className="btn-secondary flex items-center gap-1"
          >
            ▼ Действие
          </button>
          {actionMenuOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 min-w-[180px] rounded-xl border border-forest-100 bg-white py-1.5 shadow-glass">
              <button
                type="button"
                className="block w-full px-4 py-2.5 text-left text-sm text-sage-700 hover:bg-forest-50"
                onClick={() => {
                  setActionMenuOpen(false);
                  void handleBulkDelete();
                }}
              >
                Удалить выбранные
              </button>
              <button
                type="button"
                className="block w-full px-4 py-2.5 text-left text-sm text-sage-700 hover:bg-forest-50"
                onClick={() => {
                  setActionMenuOpen(false);
                  void handleBulkCopy();
                }}
              >
                Копировать выбранные
              </button>
              <button
                type="button"
                className="block w-full px-4 py-2.5 text-left text-sm text-sage-700 hover:bg-forest-50"
                onClick={() => {
                  setActionMenuOpen(false);
                  handleExportSelected();
                }}
              >
                Экспорт выбранных
              </button>
            </div>
          )}
        </div>

        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setStatusMenuOpen(!statusMenuOpen)}
            className="btn-secondary flex items-center gap-2"
          >
            {statusFilterLabel}
            <ChevronDown size={16} className="text-slate-400" />
          </button>
          {statusMenuOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 min-w-[160px] rounded-xl border border-forest-100 bg-white py-1.5 shadow-glass">
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`block w-full px-4 py-2.5 text-left text-sm hover:bg-forest-50 ${
                    filterStatus === opt.value ? "font-semibold text-forest-800" : "text-sage-700"
                  }`}
                  onClick={() => {
                    setFilterStatus(opt.value);
                    setStatusMenuOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedIds.size > 0 && (
          <span className="text-sm text-sage-600">Выбрано: {selectedIds.size}</span>
        )}

        <input
          ref={importRef}
          type="file"
          accept=".xlsx,.csv"
          className="hidden"
          onChange={handleImport}
        />

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleDownloadList()}
            className="btn-accent"
          >
            Скачать список карточек
          </button>
          <button
            type="button"
            onClick={() => void handleSendList()}
            disabled={sendingList}
            className="btn-accent disabled:opacity-50"
          >
            {sendingList ? "Отправка..." : "Отправить список карточек"}
          </button>
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            disabled={importing}
            className="btn-secondary btn-sm"
            title="Импорт Excel/CSV"
          >
            {importing ? "…" : "Импорт"}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert-error mx-4 mt-2">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 text-red-400">
            ✕
          </button>
        </div>
      )}
      {success && (
        <div className="alert-success mx-4 mt-2">
          {success}
          <button type="button" onClick={() => setSuccess(null)} className="ml-2">
            ✕
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full min-w-[1400px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-gradient-to-b from-sage-50 to-forest-50/50">
            <tr className="border-b border-forest-100">
              <th className="w-8 px-2 py-2">
                <input
                  type="checkbox"
                  checked={selectedIds.size === filtered.length && filtered.length > 0}
                  onChange={toggleAll}
                />
              </th>
              <ColumnHeader label="GTIN" field="gtin" onFilter={handleColumnFilter} filters={columnFilters} />
              <ColumnHeader
                label="Дата создания ↓"
                field="created_at"
                onFilter={handleColumnFilter}
                filters={columnFilters}
              />
              <ColumnHeader
                label="Наименование товара"
                field="name"
                onFilter={handleColumnFilter}
                filters={columnFilters}
              />
              <th className="px-2 py-2 text-left text-xs font-medium text-slate-700">Набор</th>
              <ColumnHeader label="Бренд" field="brand" onFilter={handleColumnFilter} filters={columnFilters} />
              <ColumnHeader
                label="Вид товара"
                field="product_kind"
                onFilter={handleColumnFilter}
                filters={columnFilters}
              />
              <ColumnHeader
                label="Код ТН ВЭД"
                field="tn_ved_code"
                onFilter={handleColumnFilter}
                filters={columnFilters}
              />
              <ColumnHeader
                label="Страна производства"
                field="country"
                onFilter={handleColumnFilter}
                filters={columnFilters}
              />
              <ColumnHeader label="Цвет" field="color" onFilter={handleColumnFilter} filters={columnFilters} />
              <ColumnHeader label="Размер" field="size" onFilter={handleColumnFilter} filters={columnFilters} />
              <ColumnHeader
                label="Тип текст."
                field="size_type"
                onFilter={handleColumnFilter}
                filters={columnFilters}
              />
              <ColumnHeader
                label="Возраст п."
                field="gender"
                onFilter={handleColumnFilter}
                filters={columnFilters}
              />
              <ColumnHeader
                label="Состав"
                field="composition"
                onFilter={handleColumnFilter}
                filters={columnFilters}
              />
              <ColumnHeader label="Статус" field="status" onFilter={handleColumnFilter} filters={columnFilters} />
              <th className="px-2 py-2 text-left text-xs font-medium text-slate-700">Расширен.</th>
              <th className="px-2 py-2 text-left text-xs font-medium text-slate-700">Подписан</th>
              <th className="px-2 py-2 text-left text-xs font-medium text-slate-700">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={18} className="px-3 py-12 text-center text-sage-400">
                  Загрузка...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={18} className="px-3 py-12 text-center text-sage-400">
                  Нет данных
                </td>
              </tr>
            ) : (
              filtered.map((card) => (
                <tr
                  key={card.id}
                  className={`cursor-pointer border-b border-forest-50 hover:bg-forest-50/50 ${
                    isSetRow(card) ? "bg-forest-50/80" : ""
                  }`}
                  onDoubleClick={() => openEdit(card)}
                >
                  <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(card.id)}
                      onChange={() => toggleSelect(card.id)}
                    />
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs">{card.gtin || "—"}</td>
                  <td className="px-2 py-1.5 text-xs text-slate-500">
                    {new Date(card.created_at).toLocaleDateString("ru-RU")}
                  </td>
                  <td className="max-w-[200px] truncate px-2 py-1.5" title={card.name}>
                    {card.name}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input type="checkbox" checked={isSetRow(card)} readOnly className="pointer-events-none" />
                  </td>
                  <td className="px-2 py-1.5 text-slate-600">{card.brand || "—"}</td>
                  <td className="px-2 py-1.5 text-slate-600">{card.product_kind || "—"}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{card.tn_ved_code || card.tn_ved}</td>
                  <td className="px-2 py-1.5 text-slate-600">{card.country || "—"}</td>
                  <td className="px-2 py-1.5 text-slate-600">{card.color || "—"}</td>
                  <td className="px-2 py-1.5 text-slate-600">{card.size || "—"}</td>
                  <td className="px-2 py-1.5 text-slate-600">{card.size_type || "—"}</td>
                  <td className="px-2 py-1.5 text-slate-600">{card.gender || "—"}</td>
                  <td className="max-w-[120px] truncate px-2 py-1.5 text-xs text-slate-600">
                    {card.composition || "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className={
                        statusColors[card.status] ??
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-slate-100 text-slate-600"
                      }
                    >
                      {statusLabels[card.status] ?? card.status}
                    </span>
                    {(() => {
                      const cardError = getCardError(card);
                      return cardError ? (
                        <p className="text-xs text-red-500 mt-0.5 max-w-xs" title={cardError}>
                          ⚠️ {cardError.slice(0, 60)}{cardError.length > 60 ? "..." : ""}
                        </p>
                      ) : null;
                    })()}
                  </td>
                  <td className="px-2 py-1.5 text-center text-slate-500">
                    {card.extra_attrs?.nk_attrs ? "✓" : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {isSigned(card) ? (
                      <Check size={16} className="inline text-forest-600" />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {card.national_catalog_feed_id && (
                      <button
                        type="button"
                        onClick={() => void handleRefreshFromNk(card.id)}
                        title="Обновить данные карточки из Национального каталога"
                        className="text-xs text-slate-500 hover:text-blue-600 mr-2"
                      >
                        Нашли ошибку
                      </button>
                    )}
                    {card.status === "published" && (
                      <button
                        type="button"
                        onClick={() => void handleArchive(card.id)}
                        className="text-xs text-slate-500 hover:text-slate-700"
                      >
                        В архив
                      </button>
                    )}
                    {card.status === "archived" && (
                      <button
                        type="button"
                        onClick={() => void handleUnarchive(card.id)}
                        className="text-xs text-blue-600 hover:text-blue-700"
                      >
                        Восстановить
                      </button>
                    )}
                    {card.status !== "published" && card.status !== "archived" && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(card.id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Удалить
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-forest-100 bg-white px-4 py-4">
        <div className="flex items-center gap-2 text-sm text-sage-600">
          <span>На странице:</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="select-field input-field-sm !w-auto"
          >
            <option value={100}>100</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
        </div>
        <div className="flex items-center gap-2 text-sm text-sage-600">
          <button type="button" disabled={page === 0} onClick={() => setPage(0)} className="btn-sm btn-ghost disabled:opacity-40">
            |&lt;
          </button>
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="btn-sm btn-ghost disabled:opacity-40"
          >
            &lt;
          </button>
          <span>
            {total === 0 ? 0 : page * pageSize + 1} to {Math.min((page + 1) * pageSize, total)} of{" "}
            {total.toLocaleString("ru-RU")}
          </span>
          <span>
            Page {page + 1} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            className="btn-sm btn-ghost disabled:opacity-40"
          >
            &gt;
          </button>
          <button
            type="button"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(totalPages - 1)}
            className="btn-sm btn-ghost disabled:opacity-40"
          >
            &gt;|
          </button>
        </div>
        <button
          type="button"
          onClick={() => void handleSendToSuz()}
          className="btn-primary"
        >
          Отправить в СУЗ
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex items-center bg-gradient-to-r from-forest-800 to-forest-700 px-4 py-3 text-white">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="mr-3 rounded-lg p-1.5 text-lg transition hover:bg-white/10"
            >
              ✕
            </button>
            <span className="font-medium">
              {editingCard ? "Редактирование товара" : "Добавление товара"}
            </span>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {}
            <div className="flex w-96 flex-shrink-0 flex-col overflow-hidden border-r border-forest-100 bg-white">
              <div className="flex border-b border-forest-100">
                <button
                  type="button"
                  onClick={() => setActiveTab("basic")}
                  className={`-mb-px border-b-2 px-4 py-3 text-sm font-semibold transition ${
                    activeTab === "basic"
                      ? "border-forest-700 text-forest-800"
                      : "border-transparent text-sage-500 hover:text-sage-700"
                  }`}
                >
                  Основные
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("extra")}
                  className={`-mb-px border-b-2 px-4 py-3 text-sm font-semibold transition ${
                    activeTab === "extra"
                      ? "border-forest-700 text-forest-800"
                      : "border-transparent text-sage-500 hover:text-sage-700"
                  }`}
                >
                  Дополнительные
                </button>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {editingCard && (
                  <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
                    {editingCard.status === "draft" &&
                      "Черновик: можно менять всё кроме Бренда и 4-значного ТН ВЭД."}
                    {editingCard.status === "awaiting_sign" &&
                      "Ожидает подписания: обязательные поля заблокированы."}
                    {editingCard.status === "published" &&
                      "Опубликована: можно менять только необязательные атрибуты. Обязательные — через техподдержку НКМТ."}
                    {editingCard.status === "archived" &&
                      "В архиве: редактирование недоступно."}
                  </div>
                )}
                {activeTab === "basic" && (
                  <div className="space-y-4">
                    <div>
                      <label className="mb-0.5 block text-xs text-slate-500">Тип товара</label>
                      <select
                        value={form.type}
                        disabled={lockedFields.has("type")}
                        onChange={(e) => {
                          const newType = e.target.value as ProductCardType;
                          setForm((f) => ({
                            ...f,
                            type: newType,
                            gtin: newType === "tech_card" ? "" : f.gtin,
                          }));
                        }}
                        className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm ${
                          lockedFields.has("type") ? "bg-slate-100 cursor-not-allowed" : ""
                        }`}
                      >
                        <option value="unit">Единица товара</option>
                        <option value="set">Комплект</option>
                        {!isTechForbidden && (
                          <option value="tech_card">Техническая карточка</option>
                        )}
                        <option value="bundle">Набор</option>
                      </select>
                      {isTechForbidden && form.type !== "tech_card" && (
                        <p className="text-xs text-slate-400 mt-1">
                          Техническая карточка недоступна для данной товарной группы
                        </p>
                      )}
                      {lockedFields.has("type") && (
                        <p className="text-xs text-amber-600 mt-1">
                          Тип товара заблокирован для текущего статуса карточки
                        </p>
                      )}
                    </div>

                    {form.type !== "tech_card" ? (
                      <div>
                        <label className="mb-0.5 block text-xs text-slate-500">GTIN</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={form.gtin}
                          maxLength={14}
                          disabled={lockedFields.has("gtin")}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, "");
                            setForm((f) => ({ ...f, gtin: val }));
                          }}
                          placeholder="8, 12, 13 или 14 цифр"
                          className={`w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm ${
                            lockedFields.has("gtin") ? "bg-slate-100 cursor-not-allowed" : ""
                          }`}
                        />
                        <p className="text-xs text-slate-400 mt-1">
                          Для типа &quot;Единица товара&quot; GTIN обязателен.
                        </p>
                        {form.type === "bundle" && (
                          <p className="text-xs text-amber-600 mt-1">
                            Для набора сгенерируйте GTIN (префикс 046) и укажите состав ниже.
                          </p>
                        )}
                        {lockedFields.has("gtin") && (
                          <p className="text-xs text-amber-600 mt-1">
                            GTIN заблокирован для текущего статуса карточки
                          </p>
                        )}
                        <div className="mt-1 flex gap-1">
                          <button
                            type="button"
                            onClick={() => void handleGenerateGtin()}
                            disabled={lockedFields.has("gtin")}
                            className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Сгенерировать GTIN
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleFillAvailableGtin()}
                            disabled={lockedFields.has("gtin")}
                            className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Заполнить доступным
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="mb-0.5 block text-xs text-slate-500">GTIN</label>
                        <div className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-400">
                          Присваивается автоматически (префикс 029)
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                          Для технической карточки GTIN не вводится — НК присвоит его
                          при отправке на модерацию.
                        </p>
                      </div>
                    )}

                    {form.type === "bundle" && (
                      <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-sm font-medium text-slate-700">
                            Состав набора (вложенные товары)
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              setSetItems([...setItems, { gtin: "", quantity: 1 }])
                            }
                            className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                          >
                            + Добавить вложение
                          </button>
                        </div>
                        {setItems.length === 0 && (
                          <p className="text-xs text-slate-400">
                            Добавьте GTIN товаров входящих в набор и их количество.
                            Один GTIN указывается один раз — для повторов используйте количество.
                          </p>
                        )}
                        <div className="space-y-2">
                          {setItems.map((item, idx) => (
                            <div key={idx} className="flex gap-2 items-center">
                              <input
                                type="text"
                                inputMode="numeric"
                                placeholder="GTIN вложения (14 цифр)"
                                value={item.gtin}
                                maxLength={14}
                                onChange={(e) => {
                                  const val = e.target.value.replace(/\D/g, "");
                                  setSetItems(
                                    setItems.map((it, i) =>
                                      i === idx ? { ...it, gtin: val } : it,
                                    ),
                                  );
                                }}
                                className="flex-1 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
                              />
                              <input
                                type="number"
                                min={1}
                                placeholder="Кол-во"
                                value={item.quantity}
                                onChange={(e) => {
                                  const q = Math.max(1, parseInt(e.target.value, 10) || 1);
                                  setSetItems(
                                    setItems.map((it, i) =>
                                      i === idx ? { ...it, quantity: q } : it,
                                    ),
                                  );
                                }}
                                className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setSetItems(setItems.filter((_, i) => i !== idx))
                                }
                                className="text-red-500 hover:text-red-700 px-2"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="mb-0.5 block text-xs text-slate-500">Группа ТНВЭД</label>
                      <div className="relative tnved-dropdown">
                        <div
                          onClick={() => {
                            if (!lockedFields.has("tn_ved")) {
                              setShowTnvedDropdown(!showTnvedDropdown);
                            }
                          }}
                          className={`flex w-full items-center justify-between rounded-lg border border-slate-300 px-3 py-2 text-sm ${
                            lockedFields.has("tn_ved")
                              ? "bg-slate-100 cursor-not-allowed"
                              : "cursor-pointer"
                          }`}
                        >
                          <span className={form.tn_ved ? "text-slate-800" : "text-slate-400"}>
                            {form.tn_ved
                              ? tnvedDisplayValue ||
                                tnvedGroups.find((g) => g.tnved === form.tn_ved)?.label ||
                                form.tn_ved
                              : "Выберите..."}
                          </span>
                          <span className="text-slate-400">▼</span>
                        </div>
                        {showTnvedDropdown && (
                          <div className="absolute left-0 right-0 top-full z-50 mt-1 flex max-h-48 flex-col rounded-lg border border-slate-300 bg-white shadow-lg">
                            <input
                              type="text"
                              value={tnvedSearch}
                              onChange={(e) => setTnvedSearch(e.target.value)}
                              placeholder="Поиск..."
                              className="border-b border-slate-200 px-2 py-1.5 text-sm"
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="overflow-y-auto">
                              {tnvedLoading && (
                                <div className="px-3 py-2 text-xs text-slate-400">
                                  Загрузка ТНВЭД...
                                </div>
                              )}
                              {filteredTnvedGroups.map((g) => (
                                <div
                                  key={`${g.cat_id}-${g.tnved}`}
                                  onClick={() => {
                                    setForm((f) => ({
                                      ...f,
                                      tn_ved: g.tnved,
                                      cat_id: String(g.cat_id),
                                    }));
                                    setTnvedDisplayValue(g.label);
                                    setShowTnvedDropdown(false);
                                    setTnvedSearch("");
                                    void loadAttrsForTnved(g.tnved, g.cat_id);
                                  }}
                                  className="cursor-pointer px-3 py-1.5 text-sm hover:bg-blue-50"
                                >
                                  <span className="mr-1 font-mono text-xs text-slate-500">
                                    {g.tnved}
                                  </span>
                                  {g.cat_name}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      {lockedFields.has("tn_ved") && (
                        <p className="text-xs text-amber-600 mt-1">
                          4-значный ТН ВЭД заблокирован для текущего статуса карточки
                        </p>
                      )}
                      {form.tn_ved && form.tn_ved.length < 10 && tnvedCodePresets.length === 0 && (
                        <p className="text-xs text-slate-400 mt-1">
                          Для некоторых товарных групп НК требует 10-значный код ТНВЭД.
                          {form.cat_id
                            ? " Выберите категорию — система покажет допустимые коды."
                            : " Система подберёт его автоматически."}
                        </p>
                      )}
                    </div>

                    {nkCategories.length > 0 && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-orange-500">
                          Категория *
                        </label>
                        <select
                          value={form.cat_id}
                          onChange={(e) => handleCategoryChange(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value="">Выберите категорию...</option>
                          {nkCategories.map((c) => (
                            <option key={c.cat_id} value={String(c.cat_id)}>
                              {c.cat_name || `Категория ${c.cat_id}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {tnvedCodePresets.length > 0 && tnvedCodeAttr && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-orange-500">
                          Код ТНВЭД *
                        </label>
                        <select
                          value={form.tn_ved_code}
                          disabled={lockedFields.has("tn_ved_code")}
                          onChange={(e) => {
                            const val = e.target.value;
                            setForm((f) => ({ ...f, tn_ved_code: val }));
                            setAttrValues((prev) => ({
                              ...prev,
                              [tnvedCodeAttr.attr_id]: val,
                            }));
                          }}
                          className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono ${
                            lockedFields.has("tn_ved_code") ? "bg-slate-100 cursor-not-allowed" : ""
                          }`}
                        >
                          <option value="">Выберите 10-значный код...</option>
                          {tnvedCodePresets.map((code) => (
                            <option key={code} value={code}>
                              {code}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-slate-400">
                          Допустимые коды из каталога НК для выбранной категории.
                        </p>
                        {lockedFields.has("tn_ved_code") && (
                          <p className="text-xs text-amber-600 mt-1">
                            10-значный код ТН ВЭД заблокирован для текущего статуса карточки
                          </p>
                        )}
                      </div>
                    )}

                    {nkAttrs.filter(isBasicLayerAttr).map((attr) => renderAttrField(attr))}

                    {loadingAttrs && (
                      <div className="py-4 text-center text-sm text-slate-400">
                        Загрузка атрибутов НК...
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "extra" && (
                  <div className="space-y-4">
                    {nkAttrs.filter(isExtraLayerAttr).map((attr) => renderAttrField(attr, true))}

                    {nkOptionalAttrs.length > 0 && (
                      <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
                        <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">
                          Дополнительные поля
                        </p>
                        {nkOptionalAttrs.map((attr) => renderAttrField(attr, false))}
                      </div>
                    )}

                    {nkAttrs.filter(isExtraLayerAttr).length === 0 &&
                      nkOptionalAttrs.length === 0 && (
                        <div className="py-8 text-center text-sm text-slate-400">
                          {loadingAttrs
                            ? "Загрузка атрибутов..."
                            : form.tn_ved
                              ? "Нет дополнительных атрибутов для выбранной группы"
                              : "Выберите группу ТНВЭД на вкладке Основные"}
                        </div>
                      )}
                  </div>
                )}
              </div>

              <div className="space-y-2 border-t border-slate-200 p-3">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={form.custom_name}
                    onChange={(e) => setForm((f) => ({ ...f, custom_name: e.target.checked }))}
                  />
                  Самостоятельное указание наименования
                </label>

                {getMissingRequired().length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-orange-600">
                      Заполните обязательные поля:
                    </p>
                    <ul className="space-y-0.5">
                      {getMissingRequired().map((field) => (
                        <li key={field} className="text-xs text-orange-500">
                          • {field}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {editingCard && (
                  <div className="flex flex-wrap gap-1 border-t border-slate-200 pt-2">
                    <button
                      type="button"
                      onClick={() => void handleSyncStatus(editingCard.id)}
                      disabled={!editingCard.national_catalog_feed_id}
                      title={
                        editingCard.national_catalog_feed_id
                          ? "Обновить статус из НК"
                          : "Сначала отправьте карточку в НК"
                      }
                      className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      Синхр. статус
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleCopy(editingCard.id);
                        setShowForm(false);
                      }}
                      className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                    >
                      + Похожий
                    </button>
                    {editingCard.status === "published" && (
                      <button
                        type="button"
                        onClick={() => {
                          void handleArchive(editingCard.id);
                          setShowForm(false);
                        }}
                        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        В архив
                      </button>
                    )}
                    {editingCard.status === "archived" && (
                      <button
                        type="button"
                        onClick={() => {
                          void handleUnarchive(editingCard.id);
                          setShowForm(false);
                        }}
                        className="rounded border border-blue-300 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                      >
                        Восстановить
                      </button>
                    )}
                    {editingCard.status !== "published" && editingCard.status !== "archived" && (
                      <button
                        type="button"
                        onClick={() => {
                          void handleDelete(editingCard.id);
                          setShowForm(false);
                        }}
                        className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {}
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
                <button
                  type="button"
                  onClick={handleDeleteSelectedRows}
                  disabled={selectedRowIndexes.size === 0}
                  className="rounded border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-600 hover:bg-red-100 disabled:opacity-40"
                >
                  − Удалить Строку
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleClearRows}
                    className="rounded bg-slate-100 px-3 py-1 text-xs hover:bg-slate-200"
                  >
                    Очистить
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadTemplate}
                    className="rounded bg-slate-100 px-3 py-1 text-xs hover:bg-slate-200"
                  >
                    Шаблон Для Наборов
                  </button>
                  <button
                    type="button"
                    onClick={handleExportRows}
                    className="rounded bg-slate-100 px-3 py-1 text-xs hover:bg-slate-200"
                  >
                    Экспорт
                  </button>
                  <button
                    type="button"
                    onClick={() => importBufferRef.current?.click()}
                    className="rounded bg-slate-100 px-3 py-1 text-xs hover:bg-slate-200"
                  >
                    Импорт
                  </button>
                  <input
                    ref={importBufferRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={handleImportRows}
                  />
                </div>
              </div>

              <div className="flex-1 overflow-auto">
                <table className="w-full min-w-max border-collapse text-xs">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className="w-8 border-b border-slate-200 px-2 py-2 text-left">
                        <input
                          type="checkbox"
                          checked={
                            filteredCardRows.length > 0 &&
                            selectedRowIndexes.size === filteredCardRows.length
                          }
                          onChange={toggleAllRows}
                        />
                      </th>
                      <th className="w-6 border-b border-slate-200 px-1 py-2"></th>
                      <th className="w-6 border-b border-slate-200 px-1 py-2"></th>
                      {CARD_ROW_COLUMNS.map((col) => (
                        <th
                          key={col.key}
                          className="whitespace-nowrap border-b border-slate-200 px-2 py-2 text-left font-medium text-slate-600"
                        >
                          <div>{col.label}</div>
                          <div className="mt-1">
                            <input
                              type="text"
                              value={rowColumnFilters[col.key] ?? ""}
                              onChange={(e) =>
                                setRowColumnFilters((prev) => ({
                                  ...prev,
                                  [col.key]: e.target.value,
                                }))
                              }
                              className="w-20 rounded border border-slate-200 px-1 py-0.5 text-xs"
                              placeholder="▼"
                            />
                          </div>
                        </th>
                      ))}
                      <th className="whitespace-nowrap border-b border-slate-200 px-2 py-2 text-left font-medium text-slate-600">
                        Статус
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedCardRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={CARD_ROW_COLUMNS.length + 4}
                          className="px-4 py-16 text-center text-slate-400"
                        >
                          Нет данных
                        </td>
                      </tr>
                    ) : (
                      pagedCardRows.map((row) => {
                        const idx = cardRows.indexOf(row);
                        const isBundle = row.form.type === "bundle";
                        const isExpanded = expandedRows.has(idx);

                        return (
                          <Fragment key={idx}>
                            <tr className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="px-2 py-1.5">
                                <input
                                  type="checkbox"
                                  checked={selectedRowIndexes.has(idx)}
                                  onChange={() => toggleRowSelect(idx)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </td>
                              <td className="w-6 px-1 py-1.5">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openRowInForm(row);
                                  }}
                                  title="Открыть в форме (для атрибутов НК)"
                                  className="text-xs text-slate-400 hover:text-blue-600"
                                >
                                  ✎
                                </button>
                              </td>
                              <td className="w-6 px-1 py-1.5">
                                {isBundle && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleRowExpand(idx);
                                    }}
                                    className="text-slate-500 hover:text-slate-700"
                                    title={isExpanded ? "Свернуть состав" : "Показать состав набора"}
                                  >
                                    {isExpanded ? "▼" : "▶"}
                                  </button>
                                )}
                              </td>
                              {CARD_ROW_COLUMNS.map((col) => {
                                const isEditing =
                                  editingCell?.rowIdx === idx && editingCell?.key === col.key;
                                const editable = isCellEditable(row, col.key);
                                const selectOptions = SELECT_CELL_OPTIONS[col.key];

                                return (
                                  <td
                                    key={col.key}
                                    className={`px-2 py-1.5 text-slate-700 ${editable ? "cursor-text" : ""}`}
                                    onClick={(e) => {
                                      if (!editable) return;
                                      e.stopPropagation();
                                      setEditingCell({ rowIdx: idx, key: col.key });
                                    }}
                                  >
                                    {isEditing && selectOptions ? (
                                      <select
                                        autoFocus
                                        value={row.form[col.key as keyof CardFormData] as string}
                                        onChange={(e) => updateRowField(idx, col.key, e.target.value)}
                                        onBlur={finishCellEdit}
                                        onClick={(e) => e.stopPropagation()}
                                        className="w-full rounded border border-blue-400 px-1 py-0.5 text-xs outline-none"
                                      >
                                        {selectOptions.map((o) => (
                                          <option key={o.value} value={o.value}>
                                            {o.label}
                                          </option>
                                        ))}
                                      </select>
                                    ) : isEditing ? (
                                      <input
                                        autoFocus
                                        type="text"
                                        inputMode={col.key === "gtin" ? "numeric" : undefined}
                                        value={String(row.form[col.key as keyof CardFormData] ?? "")}
                                        onChange={(e) => updateRowField(idx, col.key, e.target.value)}
                                        onBlur={finishCellEdit}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" || e.key === "Escape") finishCellEdit();
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        className="w-full rounded border border-blue-400 px-1 py-0.5 font-mono text-xs outline-none"
                                      />
                                    ) : (
                                      formatRowCell(row, col.key)
                                    )}
                                  </td>
                                );
                              })}
                              <td className="px-2 py-1.5">
                                {row._status === "sent" && (
                                  <span className="text-emerald-600 text-xs">Отправлено ✓</span>
                                )}
                                {row._status === "sending" && (
                                  <span className="text-amber-600 text-xs">Отправка...</span>
                                )}
                                {row._status === "error" && (
                                  <span className="text-red-600 text-xs" title={row._error}>
                                    Ошибка
                                  </span>
                                )}
                                {(!row._status || row._status === "draft") && (
                                  <span className="text-slate-400 text-xs">Черновик</span>
                                )}
                              </td>
                            </tr>

                            {isBundle && isExpanded && (
                              <tr className="bg-blue-50/40">
                                <td colSpan={CARD_ROW_COLUMNS.length + 4} className="px-6 py-3">
                                  <div className="border-l-2 border-blue-300 pl-3">
                                    <div className="mb-2 flex items-center justify-between">
                                      <span className="text-xs font-medium text-slate-600">
                                        Состав набора «{row.form.name || "без названия"}»
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => addSetItemToRow(idx)}
                                        className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white hover:bg-blue-700"
                                      >
                                        + Вложение
                                      </button>
                                    </div>
                                    {row.setItems.length === 0 ? (
                                      <p className="text-xs text-slate-400">
                                        Состав пуст. Добавьте GTIN товаров входящих в набор.
                                      </p>
                                    ) : (
                                      <div className="space-y-1">
                                        {row.setItems.map((item, itemIdx) => (
                                          <div key={itemIdx} className="flex items-center gap-2">
                                            <span className="w-5 text-xs text-slate-400">
                                              {itemIdx + 1}.
                                            </span>
                                            <input
                                              type="text"
                                              inputMode="numeric"
                                              placeholder="GTIN вложения (14 цифр)"
                                              value={item.gtin}
                                              maxLength={14}
                                              onChange={(e) =>
                                                updateSetItemInRow(
                                                  idx,
                                                  itemIdx,
                                                  "gtin",
                                                  e.target.value,
                                                )
                                              }
                                              className="max-w-xs flex-1 rounded border border-slate-300 px-2 py-0.5 font-mono text-xs"
                                            />
                                            <span className="text-xs text-slate-400">×</span>
                                            <input
                                              type="number"
                                              min={1}
                                              value={item.quantity}
                                              onChange={(e) =>
                                                updateSetItemInRow(
                                                  idx,
                                                  itemIdx,
                                                  "quantity",
                                                  e.target.value,
                                                )
                                              }
                                              className="w-16 rounded border border-slate-300 px-2 py-0.5 text-xs"
                                            />
                                            <button
                                              type="button"
                                              onClick={() => removeSetItemFromRow(idx, itemIdx)}
                                              className="px-1 text-xs text-red-500 hover:text-red-700"
                                            >
                                              ✕
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    <p className="mt-2 text-xs text-slate-400">
                                      Один GTIN — одна строка. Для повторов используйте количество.
                                      Вложения должны быть опубликованы в НК.
                                    </p>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200 bg-white px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>Размер страницы:</span>
                  <select
                    value={rowsPageSize}
                    onChange={(e) => {
                      setRowsPageSize(Number(e.target.value));
                      setRowsPage(0);
                    }}
                    className="rounded border border-slate-300 px-1 py-0.5"
                  >
                    <option value={100}>100</option>
                    <option value={500}>500</option>
                    <option value={1000}>1000</option>
                  </select>
                  <span>
                    {filteredCardRows.length === 0
                      ? "0 по 0 из 0"
                      : `${rowsPage * rowsPageSize + 1} по ${Math.min((rowsPage + 1) * rowsPageSize, filteredCardRows.length)} из ${filteredCardRows.length}`}
                  </span>
                  <span>
                    |&lt; &lt; Страница {filteredCardRows.length === 0 ? 0 : rowsPage + 1} из{" "}
                    {filteredCardRows.length === 0 ? 0 : rowsTotalPages} &gt; &gt;|
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleAddRow}
                    className="rounded bg-emerald-500 px-4 py-1.5 text-xs text-white hover:bg-emerald-600"
                  >
                    + Добавить
                  </button>
                </div>
              </div>

              <div className="flex justify-between border-t border-slate-200 bg-white px-3 py-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded bg-red-500 px-4 py-1.5 text-xs text-white hover:bg-red-600"
                >
                  Закрыть
                </button>
                <div className="flex gap-2">
                  {editingCard ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleSaveOnly()}
                        disabled={submitting || isArchived}
                        className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {submitting ? "Сохранение..." : "Сохранить локально"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSubmitAndSend()}
                        disabled={submitting || isArchived}
                        className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {submitting ? "Отправка..." : "Сохранить и отправить в НК"}
                      </button>
                    </>
                  ) : (
                    <div className="flex gap-2">
                      {cardRows.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => void handleSubmitAllRows()}
                          disabled={submitting}
                          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {submitting
                            ? "Отправка..."
                            : `Создать и отправить все (${cardRows.length})`}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleSubmit(true)}
                          disabled={submitting}
                          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {submitting ? "Создание..." : "Создать и отправить в НК"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
