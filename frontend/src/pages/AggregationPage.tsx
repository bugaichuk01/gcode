import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Printer, Upload } from "lucide-react";
import apiClient from "../api/client";
import PageHeader from "../components/ui/PageHeader";
import Alert from "../components/ui/Alert";
import { signBodyBase64 } from "../services/signingService";
import { useProductGroups } from "../hooks/useProductGroups";
import { useWedgeScanner } from "../hooks/useWedgeScanner";
import {
  exportKituToXlsx,
  formatKituStatusForExcel,
  parseKituExcel,
} from "../utils/kituExcel";
import { exportKituContentsToXlsx } from "../utils/kituContentsExcel";
import { extractGtinFromMarkingCode } from "../utils/markingCode";
import { fetchGtinProductFieldsMap } from "../utils/gtinProductFields";
import {
  classifyScannedCode,
  extractKituDigits,
} from "../utils/scanCodeClassifier";
import {
  isScanSoundsEnabled,
  playScanCompleteSound,
  playScanErrorSound,
  playScanSuccessSound,
  setScanSoundsEnabled,
} from "../utils/scanSounds";
import ChzConveyorTab from "./ChzConveyorTab";
import { printAggregationLabelsPdf, printSsccLabelPdf, downloadAggregationSystemBarcodesPdf } from "../labels/labelPdfApi";
import {
  createAggregationDraft,
  createSetAggregationDraft,
  sendSetAggregationDocument,
} from "../services/chzDocumentSend";

const DEFAULT_GCP = "460000000";

const AGG_KITU_TEMPLATE_KEY = "aggregationKituTemplateId";
const AGG_UNIT_TEMPLATE_KEY = "aggregationUnitTemplateId";

function pickAggregationTemplates(list: LabelTemplateOption[]) {
  const savedKitu = localStorage.getItem(AGG_KITU_TEMPLATE_KEY);
  const savedUnit = localStorage.getItem(AGG_UNIT_TEMPLATE_KEY);
  const kituFromStorage = savedKitu ? list.find((t) => t.id === savedKitu) : undefined;
  const unitFromStorage = savedUnit ? list.find((t) => t.id === savedUnit) : undefined;
  const ssccTpl = list.find((t) => t.name.toLowerCase().includes("sscc"));
  const unitTpl =
    list.find((t) => t.width_mm === 58 && t.height_mm === 40) ?? list[0];
  return {
    kituTemplateId: kituFromStorage?.id ?? ssccTpl?.id ?? list[0]?.id ?? "",
    unitTemplateId: unitFromStorage?.id ?? unitTpl?.id ?? list[0]?.id ?? "",
  };
}

type AggregationPageTab = "workflow" | "set" | "contents" | "conveyor";

const PAGE_TABS: { id: AggregationPageTab; label: string }[] = [
  { id: "workflow", label: "Агрегация" },
  { id: "set", label: "Набор" },
  { id: "contents", label: "Просмотр содержимого КИТУ" },
  { id: "conveyor", label: "Работа с ЧЗ" },
];

interface BundleCardOption {
  id: string;
  name: string;
  gtin: string | null;
  set_items: Array<{ gtin: string; quantity: number }>;
}

function isBundleCard(card: { is_set?: boolean; type?: string }): boolean {
  return Boolean(card.is_set || card.type === "set" || card.type === "bundle");
}

interface KituContentRow {
  code: string;
  gtin: string;
  productName: string;
}

interface AggregationDocument {
  id: string;
  kitu_code: string;
  product_group: string;
  marking_codes: string[];
  units_capacity: number | null;
  aggregation_type?: string;
  status: "draft" | "pending" | "accepted" | "rejected" | "error";
  document_id: string | null;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
}

type LabelTemplateOption = {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
};

function isKituAggregationDoc(doc: AggregationDocument): boolean {
  const aggType = doc.aggregation_type ?? "AGGREGATION";
  return aggType === "AGGREGATION" && (doc.marking_codes?.length ?? 0) > 0;
}

interface GeneratedAggregate {
  id: string;
  kitu_code: string;
  units_capacity: number | null;
  status: "generated" | "unique" | "exists" | "check_error";
  statusDetail?: string;
  scanned_units: string[];
  saved_doc_id?: string | null;
}

interface KituUniquenessResponse {
  results: { kitu_code: string; status: "unique" | "exists" | "error"; detail?: string }[];
  total: number;
  unique_count: number;
  exists_count: number;
  error_count: number;
}

const kituStatusConfig: Record<
  GeneratedAggregate["status"],
  { label: string; className: string }
> = {
  generated: { label: "Сгенерирован", className: "badge-draft" },
  unique: { label: "Уникален", className: "badge-success" },
  exists: { label: "Уже существует", className: "badge-error" },
  check_error: { label: "Ошибка проверки", className: "badge-error" },
};

interface KituBatchResponse {
  items: { kitu_code: string; units_capacity: number | null }[];
  gcp: string;
  extension: number;
}

const docStatusConfig: Record<
  AggregationDocument["status"],
  { label: string; className: string }
> = {
  draft: { label: "Черновик", className: "badge-draft" },
  pending: { label: "Отправлен", className: "badge-warning" },
  accepted: { label: "Принят", className: "badge-success" },
  rejected: { label: "Отклонён", className: "badge-error" },
  error: { label: "Ошибка", className: "badge-error" },
};

function formatUnitsCapacity(capacity: number | null): string {
  return capacity === null ? "Без ограничений" : String(capacity);
}

function findNextFreeKitu(aggregates: GeneratedAggregate[]): GeneratedAggregate | null {
  return aggregates.find((agg) => !agg.saved_doc_id && agg.scanned_units.length === 0) ?? null;
}

export default function AggregationPage() {
  const navigate = useNavigate();
  const { groups: productGroups } = useProductGroups();
  const [documents, setDocuments] = useState<AggregationDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [signing, setSigning] = useState<string | null>(null);

  const [gcp, setGcp] = useState(DEFAULT_GCP);
  const [extension, setExtension] = useState(0);
  const [kituCount, setKituCount] = useState(5);
  const [unlimited, setUnlimited] = useState(false);
  const [unitsPerKitu, setUnitsPerKitu] = useState(10);
  const [generating, setGenerating] = useState(false);
  const [aggregates, setAggregates] = useState<GeneratedAggregate[]>([]);
  const [assemblyMode, setAssemblyMode] = useState<"before" | "after">("before");
  const [activeAggregateId, setActiveAggregateId] = useState<string | null>(null);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const [scanSoundsOn, setScanSoundsOn] = useState(() => isScanSoundsEnabled());
  const [savingScanKituId, setSavingScanKituId] = useState<string | null>(null);
  const [afterAssemblyOpen, setAfterAssemblyOpen] = useState(false);
  const [afterAssemblyUnits, setAfterAssemblyUnits] = useState<string[]>([]);
  const [closingAfterAssembly, setClosingAfterAssembly] = useState(false);
  const [downloadingSystemBarcodes, setDownloadingSystemBarcodes] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [codesText, setCodesText] = useState("");
  const [productGroup, setProductGroup] = useState("perfumery");
  const [kituCode, setKituCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [checkingUniqueness, setCheckingUniqueness] = useState(false);
  const [selectedAggregateIds, setSelectedAggregateIds] = useState<Set<string>>(new Set());
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [labelTemplates, setLabelTemplates] = useState<LabelTemplateOption[]>([]);
  const [showSequentialPrintModal, setShowSequentialPrintModal] = useState(false);
  const [unitTemplateId, setUnitTemplateId] = useState("");
  const [kituTemplateId, setKituTemplateId] = useState("");
  const [sequentialPrinting, setSequentialPrinting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const [pageTab, setPageTab] = useState<AggregationPageTab>("workflow");
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [contentRows, setContentRows] = useState<KituContentRow[]>([]);
  const [contentsLoading, setContentsLoading] = useState(false);
  const [exportingContents, setExportingContents] = useState(false);

  const [bundleCards, setBundleCards] = useState<BundleCardOption[]>([]);
  const [selectedSetCardId, setSelectedSetCardId] = useState("");
  const [setCode, setSetCode] = useState("");
  const [setItemsText, setSetItemsText] = useState("");
  const [creatingSet, setCreatingSet] = useState(false);

  async function loadDocuments() {
    try {
      const res = await apiClient.get<AggregationDocument[]>("/aggregation/");
      setDocuments(res.data);
    } catch {
      setError("Не удалось загрузить документы");
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateKitu() {
    const res = await apiClient.get<{ kitu_code: string }>("/aggregation/generate-kitu");
    setKituCode(res.data.kitu_code);
  }

  useEffect(() => {
    void loadDocuments();
    void handleGenerateKitu();
    void apiClient.get<LabelTemplateOption[]>("/labels/templates").then((res) => {
      const list = res.data;
      setLabelTemplates(list);
      const picked = pickAggregationTemplates(list);
      if (picked.kituTemplateId) {
        setKituTemplateId(picked.kituTemplateId);
      }
      if (picked.unitTemplateId) {
        setUnitTemplateId(picked.unitTemplateId);
      }
    }).catch(() => {});
    void (async () => {
      try {
        const res = await apiClient.get<
          Array<Record<string, unknown>> | { items: Array<Record<string, unknown>> }
        >("/product-cards/", { params: { limit: 1000, offset: 0 } });
        const raw = res.data;
        const list = Array.isArray(raw) ? raw : (raw.items ?? []);
        setBundleCards(
          list
            .filter((card) => isBundleCard(card as { is_set?: boolean; type?: string }))
            .map((card) => ({
              id: String(card.id),
              name: String(card.name ?? ""),
              gtin: (card.gtin as string | null | undefined) ?? null,
              set_items: Array.isArray(card.set_items)
                ? card.set_items.map((it: { gtin?: unknown; quantity?: unknown }) => ({
                    gtin: String(it.gtin ?? ""),
                    quantity: Number(it.quantity ?? 1),
                  }))
                : [],
            })),
        );
      } catch {
        setBundleCards([]);
      }
    })();
    const stored = sessionStorage.getItem("aggregationCodes");
    if (stored) {
      const codes = JSON.parse(stored) as string[];
      setCodesText(codes.join("\n"));
      setShowForm(true);
      sessionStorage.removeItem("aggregationCodes");
    }
  }, []);

  const selectedDoc = documents.find((doc) => doc.id === selectedDocId) ?? null;

  useEffect(() => {
    if (!selectedDoc) {
      setContentRows([]);
      return;
    }

    const codes = selectedDoc.marking_codes ?? [];
    if (codes.length === 0) {
      setContentRows([]);
      return;
    }

    let cancelled = false;
    setContentsLoading(true);
    void (async () => {
      try {
        const gtins = codes.map((code) => extractGtinFromMarkingCode(code));
        const productMap = await fetchGtinProductFieldsMap(gtins);
        if (cancelled) {
          return;
        }
        setContentRows(
          codes.map((code) => {
            const gtin = extractGtinFromMarkingCode(code);
            const product = gtin ? productMap[gtin] : undefined;
            return {
              code,
              gtin,
              productName: product?.name ?? "",
            };
          }),
        );
      } catch {
        if (!cancelled) {
          setContentRows(
            codes.map((code) => ({
              code,
              gtin: extractGtinFromMarkingCode(code),
              productName: "",
            })),
          );
        }
      } finally {
        if (!cancelled) {
          setContentsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedDoc]);

  async function handleBatchGenerate() {
    if (kituCount < 1) {
      setError("Количество КИТУ должно быть не меньше 1");
      return;
    }
    if (!unlimited && unitsPerKitu < 1) {
      setError("Укажите количество единиц на КИТУ");
      return;
    }

    setGenerating(true);
    setError(null);
    try {
      const res = await apiClient.post<KituBatchResponse>("/aggregation/generate-kitu-batch", {
        gcp,
        extension,
        count: kituCount,
        units_per_kitu: unlimited ? null : unitsPerKitu,
        unlimited,
      });
      const newItems: GeneratedAggregate[] = res.data.items.map((item) => ({
        id: crypto.randomUUID(),
        kitu_code: item.kitu_code,
        units_capacity: item.units_capacity,
        status: "generated",
        scanned_units: [],
      }));
      setAggregates((prev) => [...prev, ...newItems]);
      setSuccess(`Сгенерировано ${newItems.length} КИТУ (расширение ${res.data.extension})`);
    } catch (err: unknown) {
      const detail =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setError(typeof detail === "string" ? detail : "Ошибка генерации партии");
    } finally {
      setGenerating(false);
    }
  }

  function handleClearAggregates() {
    setAggregates([]);
    setSelectedAggregateIds(new Set());
    setActiveAggregateId(null);
    setScanFeedback(null);
    setAfterAssemblyOpen(false);
    setAfterAssemblyUnits([]);
  }

  function handleToggleAggregateSelection(id: string) {
    setSelectedAggregateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleToggleAllAggregates() {
    if (selectedAggregateIds.size === aggregates.length) {
      setSelectedAggregateIds(new Set());
    } else {
      setSelectedAggregateIds(new Set(aggregates.map((a) => a.id)));
    }
  }

  async function handleCheckKituUniqueness() {
    const targets =
      selectedAggregateIds.size > 0
        ? aggregates.filter((a) => selectedAggregateIds.has(a.id))
        : aggregates;
    if (targets.length === 0) {
      setError("Нет КИТУ для проверки. Сначала сгенерируйте партию.");
      return;
    }

    setCheckingUniqueness(true);
    setError(null);
    try {
      const res = await apiClient.post<KituUniquenessResponse>(
        "/aggregation/check-kitu-uniqueness",
        {
          kitu_codes: targets.map((a) => a.kitu_code),
          product_group: productGroup,
        },
      );
      const statusByCode = new Map(
        res.data.results.map((r) => [
          r.kitu_code,
          {
            status:
              r.status === "unique"
                ? ("unique" as const)
                : r.status === "exists"
                  ? ("exists" as const)
                  : ("check_error" as const),
            detail: r.detail,
          },
        ]),
      );
      setAggregates((prev) =>
        prev.map((agg) => {
          const mapped = statusByCode.get(agg.kitu_code);
          if (!mapped) {
            return agg;
          }
          return {
            ...agg,
            status: mapped.status,
            statusDetail: mapped.detail,
          };
        }),
      );
      setSuccess(
        `Проверено ${res.data.total}: уникальны ${res.data.unique_count}, уже существуют ${res.data.exists_count}` +
          (res.data.error_count > 0 ? `, ошибок ${res.data.error_count}` : ""),
      );
    } catch (err: unknown) {
      const detail =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setError(typeof detail === "string" ? detail : "Ошибка проверки уникальности КИТУ");
    } finally {
      setCheckingUniqueness(false);
    }
  }

  function handleRemoveAggregate(id: string) {
    setAggregates((prev) => prev.filter((a) => a.id !== id));
    if (activeAggregateId === id) {
      setActiveAggregateId(null);
    }
  }

  const activeAggregateIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeAggregateIdRef.current = activeAggregateId;
  }, [activeAggregateId]);

  const activeAggregate = useMemo(
    () => aggregates.find((agg) => agg.id === activeAggregateId) ?? null,
    [aggregates, activeAggregateId],
  );

  const afterAssemblyUnitsRef = useRef<string[]>([]);
  const afterAssemblyOpenRef = useRef(false);
  useEffect(() => {
    afterAssemblyUnitsRef.current = afterAssemblyUnits;
  }, [afterAssemblyUnits]);
  useEffect(() => {
    afterAssemblyOpenRef.current = afterAssemblyOpen;
  }, [afterAssemblyOpen]);

  const autoPrintKituLabel = useCallback(
    async (kituCode: string) => {
      const tpl =
        labelTemplates.find((t) => t.id === kituTemplateId) ??
        labelTemplates.find((t) => t.name.toLowerCase().includes("sscc")) ??
        labelTemplates[0];
      await printSsccLabelPdf({
        kituCodes: [kituCode],
        widthMm: tpl?.width_mm ?? 100,
        heightMm: tpl?.height_mm ?? 150,
        copies: 1,
        templateId: tpl?.id,
      });
    },
    [kituTemplateId, labelTemplates],
  );

  const closeAfterAssemblySet = useCallback(async () => {
    if (!afterAssemblyOpenRef.current) {
      setScanFeedback("Сначала отсканируйте СТАРТ (AGGR_ST)");
      playScanErrorSound();
      return;
    }

    const units = [...afterAssemblyUnitsRef.current];
    if (units.length === 0) {
      setScanFeedback("Набор пуст — отсканируйте коды маркировки перед КОНЕЦ");
      playScanErrorSound();
      return;
    }

    const freeKitu = findNextFreeKitu(aggregates);
    if (!freeKitu) {
      setScanFeedback("Партия КИТУ закончилась — нет свободных SSCC для привязки");
      playScanErrorSound();
      return;
    }

    setClosingAfterAssembly(true);
    setError(null);
    try {
      const doc = await createAggregationDraft(
        units,
        productGroup,
        freeKitu.kitu_code,
        freeKitu.units_capacity,
      );
      setAggregates((prev) =>
        prev.map((item) =>
          item.id === freeKitu.id
            ? { ...item, scanned_units: units, saved_doc_id: doc.id }
            : item,
        ),
      );
      setAfterAssemblyOpen(false);
      setAfterAssemblyUnits([]);
      setActiveAggregateId(freeKitu.id);
      setScanFeedback(
        `Набор закрыт: ${units.length} влож. → КИТУ ${freeKitu.kitu_code} (сохранён)`,
      );
      playScanCompleteSound();
      setSuccess(`Привязано к КИТУ ${freeKitu.kitu_code}, PDF этикетки открыт для печати`);
      await loadDocuments();
      try {
        await autoPrintKituLabel(freeKitu.kitu_code);
      } catch {
        setError(
          `Документ сохранён (${freeKitu.kitu_code}), но не удалось сформировать PDF этикетки`,
        );
      }
    } catch (err: unknown) {
      const detail =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setError(typeof detail === "string" ? detail : "Ошибка сохранения набора после сборки");
      playScanErrorSound();
    } finally {
      setClosingAfterAssembly(false);
    }
  }, [aggregates, autoPrintKituLabel, productGroup]);

  const handleScannedCode = useCallback(
    (raw: string) => {
      if (pageTab !== "workflow") {
        return;
      }

      const kind = classifyScannedCode(raw);
      setScanFeedback(null);

      if (assemblyMode === "after") {
        if (kind === "aggr_start") {
          const freeKitu = findNextFreeKitu(aggregates);
          if (!freeKitu) {
            setScanFeedback("Партия КИТУ закончилась — сгенерируйте новую партию");
            playScanErrorSound();
            return;
          }
          setAfterAssemblyOpen(true);
          setAfterAssemblyUnits([]);
          setScanFeedback("Набор открыт — сканируйте коды маркировки, затем КОНЕЦ (AGGR_FN)");
          playScanSuccessSound();
          return;
        }

        if (kind === "aggr_end") {
          void closeAfterAssemblySet();
          return;
        }

        if (kind === "kitu") {
          setScanFeedback("В режиме «после сборки» КИТУ не сканируется — он назначается по КОНЕЦ из партии");
          playScanErrorSound();
          return;
        }

        if (kind === "unknown") {
          const preview = raw.trim().slice(0, 48);
          setScanFeedback(
            `Не удалось распознать код${preview ? `: ${preview}${raw.trim().length > 48 ? "…" : ""}` : ""}`,
          );
          playScanErrorSound();
          return;
        }

        if (!afterAssemblyOpenRef.current) {
          setScanFeedback("Сначала отсканируйте СТАРТ (AGGR_ST)");
          playScanErrorSound();
          return;
        }

        const unitCode = raw.trim();
        const freeKitu = findNextFreeKitu(aggregates);
        if (!freeKitu) {
          setScanFeedback("Партия КИТУ закончилась — нет свободного SSCC для текущего набора");
          playScanErrorSound();
          return;
        }

        const allUnits = [
          ...aggregates.flatMap((agg) => agg.scanned_units),
          ...afterAssemblyUnitsRef.current,
        ];
        if (allUnits.includes(unitCode)) {
          setScanFeedback("Дубликат: этот КМ уже отсканирован в сессии");
          playScanErrorSound();
          return;
        }

        if (
          freeKitu.units_capacity !== null &&
          afterAssemblyUnitsRef.current.length >= freeKitu.units_capacity
        ) {
          setScanFeedback(
            `Переполнение: лимит ${freeKitu.units_capacity} ед. для следующего КИТУ ${freeKitu.kitu_code}`,
          );
          playScanErrorSound();
          return;
        }

        const newCount = afterAssemblyUnitsRef.current.length + 1;
        setAfterAssemblyUnits((prev) => [...prev, unitCode]);
        setScanFeedback(
          `Добавлено в набор: ${newCount}${
            freeKitu.units_capacity !== null ? ` / ${freeKitu.units_capacity}` : ""
          } (след. КИТУ: ${freeKitu.kitu_code})`,
        );
        playScanSuccessSound();
        return;
      }

      if (kind === "aggr_start" || kind === "aggr_end") {
        setScanFeedback(
          `Системный код (${raw.trim()}) — используйте режим «После сборки»`,
        );
        playScanErrorSound();
        return;
      }

      if (kind === "unknown") {
        const preview = raw.trim().slice(0, 48);
        setScanFeedback(
          `Не удалось распознать код${preview ? `: ${preview}${raw.trim().length > 48 ? "…" : ""}` : ""}`,
        );
        playScanErrorSound();
        return;
      }

      if (kind === "kitu") {
        const kituDigits = extractKituDigits(raw);
        setAggregates((prev) => {
          const existing = prev.find((agg) => agg.kitu_code === kituDigits);
          if (existing) {
            setActiveAggregateId(existing.id);
            setScanFeedback(
              `Активный КИТУ: ${kituDigits} (${existing.scanned_units.length} влож.)`,
            );
            playScanSuccessSound();
            return prev;
          }
          const newAgg: GeneratedAggregate = {
            id: crypto.randomUUID(),
            kitu_code: kituDigits,
            units_capacity: null,
            status: "generated",
            scanned_units: [],
          };
          setActiveAggregateId(newAgg.id);
          setScanFeedback(`Активный КИТУ: ${kituDigits} (новый)`);
          playScanSuccessSound();
          return [...prev, newAgg];
        });
        return;
      }

      const unitCode = raw.trim();
      const activeId = activeAggregateIdRef.current;
      if (!activeId) {
        setScanFeedback("Сначала отсканируйте КИТУ (SSCC, 18 цифр)");
        playScanErrorSound();
        return;
      }

      setAggregates((prev) => {
        const active = prev.find((agg) => agg.id === activeId);
        if (!active) {
          setScanFeedback("Нет активного КИТУ — отсканируйте SSCC");
          playScanErrorSound();
          return prev;
        }

        const allUnits = prev.flatMap((agg) => agg.scanned_units);
        if (allUnits.includes(unitCode)) {
          setScanFeedback("Дубликат: этот КМ уже отсканирован в сессии");
          playScanErrorSound();
          return prev;
        }

        if (
          active.units_capacity !== null &&
          active.scanned_units.length >= active.units_capacity
        ) {
          setScanFeedback(
            `Переполнение: КИТУ ${active.kitu_code} — лимит ${active.units_capacity} ед.`,
          );
          playScanErrorSound();
          return prev;
        }

        const newCount = active.scanned_units.length + 1;
        setScanFeedback(
          `Добавлено в ${active.kitu_code}: ${newCount}${
            active.units_capacity !== null ? ` / ${active.units_capacity}` : ""
          }`,
        );
        playScanSuccessSound();
        return prev.map((agg) =>
          agg.id === activeId
            ? { ...agg, scanned_units: [...agg.scanned_units, unitCode] }
            : agg,
        );
      });
    },
    [assemblyMode, aggregates, closeAfterAssemblySet, pageTab],
  );

  const scanInputEnabled =
    (assemblyMode === "before" || assemblyMode === "after") && pageTab === "workflow";
  const {
    inputRef: scanInputRef,
    handleKeyDown: scanKeyDown,
    handleInput: scanInput,
    focusInput: focusScanInput,
  } = useWedgeScanner({
    onScan: handleScannedCode,
    enabled: scanInputEnabled,
  });

  async function saveScannedKitu(agg: GeneratedAggregate) {
    if (agg.scanned_units.length === 0) {
      setError("Нет вложений для сохранения");
      return;
    }
    if (agg.saved_doc_id) {
      setError(`КИТУ ${agg.kitu_code} уже сохранён как документ агрегации`);
      return;
    }

    setSavingScanKituId(agg.id);
    setError(null);
    try {
      const doc = await createAggregationDraft(
        agg.scanned_units,
        productGroup,
        agg.kitu_code,
        agg.units_capacity,
      );
      setAggregates((prev) =>
        prev.map((item) =>
          item.id === agg.id ? { ...item, saved_doc_id: doc.id } : item,
        ),
      );
      setSuccess(
        `Сохранён документ агрегации: ${agg.kitu_code} (${agg.scanned_units.length} влож.)`,
      );
      await loadDocuments();
    } catch (err: unknown) {
      const detail =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setError(typeof detail === "string" ? detail : "Ошибка сохранения сессии сканирования");
      playScanErrorSound();
    } finally {
      setSavingScanKituId(null);
    }
  }

  function handleToggleScanSounds() {
    const next = !scanSoundsOn;
    setScanSoundsOn(next);
    setScanSoundsEnabled(next);
    if (next) {
      playScanSuccessSound();
    }
  }

  async function handleDownloadSystemBarcodes() {
    setDownloadingSystemBarcodes(true);
    setError(null);
    try {
      await downloadAggregationSystemBarcodesPdf();
      setSuccess("PDF системных штрихкодов СТАРТ/КОНЕЦ скачан");
    } catch {
      setError("Не удалось сформировать PDF системных штрихкодов");
    } finally {
      setDownloadingSystemBarcodes(false);
    }
  }

  function handleExportKituExcel() {
    if (aggregates.length === 0) {
      setError("Нет КИТУ для экспорта. Сначала сгенерируйте партию.");
      return;
    }
    setExporting(true);
    setError(null);
    try {
      exportKituToXlsx(
        aggregates.map((agg) => ({
          kitu_code: agg.kitu_code,
          units_capacity: agg.units_capacity,
          status: formatKituStatusForExcel(agg.status),
        })),
        `kitu_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      setSuccess(`Экспортировано ${aggregates.length} КИТУ в Excel.`);
    } catch {
      setError("Не удалось выгрузить файл Excel.");
    } finally {
      setExporting(false);
    }
  }

  async function handleImportKituFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setError("Допустим только формат .xlsx");
      return;
    }

    setImporting(true);
    setError(null);
    setSuccess(null);
    try {
      const buffer = await file.arrayBuffer();
      const existingKituCodes = new Set(aggregates.map((agg) => agg.kitu_code));
      const { preview, error } = parseKituExcel(buffer, existingKituCodes);
      if (error || !preview) {
        setError(error ?? "Не удалось разобрать файл Excel.");
        return;
      }

      const newItems: GeneratedAggregate[] = preview.items.map((item) => ({
        id: crypto.randomUUID(),
        kitu_code: item.kitu_code,
        units_capacity: item.units_capacity,
        status: "generated",
        scanned_units: [],
      }));
      setAggregates((prev) => [...prev, ...newItems]);

      const parts = [`Добавлено ${newItems.length} КИТУ`];
      if (preview.skippedDuplicateExisting > 0) {
        parts.push(`пропущено дубликатов (уже в таблице): ${preview.skippedDuplicateExisting}`);
      }
      if (preview.skippedDuplicateInFile > 0) {
        parts.push(`дубликатов в файле: ${preview.skippedDuplicateInFile}`);
      }
      if (preview.skippedInvalid.length > 0) {
        const invalidSummary = preview.skippedInvalid
          .slice(0, 3)
          .map((row) => `стр. ${row.row}: ${row.reason}`)
          .join("; ");
        parts.push(
          `невалидных SSCC: ${preview.skippedInvalid.length}${invalidSummary ? ` (${invalidSummary})` : ""}`,
        );
      }
      if (preview.skippedEmpty > 0) {
        parts.push(`пустых строк: ${preview.skippedEmpty}`);
      }
      setSuccess(`Импорт завершён: ${parts.join("; ")}.`);
    } catch {
      setError("Не удалось прочитать файл Excel.");
    } finally {
      setImporting(false);
    }
  }

  function handlePrintSscc() {
    const fromAggregates =
      selectedAggregateIds.size > 0
        ? aggregates.filter((a) => selectedAggregateIds.has(a.id)).map((a) => a.kitu_code)
        : aggregates.map((a) => a.kitu_code);

    if (fromAggregates.length === 0) {
      setError("Нет КИТУ для печати. Сначала сгенерируйте партию или выберите строки.");
      return;
    }

    sessionStorage.setItem("ssccPrintCodes", JSON.stringify(fromAggregates));
    sessionStorage.setItem("ssccPrintMode", "1");
    navigate("/labels");
  }

  function handlePrintDocSscc(doc: AggregationDocument) {
    sessionStorage.setItem("ssccPrintCodes", JSON.stringify([doc.kitu_code]));
    sessionStorage.setItem("ssccPrintMode", "1");
    navigate("/labels");
  }

  const printableKituDocs = documents.filter(isKituAggregationDoc);

  function handleToggleDocSelection(docId: string) {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  }

  function handleToggleAllDocs() {
    if (selectedDocIds.size === printableKituDocs.length) {
      setSelectedDocIds(new Set());
    } else {
      setSelectedDocIds(new Set(printableKituDocs.map((d) => d.id)));
    }
  }

  function openSequentialPrintModal(docIds?: string[]) {
    const targets =
      docIds ??
      (selectedDocIds.size > 0
        ? Array.from(selectedDocIds)
        : printableKituDocs.map((d) => d.id));
    if (targets.length === 0) {
      setError(
        "Нет документов КИТУ с вложениями. Создайте упаковку с кодами маркировки.",
      );
      return;
    }
    setSelectedDocIds(new Set(targets));
    setShowSequentialPrintModal(true);
    setError(null);
  }

  async function handleSequentialPrint() {
    const docIds = Array.from(selectedDocIds);
    if (docIds.length === 0) {
      setError("Выберите документы КИТУ с вложениями");
      return;
    }
    if (!unitTemplateId || !kituTemplateId) {
      setError("Выберите макет вложений и макет упаковки");
      return;
    }

    setSequentialPrinting(true);
    setError(null);
    try {
      await printAggregationLabelsPdf({
        docIds,
        kituTemplateId,
        unitTemplateId,
      });
      setShowSequentialPrintModal(false);
      setSuccess(
        `Последовательная печать: ${docIds.length} КИТУ с вложениями (одним PDF)`,
      );
    } catch (err: unknown) {
      const detail =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setError(typeof detail === "string" ? detail : "Ошибка последовательной печати");
    } finally {
      setSequentialPrinting(false);
    }
  }

  function handleUseAggregateForPackage(agg: GeneratedAggregate) {
    setKituCode(agg.kitu_code);
    setShowForm(true);
  }

  async function handleCreateSet() {
    const codes = setItemsText
      .split("\n")
      .map((c) => c.trim())
      .filter(Boolean);
    if (!selectedSetCardId) {
      setError("Выберите карточку набора");
      return;
    }
    if (!setCode.trim()) {
      setError("Укажите код набора (КИН)");
      return;
    }
    if (codes.length === 0) {
      setError("Добавьте коды вложений");
      return;
    }

    setCreatingSet(true);
    setError(null);
    try {
      const draft = await createSetAggregationDraft({
        markingCodes: codes,
        productGroup,
        setCode: setCode.trim(),
        productCardId: selectedSetCardId,
      });
      const result = await sendSetAggregationDocument(draft.id);
      if (result.status === "error" || result.status === "rejected") {
        throw new Error(result.error_message || "СУЗ отклонил документ формирования набора");
      }
      setSetItemsText("");
      setSuccess(`Набор сформирован: ${setCode.trim()} (${codes.length} вложений)`);
      await loadDocuments();
    } catch (err: unknown) {
      const detail =
        err instanceof Error
          ? err.message
          : err && typeof err === "object" && "response" in err
            ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
            : undefined;
      setError(typeof detail === "string" ? detail : "Ошибка формирования набора");
    } finally {
      setCreatingSet(false);
    }
  }

  async function handleCreate() {
    const codes = codesText
      .split("\n")
      .map((c) => c.trim())
      .filter(Boolean);
    if (codes.length === 0) {
      setError("Введите коды маркировки");
      return;
    }
    if (codes.length < 2) {
      setError("Для агрегации нужно минимум 2 кода");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      await apiClient.post("/aggregation/", {
        marking_codes: codes,
        product_group: productGroup,
        kitu_code: kituCode || null,
      });
      setCodesText("");
      setShowForm(false);
      setSuccess(`Упаковка создана (${codes.length} товаров)`);
      await loadDocuments();
      await handleGenerateKitu();
    } catch (err: unknown) {
      const detail =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setError(detail || "Ошибка создания");
    } finally {
      setCreating(false);
    }
  }

  async function handleSign(doc: AggregationDocument) {
    setSigning(doc.id);
    setError(null);
    try {
      const bodyRes = await apiClient.get<{ body_b64: string }>(
        `/aggregation/${doc.id}/body`,
      );
      const { body_b64 } = bodyRes.data;
      const signature = await signBodyBase64(body_b64);

      await apiClient.post(`/aggregation/${doc.id}/send`, { signature });
      setSuccess(`Агрегация принята! КИТУ: ${doc.kitu_code}`);
      await loadDocuments();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : err && typeof err === "object" && "response" in err
            ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
            : undefined;
      setError(message || "Ошибка");
    } finally {
      setSigning(null);
    }
  }

  async function handleDisaggregate(doc: AggregationDocument) {
    if (
      !confirm(
        `Расформировать упаковку ${doc.kitu_code}?\nВсе КМ будут освобождены из упаковки.`,
      )
    ) {
      return;
    }
    setSigning(`${doc.id}_dis`);
    setError(null);
    try {
      const bodyRes = await apiClient.get<{ body_b64: string }>(
        `/aggregation/${doc.id}/disaggregation-body`,
      );
      const { body_b64 } = bodyRes.data;
      const signature = await signBodyBase64(body_b64);

      await apiClient.post(`/aggregation/${doc.id}/disaggregate`, { signature });
      setSuccess(`Упаковка ${doc.kitu_code} расформирована`);
      await loadDocuments();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : err && typeof err === "object" && "response" in err
            ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
            : undefined;
      setError(message || "Ошибка");
    } finally {
      setSigning(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Удалить документ?")) return;
    try {
      await apiClient.delete(`/aggregation/${id}`);
      if (selectedDocId === id) {
        setSelectedDocId(null);
      }
      await loadDocuments();
    } catch {
      setError("Не удалось удалить документ");
    }
  }

  function handleExportKituContents() {
    if (!selectedDoc) {
      setError("Выберите КИТУ для выгрузки вложений.");
      return;
    }
    if (contentRows.length === 0) {
      setError("У выбранного КИТУ нет вложений для выгрузки.");
      return;
    }

    setExportingContents(true);
    setError(null);
    try {
      const safeKitu = selectedDoc.kitu_code.replace(/[^\d]/g, "").slice(0, 18);
      exportKituContentsToXlsx(
        contentRows.map((row) => ({
          code: row.code,
          gtin: row.gtin,
          product: row.productName,
        })),
        `kitu_contents_${safeKitu || "export"}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      setSuccess(`Выгружено ${contentRows.length} вложений КИТУ ${selectedDoc.kitu_code}.`);
    } catch {
      setError("Не удалось выгрузить вложения в Excel.");
    } finally {
      setExportingContents(false);
    }
  }

  const codesCount = codesText.split("\n").filter((c) => c.trim()).length;

  const sessionMarkingCodes = codesText
    .split("\n")
    .map((c) => c.trim())
    .filter(Boolean);
  const scanSessionMarkingCodes = aggregates.flatMap((agg) => agg.scanned_units);
  const sessionKituCodes = aggregates.map((a) => a.kitu_code);
  const sessionDefaultKitu =
    kituCode ||
    (selectedAggregateIds.size > 0
      ? aggregates.find((a) => selectedAggregateIds.has(a.id))?.kitu_code
      : undefined) ||
    aggregates[0]?.kitu_code ||
    "";

  return (
    <div className="page-container">
      <PageHeader
        title="Агрегация КИТУ"
        description="Генерация партии SSCC и формирование транспортных упаковок"
        actions={
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            className="btn-accent"
          >
            + Создать упаковку
          </button>
        }
      />

      {error ? (
        <Alert variant="error" onDismiss={() => setError(null)} className="mb-4">
          {error}
        </Alert>
      ) : null}
      {success ? (
        <Alert variant="success" onDismiss={() => setSuccess(null)} className="mb-4">
          {success}
        </Alert>
      ) : null}

      <div className="mb-6 border-b border-slate-200">
        <div className="flex gap-1">
          {PAGE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPageTab(tab.id)}
              className={`-mb-px border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                pageTab === tab.id
                  ? "border-forest-700 text-forest-800"
                  : "border-transparent text-sage-500 hover:text-sage-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {pageTab === "conveyor" ? (
        <ChzConveyorTab
          markingCodes={
            scanSessionMarkingCodes.length > 0 ? scanSessionMarkingCodes : sessionMarkingCodes
          }
          kituCodes={sessionKituCodes}
          defaultKituCode={sessionDefaultKitu}
          productGroup={productGroup}
        />
      ) : null}

      {pageTab === "set" ? (
        <div className="mb-8">
          <div className="mb-4 rounded-xl border border-forest-200 bg-forest-50/80 px-4 py-3 text-sm text-forest-800">
            <strong>Формирование набора</strong> — документ агрегации с типом{" "}
            <code className="text-xs">SETS_AGGREGATION</code>. Код набора (КИН) — эмитированный КМ
            карточки bundle; вложения должны соответствовать <code className="text-xs">set_items</code>{" "}
            в НК. При успехе набор автоматически вводится в оборот.
          </div>

          <div className="card max-w-3xl space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-sage-700">
                Карточка набора
              </label>
              <select
                value={selectedSetCardId}
                onChange={(e) => setSelectedSetCardId(e.target.value)}
                className="select-field"
              >
                <option value="">— выберите набор —</option>
                {bundleCards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.name}
                    {card.gtin ? ` (${card.gtin})` : ""}
                  </option>
                ))}
              </select>
            </div>

            {selectedSetCardId ? (
              <p className="text-sm text-sage-600">
                Состав по карточке:{" "}
                {bundleCards
                  .find((c) => c.id === selectedSetCardId)
                  ?.set_items.map((it) => `${it.gtin}×${it.quantity}`)
                  .join(", ") || "—"}
              </p>
            ) : null}

            <div>
              <label className="mb-1 block text-sm font-medium text-sage-700">
                Код набора (КИН, unitSerialNumber)
              </label>
              <input
                type="text"
                value={setCode}
                onChange={(e) => setSetCode(e.target.value)}
                placeholder="КМ набора из заказа СУЗ"
                className="input-field font-mono text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-sage-700">
                Вложения (КМ), по одному на строку
              </label>
              <textarea
                value={setItemsText}
                onChange={(e) => setSetItemsText(e.target.value)}
                rows={8}
                placeholder="Коды маркировки вложений…"
                className="input-field font-mono text-sm"
              />
              <p className="mt-1 text-xs text-sage-400">
                Сканер вложений — отдельный шаг (P6.8). Сейчас — ручной ввод.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-sm text-sage-700">Товарная группа</label>
              <select
                value={productGroup}
                onChange={(e) => setProductGroup(e.target.value)}
                className="select-field !w-auto text-sm"
              >
                {productGroups.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => void handleCreateSet()}
              disabled={creatingSet}
              className="btn-accent"
            >
              {creatingSet ? "Формирование..." : "Сформировать набор"}
            </button>
          </div>
        </div>
      ) : null}

      {pageTab === "contents" ? (
        <div className="mb-8">
          <div className="mb-4 rounded-xl border border-forest-200 bg-forest-50/80 px-4 py-3 text-sm text-forest-800">
            Просмотр вложений (КМ) внутри <strong>наших</strong> КИТУ — данные из сохранённых
            документов агрегации. Запрос произвольного внешнего SSCC через True API — отдельный шаг.
          </div>

          <div className="card mb-4">
            <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-sage-700">
                  КИТУ (из документов агрегации)
                </label>
                <select
                  value={selectedDocId ?? ""}
                  onChange={(e) => setSelectedDocId(e.target.value || null)}
                  className="select-field font-mono text-sm"
                  disabled={loading || documents.length === 0}
                >
                  <option value="">
                    {loading
                      ? "Загрузка..."
                      : documents.length === 0
                        ? "Нет сохранённых КИТУ"
                        : "Выберите КИТУ"}
                  </option>
                  {documents.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.kitu_code} — {doc.marking_codes.length} влож.
                      {doc.status !== "draft" ? ` (${docStatusConfig[doc.status].label})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={handleExportKituContents}
                  disabled={
                    exportingContents ||
                    !selectedDoc ||
                    contentRows.length === 0 ||
                    contentsLoading
                  }
                  className="btn-secondary w-full sm:w-auto disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  {exportingContents ? "Выгрузка..." : "Выгрузить вложения (.xlsx)"}
                </button>
              </div>
            </div>

            {selectedDoc ? (
              <div className="mb-4 flex flex-wrap gap-4 text-sm text-sage-600">
                <span>
                  <span className="font-medium text-sage-700">КИТУ:</span>{" "}
                  <span className="font-mono text-xs">{selectedDoc.kitu_code}</span>
                </span>
                <span>
                  <span className="font-medium text-sage-700">Вложений:</span>{" "}
                  {selectedDoc.marking_codes.length}
                </span>
                <span>
                  <span className="font-medium text-sage-700">Статус:</span>{" "}
                  <span className={docStatusConfig[selectedDoc.status].className}>
                    {docStatusConfig[selectedDoc.status].label}
                  </span>
                </span>
              </div>
            ) : null}
          </div>

          <div className="table-container">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-12">№</th>
                  <th>Код маркировки (КМ)</th>
                  <th>GTIN</th>
                  <th>Товар</th>
                </tr>
              </thead>
              <tbody>
                {!selectedDoc ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sage-400">
                      Выберите КИТУ из списка, чтобы увидеть вложенные коды маркировки.
                    </td>
                  </tr>
                ) : contentsLoading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sage-400">
                      Загрузка вложений...
                    </td>
                  </tr>
                ) : contentRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sage-400">
                      Нет вложений
                    </td>
                  </tr>
                ) : (
                  contentRows.map((row, index) => (
                    <tr key={`${row.code}-${index}`}>
                      <td className="text-sage-500">{index + 1}</td>
                      <td className="max-w-md break-all font-mono text-xs">{row.code}</td>
                      <td className="font-mono text-xs">{row.gtin || "—"}</td>
                      <td>{row.productName || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {pageTab === "workflow" ? (
        <>
      <div className="mb-6 rounded-xl border border-forest-200 bg-forest-50/80 px-4 py-3 text-sm text-forest-800">
        <strong>Агрегация КИТУ</strong> — генерация SSCC-кодов партией, сканирование вложений (режимы
        «До сборки» и «После сборки») и формирование транспортных упаковок.
      </div>

      <div className="card mb-6">
        <h2 className="mb-4 text-base font-semibold text-sage-900">Генерация КИТУ</h2>
        <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-sage-700">
              Префикс предприятия (GCP)
            </label>
            <input
              type="text"
              value={gcp}
              onChange={(e) => setGcp(e.target.value.replace(/\D/g, "").slice(0, 9))}
              placeholder={DEFAULT_GCP}
              className="input-field font-mono text-sm"
            />
            <p className="mt-1 text-xs text-sage-400">До 9 цифр; хранится в форме (позже — в настройках орг.)</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-sage-700">Расширение</label>
            <select
              value={extension}
              onChange={(e) => setExtension(Number(e.target.value))}
              className="select-field"
            >
              {Array.from({ length: 10 }, (_, i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-sage-700">Кол-во КИТУ</label>
            <input
              type="number"
              min={1}
              max={500}
              value={kituCount}
              onChange={(e) => setKituCount(Math.max(1, Number(e.target.value) || 1))}
              className="input-field"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-sage-700">Кол-во единиц</label>
            <input
              type="number"
              min={1}
              value={unitsPerKitu}
              disabled={unlimited}
              onChange={(e) => setUnitsPerKitu(Math.max(1, Number(e.target.value) || 1))}
              className="input-field disabled:opacity-50"
            />
            <label className="mt-2 flex items-center gap-2 text-sm text-sage-600">
              <input
                type="checkbox"
                checked={unlimited}
                onChange={(e) => setUnlimited(e.target.checked)}
                className="rounded border-sage-300"
              />
              Без ограничений
            </label>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleBatchGenerate()}
          disabled={generating}
          className="btn-accent"
        >
          {generating ? "Генерация..." : "Сгенерировать партию"}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <span className="text-sm font-medium text-sage-700">Режим работы:</span>
        <label className="flex items-center gap-2 text-sm text-sage-700">
          <input
            type="radio"
            name="assemblyMode"
            value="before"
            checked={assemblyMode === "before"}
            onChange={() => {
              setAssemblyMode("before");
              setAfterAssemblyOpen(false);
              setAfterAssemblyUnits([]);
              setScanFeedback(null);
            }}
          />
          До сборки
        </label>
        <label className="flex items-center gap-2 text-sm text-sage-700">
          <input
            type="radio"
            name="assemblyMode"
            value="after"
            checked={assemblyMode === "after"}
            onChange={() => {
              setAssemblyMode("after");
              setActiveAggregateId(null);
              setScanFeedback(null);
            }}
          />
          После сборки
        </label>
      </div>

      <div className="card mb-6">
        <h2 className="mb-2 text-base font-semibold text-sage-900">
          Системные штрихкоды для сканирования
        </h2>
        <p className="mb-3 text-sm text-sage-600">
          PDF с Code128 для команд СТАРТ и КОНЕЦ — распечатайте и наклейте на рабочем месте (режим
          «После сборки»).
        </p>
        <button
          type="button"
          onClick={() => void handleDownloadSystemBarcodes()}
          disabled={downloadingSystemBarcodes}
          className="btn-secondary btn-sm disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {downloadingSystemBarcodes ? "Формирование PDF…" : "Скачать .PDF"}
        </button>
      </div>

      {(assemblyMode === "before" || assemblyMode === "after") ? (
        <div className="card mb-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-sage-900">Сканирование (keyboard wedge)</h2>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-sage-600">
              <input
                type="checkbox"
                checked={scanSoundsOn}
                onChange={handleToggleScanSounds}
                className="rounded border-sage-300"
              />
              Звуковые сигналы
            </label>
          </div>
          <p className="text-sm text-sage-600">
            {assemblyMode === "before"
              ? "Отсканируйте КИТУ (18 цифр SSCC), затем коды маркировки (КМ). Работает с 2D-сканером (wedge) и с ручным вводом в поле + Enter."
              : "Скан СТАРТ (AGGR_ST) → коды маркировки → КОНЕЦ (AGGR_FN). КИТУ назначается автоматически из партии. Ручной ввод AGGR_ST / КМ / AGGR_FN + Enter."}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[280px] flex-1">
              <span className="mb-1 block text-xs font-medium text-sage-500">
                Поле ввода сканера
              </span>
              <input
                ref={scanInputRef}
                type="text"
                className="input-field font-mono text-sm"
                placeholder={
                  assemblyMode === "before"
                    ? "КИТУ или КМ — сканер или ввод + Enter"
                    : "AGGR_ST / КМ / AGGR_FN — ввод + Enter"
                }
                onKeyDown={scanKeyDown}
                onInput={scanInput}
                disabled={closingAfterAssembly}
                onBlur={() => {
                  if (scanInputEnabled) {
                    window.setTimeout(() => focusScanInput(), 0);
                  }
                }}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button type="button" onClick={focusScanInput} className="btn-secondary btn-sm">
              Фокус на сканер
            </button>
          </div>
          {assemblyMode === "before" ? (
            activeAggregate ? (
              <p className="text-sm text-forest-700">
                Активный КИТУ:{" "}
                <span className="font-mono text-xs">{activeAggregate.kitu_code}</span>
                {" · "}
                вложений: {activeAggregate.scanned_units.length}
                {activeAggregate.units_capacity !== null
                  ? ` / ${activeAggregate.units_capacity}`
                  : " (без ограничений)"}
              </p>
            ) : (
              <p className="text-sm text-sage-500">Активный КИТУ не выбран — отсканируйте SSCC.</p>
            )
          ) : afterAssemblyOpen ? (
            <p className="text-sm text-forest-700">
              Набор открыт · вложений: {afterAssemblyUnits.length}
              {(() => {
                const next = findNextFreeKitu(aggregates);
                if (!next) {
                  return " · свободных КИТУ нет";
                }
                return next.units_capacity !== null
                  ? ` / ${next.units_capacity} (след. КИТУ: ${next.kitu_code})`
                  : ` (след. КИТУ: ${next.kitu_code}, без ограничений)`;
              })()}
              {closingAfterAssembly ? " · сохранение…" : ""}
            </p>
          ) : (
            <p className="text-sm text-sage-500">
              Набор закрыт — отсканируйте СТАРТ (AGGR_ST) для нового набора.
            </p>
          )}
          {scanFeedback ? (
            <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-sage-700">
              {scanFeedback}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mb-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-sage-900">Агрегаты (КИТУ)</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={productGroup}
              onChange={(e) => setProductGroup(e.target.value)}
              className="select-field select-sm max-w-[200px]"
              title="Товарная группа для проверки в ЧЗ"
            >
              {productGroups.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleCheckKituUniqueness()}
              disabled={checkingUniqueness || aggregates.length === 0}
              className="btn-accent btn-sm disabled:opacity-50"
            >
              {checkingUniqueness ? "Проверка..." : "Проверить уникальность КИТУ в ЧЗ"}
            </button>
            <button
              type="button"
              onClick={handlePrintSscc}
              disabled={aggregates.length === 0}
              className="btn-secondary btn-sm disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              Печать SSCC
            </button>
            <button
              type="button"
              onClick={handleExportKituExcel}
              disabled={exporting || aggregates.length === 0}
              className="btn-secondary btn-sm disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {exporting ? "Экспорт..." : "Экспорт .Xlsx"}
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              disabled={importing}
              className="btn-secondary btn-sm disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              {importing ? "Импорт..." : "Импорт"}
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(event) => void handleImportKituFileChange(event)}
            />
            <button
              type="button"
              onClick={handleClearAggregates}
              disabled={aggregates.length === 0}
              className="btn-secondary btn-sm disabled:opacity-50"
            >
              Очистить
            </button>
          </div>
        </div>
        <div className="table-container">
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-10">
                  <input
                    type="checkbox"
                    checked={aggregates.length > 0 && selectedAggregateIds.size === aggregates.length}
                    onChange={handleToggleAllAggregates}
                    disabled={aggregates.length === 0}
                    title="Выбрать все"
                  />
                </th>
                <th>КИТУ</th>
                <th>Кол-во единиц</th>
                <th>Отсканировано</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {aggregates.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sage-400">
                    Сгенерируйте партию КИТУ выше
                  </td>
                </tr>
              ) : (
                aggregates.map((agg) => (
                  <tr
                    key={agg.id}
                    className={
                      agg.id === activeAggregateId
                        ? "bg-forest-50 ring-1 ring-inset ring-forest-200"
                        : undefined
                    }
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedAggregateIds.has(agg.id)}
                        onChange={() => handleToggleAggregateSelection(agg.id)}
                      />
                    </td>
                    <td className="font-mono text-xs">
                      {agg.kitu_code}
                      {agg.id === activeAggregateId ? (
                        <span className="ml-2 text-xs font-medium text-forest-700">активен</span>
                      ) : null}
                    </td>
                    <td>{formatUnitsCapacity(agg.units_capacity)}</td>
                    <td>
                      {agg.scanned_units.length}
                      {agg.units_capacity !== null ? ` / ${agg.units_capacity}` : ""}
                      {agg.saved_doc_id ? (
                        <span className="ml-1 text-xs text-forest-600">· сохранён</span>
                      ) : null}
                    </td>
                    <td>
                      <span className={kituStatusConfig[agg.status].className}>
                        {kituStatusConfig[agg.status].label}
                      </span>
                      {agg.statusDetail ? (
                        <p
                          className="mt-1 max-w-xs cursor-help text-xs text-sage-500"
                          title={agg.statusDetail}
                        >
                          {agg.statusDetail.slice(0, 60)}
                          {agg.statusDetail.length > 60 ? "..." : ""}
                        </p>
                      ) : null}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setActiveAggregateId(agg.id)}
                          className="btn-sm btn-secondary"
                        >
                          Выбрать
                        </button>
                        {agg.scanned_units.length > 0 && !agg.saved_doc_id ? (
                          <button
                            type="button"
                            onClick={() => void saveScannedKitu(agg)}
                            disabled={savingScanKituId === agg.id}
                            className="btn-sm btn-accent"
                          >
                            {savingScanKituId === agg.id ? "Сохранение…" : "Сохранить"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => handleUseAggregateForPackage(agg)}
                          className="btn-sm btn-secondary"
                        >
                          В упаковку
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveAggregate(agg.id)}
                          className="px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded"
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-8">
        <h2 className="mb-2 text-base font-semibold text-sage-900">
          Единицы
          {assemblyMode === "before" && activeAggregate ? (
            <span className="ml-2 text-sm font-normal text-sage-500">
              (КИТУ {activeAggregate.kitu_code})
            </span>
          ) : assemblyMode === "after" && afterAssemblyOpen ? (
            <span className="ml-2 text-sm font-normal text-sage-500">(текущий набор)</span>
          ) : assemblyMode === "after" && activeAggregate ? (
            <span className="ml-2 text-sm font-normal text-sage-500">
              (последний КИТУ {activeAggregate.kitu_code})
            </span>
          ) : null}
        </h2>
        <div className="table-container">
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-12">№</th>
                <th>Код</th>
                <th>GTIN</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const unitCodes =
                  assemblyMode === "after" && afterAssemblyOpen
                    ? afterAssemblyUnits
                    : activeAggregate?.scanned_units ?? [];
                if (unitCodes.length === 0) {
                  return (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-sage-400">
                        {assemblyMode === "before"
                          ? "Отсканируйте КМ в активный КИТУ"
                          : afterAssemblyOpen
                            ? "Отсканируйте КМ в текущий набор"
                            : "Отсканируйте СТАРТ (AGGR_ST), затем коды маркировки"}
                      </td>
                    </tr>
                  );
                }
                return unitCodes.map((code, index) => (
                  <tr key={`${code}-${index}`}>
                    <td className="text-sage-500">{index + 1}</td>
                    <td className="max-w-md break-all font-mono text-xs">{code}</td>
                    <td className="font-mono text-xs">
                      {extractGtinFromMarkingCode(code) || "—"}
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {showForm ? (
        <div className="card mb-6">
          <h2 className="mb-4 text-base font-semibold text-sage-900">
            Новая транспортная упаковка
          </h2>

          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-sage-700">
                Товарная группа
              </label>
              <select
                value={productGroup}
                onChange={(e) => setProductGroup(e.target.value)}
                className="select-field"
              >
                {productGroups.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-sage-700">
                КИТУ/SSCC код упаковки
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={kituCode}
                  onChange={(e) => setKituCode(e.target.value)}
                  placeholder="460000000123456789012"
                  className="input-field flex-1 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => void handleGenerateKitu()}
                  className="btn-secondary btn-sm"
                  title="Сгенерировать новый КИТУ"
                >
                  ↻
                </button>
              </div>
              <p className="mt-1 text-xs text-sage-400">18 цифр SSCC</p>
            </div>
          </div>

          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-sage-700">
              Коды маркировки (по одному на строку)
            </label>
            <textarea
              value={codesText}
              onChange={(e) => setCodesText(e.target.value)}
              rows={8}
              placeholder="010290000406494821..."
              className="input-field font-mono text-xs"
            />
            <p className="mt-1 text-xs text-sage-400">Товаров: {codesCount}</p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating}
              className="btn-accent"
            >
              {creating ? "Создание..." : "Создать упаковку"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="btn-secondary"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : null}

      <h2 className="mb-2 text-base font-semibold text-sage-900">Документы агрегации (отправка в ЧЗ)</h2>
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => openSequentialPrintModal()}
          disabled={printableKituDocs.length === 0 || sequentialPrinting}
          className="btn-accent btn-sm disabled:opacity-50"
        >
          <Printer className="h-4 w-4" />
          Последовательная печать КИТУ+вложения
        </button>
        {selectedDocIds.size > 0 ? (
          <span className="self-center text-xs text-sage-500">
            Выбрано документов: {selectedDocIds.size}
          </span>
        ) : null}
      </div>
      <div className="table-container">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-10">
                <input
                  type="checkbox"
                  checked={
                    printableKituDocs.length > 0 &&
                    selectedDocIds.size === printableKituDocs.length
                  }
                  onChange={handleToggleAllDocs}
                  disabled={printableKituDocs.length === 0}
                  title="Выбрать все КИТУ с вложениями"
                />
              </th>
              <th>Дата</th>
              <th>КИТУ код</th>
              <th>Группа</th>
              <th>Товаров</th>
              <th>Ёмкость</th>
              <th>Статус</th>
              <th>ID документа</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sage-400">
                  Загрузка...
                </td>
              </tr>
            ) : documents.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sage-400">
                  Нет упаковок. Создайте первую транспортную упаковку.
                </td>
              </tr>
            ) : (
              documents.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    {isKituAggregationDoc(doc) ? (
                      <input
                        type="checkbox"
                        checked={selectedDocIds.has(doc.id)}
                        onChange={() => handleToggleDocSelection(doc.id)}
                      />
                    ) : null}
                  </td>
                  <td className="text-xs text-sage-500">
                    {new Date(doc.created_at).toLocaleString("ru-RU")}
                  </td>
                  <td className="font-mono text-xs">{doc.kitu_code}</td>
                  <td>{doc.product_group}</td>
                  <td>{doc.marking_codes.length}</td>
                  <td>{formatUnitsCapacity(doc.units_capacity)}</td>
                  <td>
                    <span className={docStatusConfig[doc.status].className}>
                      {docStatusConfig[doc.status].label}
                    </span>
                    {doc.error_message ? (
                      <p
                        className="mt-1 max-w-xs cursor-help text-xs text-red-500"
                        title={doc.error_message}
                      >
                        {doc.error_message.slice(0, 60)}
                        {doc.error_message.length > 60 ? "..." : ""}
                      </p>
                    ) : null}
                  </td>
                  <td className="font-mono text-xs text-sage-400">
                    {doc.document_id ? `${doc.document_id.slice(0, 16)}...` : "—"}
                  </td>
                  <td>
                    <div className="flex flex-wrap items-center gap-2">
                      {(doc.status === "draft" || doc.status === "error") && (
                        <button
                          type="button"
                          onClick={() => void handleSign(doc)}
                          disabled={signing === doc.id}
                          className="btn-sm btn-accent"
                        >
                          {signing === doc.id ? "Подписание..." : "Подписать и отправить"}
                        </button>
                      )}
                      {doc.status === "accepted" ? (
                        <>
                          <span className="text-xs font-medium text-forest-600">✓ Агрегирован</span>
                          <button
                            type="button"
                            onClick={() => void handleDisaggregate(doc)}
                            disabled={signing === `${doc.id}_dis`}
                            className="rounded border border-orange-200 bg-orange-50 px-2 py-1 text-xs text-orange-600 hover:bg-orange-100"
                          >
                            {signing === `${doc.id}_dis` ? "Расформирование..." : "Расформировать"}
                          </button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => handlePrintDocSscc(doc)}
                        className="btn-sm btn-secondary"
                      >
                        <Printer className="h-3 w-3" />
                        Печать SSCC
                      </button>
                      {isKituAggregationDoc(doc) ? (
                        <button
                          type="button"
                          onClick={() => openSequentialPrintModal([doc.id])}
                          className="btn-sm btn-accent"
                        >
                          <Printer className="h-3 w-3" />
                          КИТУ+вложения
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void handleDelete(doc.id)}
                        className="px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded"
                      >
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
        </>
      ) : null}

      {showSequentialPrintModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="card max-w-lg w-full space-y-4 p-6">
            <h3 className="text-lg font-semibold text-sage-900">
              Последовательная печать КИТУ + вложения
            </h3>
            <p className="text-sm text-sage-600">
              Порядок в PDF: страница упаковки (SSCC), затем этикетки вложений (КМ),
              затем следующий КИТУ. Всё одним файлом.
            </p>
            <div>
              <label className="mb-1 block text-sm font-medium text-sage-700">
                1. Макет вложений (КМ, DataMatrix)
              </label>
              <select
                value={unitTemplateId}
                onChange={(e) => {
                  setUnitTemplateId(e.target.value);
                  localStorage.setItem(AGG_UNIT_TEMPLATE_KEY, e.target.value);
                }}
                className="select-field"
              >
                {labelTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.width_mm}×{t.height_mm} мм)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-sage-700">
                2. Макет упаковки (КИТУ, Code128)
              </label>
              <select
                value={kituTemplateId}
                onChange={(e) => {
                  setKituTemplateId(e.target.value);
                  localStorage.setItem(AGG_KITU_TEMPLATE_KEY, e.target.value);
                }}
                className="select-field"
              >
                {labelTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.width_mm}×{t.height_mm} мм)
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-sage-500">
              Документов: {selectedDocIds.size}. Источник вложений — сохранённые документы
              агрегации (marking_codes). Для полей «Номер упаковки» и «Номер этикеток в КИТУ»
              выберите макет упаковки, в который они добавлены в конструкторе (не только SSCC по умолчанию).
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSequentialPrintModal(false)}
                className="btn-secondary"
                disabled={sequentialPrinting}
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void handleSequentialPrint()}
                disabled={sequentialPrinting || !unitTemplateId || !kituTemplateId}
                className="btn-accent"
              >
                {sequentialPrinting ? "Печать…" : "Печать одним файлом"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
