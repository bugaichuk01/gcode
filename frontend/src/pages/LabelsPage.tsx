import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import PageHeader from "../components/ui/PageHeader";
import Alert from "../components/ui/Alert";
import { Eye, Printer, RefreshCw } from "lucide-react";
import apiClient from "../api/client";
import { useCisStatusCheck } from "../hooks/useCisStatusCheck";
import {
  CIS_STATUS_LABELS,
  type CisStatusRowFields,
  formatCisStatusLabel,
} from "../utils/cisStatus";
import { fetchGtinProductFields, fetchGtinProductFieldsMap, upsertGtinBarcode } from "../utils/gtinProductFields";
import {
  extraCatalogFieldsFromFieldCatalog,
  type ExtraCatalogField,
} from "../utils/extraFieldsCatalog";
import type { FieldCatalogItem } from "../labels/blockRegistry";
import {
  CRYPTO_TAIL_MISSING_LABEL,
  CRYPTO_TAIL_PRINT_ERROR,
  filterPrintableCodes,
  hasCryptoTail,
} from "../utils/markingCode";
import {
  DEFAULT_SIZE_PRESET,
  LABEL_SIZE_PRESETS,
  sizePresetKey,
} from "../labels/sizePresets";
import {
  downloadLabelPdfFile,
  fetchLabelPdfFiles,
  fetchLabelPreview,
  fetchSsccLabelPreview,
  formatPdfFileDate,
  printSsccLabelPdf,
  type LabelPdfFileListItem,
} from "../labels/labelPdfApi";

type PrintCodeRow = {
  code: string;
  gtin: string;
  name: string;
  article: string;
  productSize: string;
  barcode: string;
  status: string;
};

type BarcodePrintType = "ean13" | "code128";
type BarcodeColumnSource = "gtin" | "barcode";

function createPrintCodeRow(code: string): PrintCodeRow {
  const gtinMatch = code.match(/^01(\d{14})/);
  return {
    code,
    gtin: gtinMatch?.[1] ?? "",
    name: "",
    article: "",
    productSize: "",
    barcode: "",
    status: "",
  };
}

function applyCisStatusToRows(
  rows: PrintCodeRow[],
  statusMap: Record<string, CisStatusRowFields>,
): PrintCodeRow[] {
  return rows.map((row) => {
    const fields = statusMap[row.code];
    if (!fields) {
      return row;
    }
    return {
      ...row,
      status: fields.status,
      gtin: fields.gtin || row.gtin,
    };
  });
}

function applyProductFieldsToRows(
  rows: PrintCodeRow[],
  productMap: Record<string, { name: string; article: string; size: string; barcode: string }>,
): PrintCodeRow[] {
  return rows.map((row) => {
    const product = row.gtin ? productMap[row.gtin] : undefined;
    if (!product) {
      return row;
    }
    return {
      ...row,
      name: product.name || row.name,
      article: product.article || row.article,
      productSize: product.size || row.productSize,
      barcode: product.barcode || row.barcode,
    };
  });
}

function applyBarcodeToRows(rows: PrintCodeRow[], gtin: string, barcode: string): PrintCodeRow[] {
  if (!gtin) {
    return rows;
  }
  return rows.map((row) => (row.gtin === gtin ? { ...row, barcode } : row));
}

function rowMissingLabelFields(row: PrintCodeRow): boolean {
  return !row.status || !row.gtin || !row.name;
}
type LabelTemplateOption = {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
  is_default: boolean;
};

type LabelSize = {
  key: string;
  title: string;
  widthMm: number;
  heightMm: number;
};

const LABEL_SIZES: LabelSize[] = LABEL_SIZE_PRESETS.map((preset) => ({
  key: sizePresetKey(preset.width_mm, preset.height_mm),
  title: preset.label,
  widthMm: preset.width_mm,
  heightMm: preset.height_mm,
}));

async function parseLabelApiError(err: unknown): Promise<string> {
  if (axios.isAxiosError(err) && err.response?.data instanceof Blob) {
    try {
      const text = await err.response.data.text();
      const json = JSON.parse(text) as { detail?: string };
      if (typeof json.detail === "string") {
        return json.detail;
      }
    } catch {
      // ignore parse errors
    }
  }
  if (axios.isAxiosError(err) && typeof err.response?.data?.detail === "string") {
    return err.response.data.detail;
  }
  return CRYPTO_TAIL_PRINT_ERROR;
}

type PrintLabelResult =
  | { kind: "inline" }
  | { kind: "split"; filesCount: number };

async function printLabelPdf(params: {
  codes: string[];
  widthMm: number;
  heightMm: number;
  copies: number;
  templateId?: string;
  startNumber?: number;
  barcodeType?: BarcodePrintType;
  barcodeColumn?: string;
  barcodeKeepLeadingZero?: boolean;
  barcodeFromExtra?: boolean;
  splitFiles?: boolean;
  pagesPerFile?: number;
  continuousNumbering?: boolean;
}): Promise<PrintLabelResult> {
  const startNumber = params.startNumber ?? 1;
  const splitFiles = params.splitFiles ?? false;
  const barcodePayload = {
    barcode_type: params.barcodeType ?? "ean13",
    barcode_column: params.barcodeColumn ?? "gtin",
    barcode_keep_leading_zero: params.barcodeKeepLeadingZero ?? true,
    barcode_from_extra: params.barcodeFromExtra ?? false,
  };
  const splitPayload = {
    split_files: splitFiles,
    pages_per_file: params.pagesPerFile ?? 100,
    continuous_numbering: params.continuousNumbering ?? false,
  };
  const requestBody = {
    codes: params.codes,
    copies: params.copies,
    start_number: startNumber,
    ...barcodePayload,
    ...splitPayload,
  };

  if (splitFiles) {
    const response = params.templateId
      ? await apiClient.post("/labels/pdf/from-template", {
          template_id: params.templateId,
          ...requestBody,
        })
      : await apiClient.post("/labels/pdf/batch", {
          width_mm: params.widthMm,
          height_mm: params.heightMm,
          ...requestBody,
        });
    const filesCount = Array.isArray(response.data?.files) ? response.data.files.length : 0;
    return { kind: "split", filesCount };
  }

  const response = params.templateId
    ? await apiClient.post(
        "/labels/pdf/from-template",
        {
          template_id: params.templateId,
          ...requestBody,
        },
        { responseType: "blob" },
      )
    : await apiClient.post(
        "/labels/pdf/batch",
        {
          width_mm: params.widthMm,
          height_mm: params.heightMm,
          ...requestBody,
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

const SSCC_SIZE_KEY = sizePresetKey(40, 20);

export default function LabelsPage() {
  const [ssccPrintMode, setSsccPrintMode] = useState(false);
  const [ssccQueue, setSsccQueue] = useState<string[]>([]);
  const [selectedSsccCodes, setSelectedSsccCodes] = useState<Set<string>>(new Set());
  const [activeKituCode, setActiveKituCode] = useState("");
  const [sizeKey, setSizeKey] = useState(
    sizePresetKey(DEFAULT_SIZE_PRESET.width_mm, DEFAULT_SIZE_PRESET.height_mm),
  );
  const [name, setName] = useState("");
  const [article, setArticle] = useState("");
  const [gtin, setGtin] = useState("");
  const [productSize, setProductSize] = useState("");
  const [markingCode, setMarkingCode] = useState("");
  const [printQueue, setPrintQueue] = useState<PrintCodeRow[]>([]);
  const [selectedQueueCodes, setSelectedQueueCodes] = useState<Set<string>>(new Set());
  const [statusUpdateSummary, setStatusUpdateSummary] = useState<string | null>(null);
  const {
    checking: checkingStatus,
    checkedCount,
    checkStatus,
    error: statusCheckError,
    setError: setStatusCheckError,
  } = useCisStatusCheck();  const [suzCodeOptions, setSuzCodeOptions] = useState<string[]>([]);
  const [codesLoadError, setCodesLoadError] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [printNotice, setPrintNotice] = useState<string | null>(null);
  const [isPrintingAll, setIsPrintingAll] = useState(false);
  const [copies, setCopies] = useState(1);
  const [singleFile, setSingleFile] = useState(true);
  const [splitFiles, setSplitFiles] = useState(false);
  const [pagesPerFile, setPagesPerFile] = useState(100);
  const [continuousNumbering, setContinuousNumbering] = useState(false);
  const [startNumber, setStartNumber] = useState(1);
  const [barcodeType, setBarcodeType] = useState<BarcodePrintType>("ean13");
  const [barcodeColumn, setBarcodeColumn] = useState<BarcodeColumnSource>("gtin");
  const [barcodeKeepLeadingZero, setBarcodeKeepLeadingZero] = useState(true);
  const [barcodeFromExtra, setBarcodeFromExtra] = useState(false);
  const [barcodeExtraFieldKey, setBarcodeExtraFieldKey] = useState("");
  const [extraCatalogFields, setExtraCatalogFields] = useState<ExtraCatalogField[]>([]);
  const [editingBarcodeCode, setEditingBarcodeCode] = useState<string | null>(null);
  const [barcodeDraft, setBarcodeDraft] = useState("");
  const [barcodeSaveError, setBarcodeSaveError] = useState<string | null>(null);
  const [savingBarcode, setSavingBarcode] = useState(false);
  const barcodeEditCancelledRef = useRef(false);
  const [templates, setTemplates] = useState<LabelTemplateOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [pdfFiles, setPdfFiles] = useState<LabelPdfFileListItem[]>([]);
  const [pdfFilesLoading, setPdfFilesLoading] = useState(false);
  const [pdfFilesError, setPdfFilesError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const loadPdfFiles = useCallback(async () => {
    setPdfFilesLoading(true);
    setPdfFilesError(null);
    try {
      const files = await fetchLabelPdfFiles();
      setPdfFiles(files);
    } catch (err) {
      console.error("Не удалось загрузить историю PDF:", err);
      setPdfFilesError("Не удалось загрузить список PDF");
    } finally {
      setPdfFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPdfFiles();
  }, [loadPdfFiles]);

  useEffect(() => {
    apiClient
      .get<LabelTemplateOption[]>("/labels/templates")
      .then((r) => setTemplates(r.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    apiClient
      .get<FieldCatalogItem[]>("/labels/field-catalog")
      .then((r) => {
        const fields = extraCatalogFieldsFromFieldCatalog(r.data);
        setExtraCatalogFields(fields);
        if (fields.length > 0) {
          setBarcodeExtraFieldKey((prev) => prev || fields[0].catalogKey);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const storedSscc = sessionStorage.getItem("ssccPrintCodes");
    if (storedSscc) {
      const codes = JSON.parse(storedSscc) as string[];
      if (codes.length > 0) {
        setSsccPrintMode(true);
        setSsccQueue(codes);
        setSelectedSsccCodes(new Set(codes));
        setActiveKituCode(codes[0]);
        setSizeKey(SSCC_SIZE_KEY);
      }
      sessionStorage.removeItem("ssccPrintCodes");
      sessionStorage.removeItem("ssccPrintMode");
      return;
    }

    const stored = sessionStorage.getItem("printCodes");
    if (stored) {
      const codes = JSON.parse(stored) as string[];
      if (codes.length > 0) {
        setMarkingCode(codes[0]);
        setPrintQueue(codes.map(createPrintCodeRow));
        setSelectedQueueCodes(new Set(codes));
      }
      sessionStorage.removeItem("printCodes");
    }
  }, []);
  useEffect(() => {
    if (!ssccPrintMode || templates.length === 0) {
      return;
    }
    const ssccTemplate = templates.find((t) => t.name.toLowerCase().includes("sscc"));
    if (ssccTemplate) {
      setSelectedTemplateId(ssccTemplate.id);
    }
  }, [ssccPrintMode, templates]);

  useEffect(() => {
    let cancelled = false;
    async function loadCodes() {
      try {
        const response = await apiClient.get<{ codes: string[] }>("/emission-orders/marking-codes-for-print");
        if (!cancelled) {
          setSuzCodeOptions(Array.isArray(response.data.codes) ? response.data.codes : []);
          setCodesLoadError(null);
        }
      } catch (e) {
        console.error("Failed to load marking code options:", e);
        if (!cancelled) {
          setCodesLoadError("Не удалось загрузить список кодов из СУЗ/УПД.");
        }
      }
    }
    void loadCodes();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!markingCode) return;

    const queueRow = printQueue.find((row) => row.code === markingCode);
    if (queueRow?.gtin || queueRow?.name) {
      if (queueRow.gtin) setGtin(queueRow.gtin);
      if (queueRow.name) setName(queueRow.name);
      if (queueRow.article) setArticle(queueRow.article);
      if (queueRow.productSize) setProductSize(queueRow.productSize);
      return;
    }

    const match = markingCode.match(/^01(\d{14})/);
    if (!match) return;
    const extractedGtin = match[1];
    setGtin(extractedGtin);

    let cancelled = false;

    fetchGtinProductFields(extractedGtin).then((fields) => {
      if (cancelled) return;
      if (fields.name) setName(fields.name);
      if (fields.article) setArticle(fields.article);
      if (fields.size) setProductSize(fields.size);
    });

    return () => {
      cancelled = true;
    };
  }, [markingCode, printQueue]);
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId),
    [templates, selectedTemplateId],
  );

  const selectedSize = useMemo(() => {
    if (selectedTemplate) {
      return {
        key: sizeKey,
        title: selectedTemplate.name,
        widthMm: selectedTemplate.width_mm,
        heightMm: selectedTemplate.height_mm,
      };
    }
    return LABEL_SIZES.find((item) => item.key === sizeKey) ?? LABEL_SIZES[0];
  }, [sizeKey, selectedTemplate]);

  const loadPreview = useCallback(async () => {
    if (ssccPrintMode) {
      const kitu = activeKituCode.trim();
      if (!kitu) {
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = null;
        }
        setPreviewUrl(null);
        setPreviewError("Выберите или введите код КИТУ (SSCC) для предпросмотра.");
        return;
      }
      if (!/^\d{18}$/.test(kitu)) {
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = null;
        }
        setPreviewUrl(null);
        setPreviewError("КИТУ должен быть 18-значным SSCC (только цифры).");
        return;
      }

      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const blob = await fetchSsccLabelPreview({
          kituCode: kitu,
          templateId: selectedTemplateId || undefined,
          widthMm: selectedSize.widthMm,
          heightMm: selectedSize.heightMm,
          startNumber,
        });
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current);
        }
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setPreviewUrl(url);
      } catch (err) {
        console.error("Ошибка предпросмотра SSCC:", err);
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = null;
        }
        setPreviewUrl(null);
        setPreviewError(await parseLabelApiError(err));
      } finally {
        setPreviewLoading(false);
      }
      return;
    }

    const code = markingCode.trim();
    if (!code) {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      setPreviewUrl(null);
      setPreviewError("Выберите или введите код маркировки для предпросмотра.");
      return;
    }
    if (!hasCryptoTail(code)) {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      setPreviewUrl(null);
      setPreviewError(CRYPTO_TAIL_PRINT_ERROR);
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const blob = await fetchLabelPreview({
        code,
        templateId: selectedTemplateId || undefined,
        widthMm: selectedSize.widthMm,
        heightMm: selectedSize.heightMm,
        startNumber,
        barcodeType,
        barcodeColumn: barcodeFromExtra ? barcodeExtraFieldKey : barcodeColumn,
        barcodeKeepLeadingZero,
        barcodeFromExtra,
      });
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    } catch (err) {
      console.error("Ошибка предпросмотра:", err);
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      setPreviewUrl(null);
      setPreviewError(await parseLabelApiError(err));
    } finally {
      setPreviewLoading(false);
    }
  }, [
    ssccPrintMode,
    activeKituCode,
    markingCode,
    selectedTemplateId,
    selectedSize.widthMm,
    selectedSize.heightMm,
    startNumber,
    barcodeType,
    barcodeColumn,
    barcodeKeepLeadingZero,
    barcodeFromExtra,
    barcodeExtraFieldKey,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPreview();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [loadPreview]);

  useEffect(
    () => () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    },
    [],
  );

  const currentKituValid = useMemo(
    () => !activeKituCode.trim() || /^\d{18}$/.test(activeKituCode.trim()),
    [activeKituCode],
  );

  const currentCodeValid = useMemo(
    () => !markingCode.trim() || hasCryptoTail(markingCode),
    [markingCode],
  );

  const queueWithValidity = useMemo(
    () =>
      printQueue.map((row) => ({
        ...row,
        valid: hasCryptoTail(row.code),
      })),
    [printQueue],
  );

  const selectedRows = useMemo(
    () => queueWithValidity.filter((row) => selectedQueueCodes.has(row.code)),
    [queueWithValidity, selectedQueueCodes],
  );

  const rowsForStatusWarning = selectedRows.length > 0 ? selectedRows : queueWithValidity;
  const showStatusRefreshWarning = useMemo(
    () => printQueue.length > 0 && rowsForStatusWarning.some(rowMissingLabelFields),
    [printQueue.length, rowsForStatusWarning],
  );

  const statusCheckTargetCount =
    selectedQueueCodes.size > 0 ? selectedQueueCodes.size : printQueue.length;

  const toggleQueueCode = useCallback((code: string) => {
    setSelectedQueueCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const toggleAllQueueCodes = useCallback(() => {
    const printableCodes = queueWithValidity.filter((row) => row.valid).map((row) => row.code);
    if (selectedQueueCodes.size === printableCodes.length && printableCodes.length > 0) {
      setSelectedQueueCodes(new Set());
    } else {
      setSelectedQueueCodes(new Set(printableCodes));
    }
  }, [queueWithValidity, selectedQueueCodes.size]);

  const startBarcodeEdit = useCallback((code: string, currentBarcode: string) => {
    barcodeEditCancelledRef.current = false;
    setBarcodeSaveError(null);
    setEditingBarcodeCode(code);
    setBarcodeDraft(currentBarcode);
  }, []);

  const cancelBarcodeEdit = useCallback(() => {
    barcodeEditCancelledRef.current = true;
    setEditingBarcodeCode(null);
  }, []);

  const commitBarcodeEdit = useCallback(async (_rowCode: string, gtin: string, value: string) => {
    if (!gtin || barcodeEditCancelledRef.current) {
      setEditingBarcodeCode(null);
      return;
    }
    barcodeEditCancelledRef.current = true;

    const trimmed = value.trim();
    setEditingBarcodeCode(null);
    setPrintQueue((prev) => applyBarcodeToRows(prev, gtin, trimmed));
    setSavingBarcode(true);
    setBarcodeSaveError(null);

    try {
      await upsertGtinBarcode(gtin, trimmed);
    } catch (err) {
      console.error("Не удалось сохранить баркод:", err);
      setBarcodeSaveError("Не удалось сохранить баркод в доп. полях GTIN.");
    } finally {
      setSavingBarcode(false);
    }
  }, []);

  async function handleCheckQueueStatus() {
    const targetCodes =
      selectedQueueCodes.size > 0
        ? Array.from(selectedQueueCodes)
        : printQueue.map((row) => row.code);

    if (targetCodes.length === 0) {
      return;
    }

    setStatusUpdateSummary(null);
    const statusMap = await checkStatus(targetCodes);
    if (!statusMap) {
      return;
    }

    const withStatus = applyCisStatusToRows(printQueue, statusMap);
    const gtins = withStatus
      .filter((row) => targetCodes.includes(row.code))
      .map((row) => row.gtin)
      .filter(Boolean);
    const productMap = await fetchGtinProductFieldsMap(gtins);
    const enriched = applyProductFieldsToRows(withStatus, productMap);
    setPrintQueue(enriched);

    const updatedCount = targetCodes.filter((code) => Boolean(statusMap[code])).length;
    setStatusUpdateSummary(`Обновлено ${updatedCount} код(ов)`);

    const activeRow = enriched.find((row) => row.code === markingCode);
    if (activeRow) {
      if (activeRow.gtin) setGtin(activeRow.gtin);
      if (activeRow.name) setName(activeRow.name);
      if (activeRow.article) setArticle(activeRow.article);
      if (activeRow.productSize) setProductSize(activeRow.productSize);
    }
  }
  const selectedValidCodes = useMemo(
    () =>
      queueWithValidity
        .filter((row) => row.valid && selectedQueueCodes.has(row.code))
        .map((row) => row.code),
    [queueWithValidity, selectedQueueCodes],
  );

  const printableQueueCodes = useMemo(
    () => queueWithValidity.filter((row) => row.valid).map((row) => row.code),
    [queueWithValidity],
  );

  const selectedSsccList = useMemo(
    () => ssccQueue.filter((code) => selectedSsccCodes.has(code)),
    [ssccQueue, selectedSsccCodes],
  );

  const ssccCodesForBatchPrint = useMemo(() => {
    if (selectedSsccList.length > 0) {
      return selectedSsccList;
    }
    return ssccQueue;
  }, [selectedSsccList, ssccQueue]);

  const ssccBatchCount = ssccCodesForBatchPrint.length;
  const ssccBatchUsesSelection = selectedSsccList.length > 0;

  function codesForBatchPrint(): string[] {
    if (selectedValidCodes.length > 0) {
      return selectedValidCodes;
    }
    return printableQueueCodes;
  }

  const invalidQueueCount = queueWithValidity.filter((item) => !item.valid).length;
  const batchPrintCodes = codesForBatchPrint();
  const batchPrintCount = batchPrintCodes.length;
  const batchPrintUsesSelection = selectedValidCodes.length > 0;

  const barcodePrintOptions = useMemo(
    () => ({
      barcodeType,
      barcodeColumn: barcodeFromExtra ? barcodeExtraFieldKey : barcodeColumn,
      barcodeKeepLeadingZero,
      barcodeFromExtra,
    }),
    [
      barcodeType,
      barcodeColumn,
      barcodeKeepLeadingZero,
      barcodeFromExtra,
      barcodeExtraFieldKey,
    ],
  );

  const splitPrintOptions = useMemo(
    () => ({
      splitFiles,
      pagesPerFile,
      continuousNumbering,
    }),
    [splitFiles, pagesPerFile, continuousNumbering],
  );

  async function handlePrintResult(result: PrintLabelResult) {
    void loadPdfFiles();
    if (result.kind === "split") {
      setPrintNotice(`Создано ${result.filesCount} файлов`);
    }
  }

  function prepareCodesForPrint(codes: string[]): string[] | null {
    const { printable, rejected } = filterPrintableCodes(codes);
    if (rejected.length > 0) {
      setPrintNotice(
        `Исключено ${rejected.length} код(ов) без криптохвоста. ${CRYPTO_TAIL_PRINT_ERROR}`,
      );
    } else {
      setPrintNotice(null);
    }
    if (printable.length === 0) {
      setPrintError(CRYPTO_TAIL_PRINT_ERROR);
      return null;
    }
    return printable;
  }

  async function handlePrint(event: FormEvent) {
    event.preventDefault();
    setPrintError(null);

    if (ssccPrintMode) {
      const kitu = activeKituCode.trim();
      if (!kitu) {
        setPrintError("Введите код КИТУ (SSCC)");
        return;
      }
      if (!/^\d{18}$/.test(kitu)) {
        setPrintError("КИТУ должен быть 18-значным SSCC (только цифры).");
        return;
      }

      try {
        const result = await printSsccLabelPdf({
          kituCodes: [kitu],
          widthMm: selectedSize.widthMm,
          heightMm: selectedSize.heightMm,
          copies,
          templateId: selectedTemplateId || undefined,
          startNumber: singleFile ? startNumber : 1,
          ...splitPrintOptions,
        });
        await handlePrintResult(result);
      } catch (err) {
        console.error("Ошибка генерации PDF SSCC:", err);
        setPrintError(await parseLabelApiError(err));
      }
      return;
    }

    const code = markingCode.trim();
    if (!code) {
      setPrintError("Введите код маркировки");
      return;
    }
    if (!hasCryptoTail(code)) {
      setPrintError(CRYPTO_TAIL_PRINT_ERROR);
      return;
    }

    try {
      const result = await printLabelPdf({
        codes: [code],
        widthMm: selectedSize.widthMm,
        heightMm: selectedSize.heightMm,
        copies,
        templateId: selectedTemplateId || undefined,
        startNumber: singleFile ? startNumber : 1,
        ...barcodePrintOptions,
        ...splitPrintOptions,
      });
      await handlePrintResult(result);
    } catch (err) {
      console.error("Ошибка генерации PDF:", err);
      setPrintError(await parseLabelApiError(err));
    }
  }

  async function handlePrintAll() {
    if (ssccPrintMode) {
      if (ssccBatchCount === 0) return;

      setIsPrintingAll(true);
      setPrintError(null);
      try {
        const result = await printSsccLabelPdf({
          kituCodes: ssccCodesForBatchPrint,
          widthMm: selectedSize.widthMm,
          heightMm: selectedSize.heightMm,
          copies,
          templateId: selectedTemplateId || undefined,
          startNumber: singleFile ? startNumber : 1,
          ...splitPrintOptions,
        });
        await handlePrintResult(result);
      } catch (err) {
        console.error("Ошибка генерации PDF SSCC:", err);
        setPrintError(await parseLabelApiError(err));
      } finally {
        setIsPrintingAll(false);
      }
      return;
    }

    if (batchPrintCount === 0) return;

    setIsPrintingAll(true);
    setPrintError(null);
    const printable = prepareCodesForPrint(batchPrintCodes);
    if (!printable) {
      setIsPrintingAll(false);
      return;
    }

    try {
      const result = await printLabelPdf({
        codes: printable,
        widthMm: selectedSize.widthMm,
        heightMm: selectedSize.heightMm,
        copies,
        templateId: selectedTemplateId || undefined,
        startNumber: singleFile ? startNumber : 1,
        ...barcodePrintOptions,
        ...splitPrintOptions,
      });
      await handlePrintResult(result);
    } catch (err) {
      console.error("Ошибка генерации PDF:", err);
      setPrintError(await parseLabelApiError(err));
    } finally {
      setIsPrintingAll(false);
    }
  }

  const previewScale = 6;
  const previewWidth = selectedSize.widthMm * previewScale;
  const previewHeight = selectedSize.heightMm * previewScale;

  return (
    <div className="page-container print:space-y-0 print:p-0">
      <PageHeader
        title="Печать этикеток"
        description={
          ssccPrintMode
            ? "Режим печати SSCC: штрихкод Code128 по коду КИТУ и макет для транспортной упаковки."
            : "Настройте шаблон, проверьте предпросмотр и отправьте этикетку в печать."
        }
        compact
      />

      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={ssccPrintMode}
            onChange={(e) => {
              const enabled = e.target.checked;
              setSsccPrintMode(enabled);
              if (enabled) {
                setSizeKey(SSCC_SIZE_KEY);
                const ssccTemplate = templates.find((t) => t.name.toLowerCase().includes("sscc"));
                if (ssccTemplate) {
                  setSelectedTemplateId(ssccTemplate.id);
                }
              }
            }}
            className="checkbox-field"
          />
          Печать SSCC (КИТУ)
        </label>
        {ssccPrintMode ? (
          <span className="text-xs text-sage-500">
            Штрихкод Code128 по коду КИТУ, без проверки криптохвоста
          </span>
        ) : null}
      </div>

      {ssccPrintMode && ssccQueue.length > 1 ? (
        <Alert variant="warning" className="mb-6 print:hidden">
          В очереди SSCC: {ssccQueue.length} кодов КИТУ
        </Alert>
      ) : null}

      {printQueue.length > 1 && !ssccPrintMode ? (
        <Alert variant="warning" className="mb-6 print:hidden">
          В очереди печати: {printQueue.length} кодов
          {invalidQueueCount > 0
            ? ` (${invalidQueueCount} без криптохвоста — будут исключены при печати)`
            : ""}
        </Alert>
      ) : null}

      {printNotice ? (
        <Alert variant="warning" onDismiss={() => setPrintNotice(null)} className="mb-4 print:hidden">
          {printNotice}
        </Alert>
      ) : null}

      {printError ? (
        <Alert variant="error" onDismiss={() => setPrintError(null)} className="mb-4 print:hidden">
          {printError}
        </Alert>
      ) : null}

      {statusCheckError ? (
        <Alert
          variant="error"
          onDismiss={() => setStatusCheckError(null)}
          className="mb-4 print:hidden"
        >
          {statusCheckError}
        </Alert>
      ) : null}

      {statusUpdateSummary ? (
        <Alert variant="success" onDismiss={() => setStatusUpdateSummary(null)} className="mb-4 print:hidden">
          {statusUpdateSummary}
        </Alert>
      ) : null}

      {barcodeSaveError ? (
        <Alert variant="error" onDismiss={() => setBarcodeSaveError(null)} className="mb-4 print:hidden">
          {barcodeSaveError}
        </Alert>
      ) : null}

      {showStatusRefreshWarning && !ssccPrintMode ? (
        <Alert variant="warning" className="mb-4 print:hidden">
          Обновите статус кодов перед печатью — без этого поля товара, GTIN и статус ЧЗ могут быть пустыми.
        </Alert>
      ) : null}

      {ssccPrintMode && ssccQueue.length > 0 ? (
        <div className="table-container mb-6 print:hidden">
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-10">
                  <input
                    type="checkbox"
                    checked={
                      selectedSsccCodes.size === ssccQueue.length && ssccQueue.length > 0
                    }
                    onChange={() => {
                      if (selectedSsccCodes.size === ssccQueue.length) {
                        setSelectedSsccCodes(new Set());
                      } else {
                        setSelectedSsccCodes(new Set(ssccQueue));
                      }
                    }}
                    className="checkbox-field"
                  />
                </th>
                <th>КИТУ (SSCC)</th>
              </tr>
            </thead>
            <tbody>
              {ssccQueue.map((kitu) => (
                <tr
                  key={kitu}
                  className="cursor-pointer hover:bg-forest-50/50"
                  onClick={() => setActiveKituCode(kitu)}
                >
                  <td onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedSsccCodes.has(kitu)}
                      onChange={() => {
                        setSelectedSsccCodes((prev) => {
                          const next = new Set(prev);
                          if (next.has(kitu)) next.delete(kitu);
                          else next.add(kitu);
                          return next;
                        });
                      }}
                      className="checkbox-field"
                    />
                  </td>
                  <td className="font-mono text-xs">{kitu}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {printQueue.length > 0 && !ssccPrintMode ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
          <button
            type="button"
            onClick={() => void handleCheckQueueStatus()}
            disabled={checkingStatus}
            className="btn-sm btn-accent"
          >
            <RefreshCw size={14} className={checkingStatus ? "animate-spin" : undefined} />
            {checkingStatus
              ? `Обновление… (${checkedCount}/${statusCheckTargetCount})`
              : `Обновить статус${statusCheckTargetCount > 0 ? ` (${statusCheckTargetCount})` : ""}`}
          </button>
          {selectedQueueCodes.size > 0 ? (
            <button
              type="button"
              onClick={() => setSelectedQueueCodes(new Set())}
              className="text-xs text-slate-400 hover:underline"
            >
              Снять выбор
            </button>
          ) : null}
        </div>
      ) : null}

      {printQueue.length > 0 && !ssccPrintMode ? (
        <div className="table-container mb-6 print:hidden">
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-10">
                  <input
                    type="checkbox"
                    checked={
                      selectedQueueCodes.size === queueWithValidity.filter((row) => row.valid).length &&
                      queueWithValidity.filter((row) => row.valid).length > 0
                    }
                    onChange={toggleAllQueueCodes}
                    className="checkbox-field"
                  />
                </th>
                <th>Код маркировки</th>
                <th>Товар</th>
                <th>GTIN</th>
                <th>Артикул</th>
                <th>Баркод</th>
                <th>Статус ЧЗ</th>
                <th>Криптохвост</th>
              </tr>
            </thead>
            <tbody>
              {queueWithValidity.map((item) => (
                <tr
                  key={item.code}
                  className={`${item.valid ? "" : "bg-red-50"} cursor-pointer hover:bg-forest-50/50`}
                  onClick={() => setMarkingCode(item.code)}
                >
                  <td onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedQueueCodes.has(item.code)}
                      onChange={() => toggleQueueCode(item.code)}
                      disabled={!item.valid}
                      className="checkbox-field disabled:opacity-40"
                    />
                  </td>
                  <td className="max-w-md truncate font-mono text-xs">{item.code}</td>
                  <td className="max-w-[160px] truncate">{item.name || "—"}</td>
                  <td>{item.gtin || "—"}</td>
                  <td>{item.article || "—"}</td>
                  <td
                    className={`max-w-[140px] ${item.gtin ? "cursor-text" : ""}`}
                    title={item.gtin ? "Двойной клик для редактирования баркода" : undefined}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      if (!item.gtin || savingBarcode) {
                        return;
                      }
                      startBarcodeEdit(item.code, item.barcode);
                    }}
                  >
                    {editingBarcodeCode === item.code ? (
                      <input
                        autoFocus
                        type="text"
                        inputMode="numeric"
                        value={barcodeDraft}
                        disabled={savingBarcode}
                        onChange={(event) => setBarcodeDraft(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={() => {
                          void commitBarcodeEdit(item.code, item.gtin, barcodeDraft);
                        }}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void commitBarcodeEdit(item.code, item.gtin, barcodeDraft);
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            cancelBarcodeEdit();
                          }
                        }}
                        className="w-full rounded border border-blue-400 px-1 py-0.5 font-mono text-xs outline-none"
                      />
                    ) : (
                      <span className="block truncate">{item.barcode || "—"}</span>
                    )}
                  </td>
                  <td>
                    {item.status ? (
                      <span
                        className={CIS_STATUS_LABELS[item.status]?.className ?? "badge-draft"}
                      >
                        {formatCisStatusLabel(item.status)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {item.valid ? (
                      <span className="badge-published">готов к печати</span>
                    ) : (
                      <span className="badge-error">{CRYPTO_TAIL_MISSING_LABEL}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
        <form className="card space-y-5 p-5 print:hidden" onSubmit={handlePrint}>
          <div>
            <label className="label-text" htmlFor="label-template">
              Шаблон этикетки
            </label>
            <div className="flex gap-2">
              <select
                id="label-template"
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="select-field flex-1"
              >
                <option value="">Стандартный макет</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.width_mm}×{t.height_mm}мм)
                  </option>
                ))}
              </select>
              <Link
                to="/label-designer"
                className="btn-secondary !px-3"
                title="Конструктор этикеток"
              >
                ✏️
              </Link>
            </div>
          </div>

          {!selectedTemplateId && (
            <div>
              <label className="label-text" htmlFor="label-size">
                Размер этикетки, мм
              </label>
              <select
                id="label-size"
                value={sizeKey}
                onChange={(event) => setSizeKey(event.target.value)}
                className="select-field"
              >
                {LABEL_SIZES.map((size) => (
                  <option key={size.key} value={size.key}>
                    {size.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!ssccPrintMode ? (
            <>
              <InputField id="label-name" label="Наименование товара" value={name} onChange={setName} />
              <InputField id="label-article" label="Артикул" value={article} onChange={setArticle} />
              <InputField id="label-gtin" label="GTIN" value={gtin} onChange={setGtin} />
              <InputField id="label-product-size" label="Размер" value={productSize} onChange={setProductSize} />
            </>
          ) : (
            <div>
              <label className="label-text" htmlFor="label-kitu-code">
                КИТУ / SSCC
              </label>
              <input
                id="label-kitu-code"
                type="text"
                inputMode="numeric"
                value={activeKituCode}
                onChange={(event) =>
                  setActiveKituCode(event.target.value.replace(/\D/g, "").slice(0, 18))
                }
                placeholder="460000000123456789"
                className="input-field font-mono"
              />
              {!currentKituValid ? (
                <p className="mt-1 text-xs text-red-600">КИТУ должен быть 18 цифр</p>
              ) : null}
            </div>
          )}
          <div>
            <label className="label-text" htmlFor="label-copies">
              Количество копий
            </label>
            <input
              id="label-copies"
              type="number"
              min={1}
              max={10}
              value={copies}
              onChange={(e) => setCopies(Number(e.target.value))}
              className="input-field w-24"
            />
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={singleFile}
                onChange={(e) => setSingleFile(e.target.checked)}
                className="checkbox-field"
              />
              Одним файлом
            </label>
            {singleFile ? (
              <div>
                <label className="label-text" htmlFor="label-start-number">
                  Нумеровать начиная с
                </label>
                <input
                  id="label-start-number"
                  type="number"
                  min={1}
                  value={startNumber}
                  onChange={(e) => setStartNumber(Math.max(1, Number(e.target.value) || 1))}
                  className="input-field w-24"
                />
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={splitFiles}
                onChange={(e) => setSplitFiles(e.target.checked)}
                className="checkbox-field"
              />
              Разбивать файл на части
            </label>
            {splitFiles ? (
              <div className="space-y-2 rounded-lg border border-forest-100 bg-white/60 p-3">
                <div>
                  <label className="label-text" htmlFor="label-pages-per-file">
                    Страниц в файле
                  </label>
                  <input
                    id="label-pages-per-file"
                    type="number"
                    min={1}
                    value={pagesPerFile}
                    onChange={(e) => setPagesPerFile(Math.max(1, Number(e.target.value) || 1))}
                    className="input-field w-24"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={continuousNumbering}
                    onChange={(e) => setContinuousNumbering(e.target.checked)}
                    className="checkbox-field"
                  />
                  Сквозная нумерация
                </label>
              </div>
            ) : null}
          </div>

          {!ssccPrintMode ? (
          <fieldset className="space-y-3 rounded-lg border border-forest-100 bg-forest-50/40 p-3">
            <legend className="px-1 text-sm font-medium text-forest-900">Баркод</legend>
            <div>
              <label className="label-text" htmlFor="barcode-type">
                Тип штрихкода
              </label>
              <select
                id="barcode-type"
                value={barcodeType}
                onChange={(e) => setBarcodeType(e.target.value as BarcodePrintType)}
                className="select-field"
              >
                <option value="code128">Code128</option>
                <option value="ean13">EAN-13</option>
              </select>
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={barcodeFromExtra}
                  onChange={(e) => setBarcodeFromExtra(e.target.checked)}
                  className="checkbox-field"
                />
                Брать из доп. полей
              </label>
            </div>
            {barcodeFromExtra ? (
              <div>
                <label className="label-text" htmlFor="barcode-extra-field">
                  Доп. поле
                </label>
                <select
                  id="barcode-extra-field"
                  value={barcodeExtraFieldKey}
                  onChange={(e) => setBarcodeExtraFieldKey(e.target.value)}
                  className="select-field"
                  disabled={extraCatalogFields.length === 0}
                >
                  {extraCatalogFields.length === 0 ? (
                    <option value="">Нет доп. полей в каталоге</option>
                  ) : (
                    extraCatalogFields.map((field) => (
                      <option key={field.catalogKey} value={field.catalogKey}>
                        {field.label}
                      </option>
                    ))
                  )}
                </select>
              </div>
            ) : (
              <div>
                <label className="label-text" htmlFor="barcode-column">
                  Колонка
                </label>
                <select
                  id="barcode-column"
                  value={barcodeColumn}
                  onChange={(e) => setBarcodeColumn(e.target.value as BarcodeColumnSource)}
                  className="select-field"
                >
                  <option value="gtin">GTIN</option>
                  <option value="barcode">Баркод</option>
                </select>
              </div>
            )}
            <div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={barcodeKeepLeadingZero}
                  onChange={(e) => setBarcodeKeepLeadingZero(e.target.checked)}
                  className="checkbox-field"
                />
                Оставить ведущий 0
              </label>
              <p className="mt-1 text-xs text-slate-500">
                Для EAN-13: если выключено, GTIN-14 с ведущим 0 кодируется как 13 цифр без него.
              </p>
            </div>
          </fieldset>
          ) : (
            <p className="rounded-lg border border-forest-100 bg-forest-50/40 p-3 text-sm text-sage-600">
              Штрихкод: Code128 по коду КИТУ (источник <code className="text-xs">kitu_code</code>).
              Настройте макет в конструкторе — поле «SSCC / КИТУ».
            </p>
          )}

          {!ssccPrintMode ? (
          <div>
            <label className="label-text" htmlFor="label-marking-code">
              Код маркировки (СУЗ / УПД)
            </label>
            {codesLoadError ? (
              <p className="mb-1 text-xs text-amber-700">{codesLoadError}</p>
            ) : null}
            <input
              id="label-marking-code"
              type="text"
              value={markingCode}
              onChange={(event) => setMarkingCode(event.target.value)}
              list="suz-marking-code-options"
              placeholder={
                suzCodeOptions.length
                  ? "Выберите из списка или вставьте код"
                  : "Вставьте код или синхронизируйте заказы СУЗ"
              }
              className="input-field"
            />
            <datalist id="suz-marking-code-options">
              {suzCodeOptions.map((code) => (
                <option key={code} value={code} />
              ))}
            </datalist>
            {!currentCodeValid ? (
              <p className="mt-1 text-xs text-red-600">{CRYPTO_TAIL_MISSING_LABEL}</p>
            ) : null}
            {suzCodeOptions.length > 0 ? (
              <p className="mt-1 text-xs text-sage-500">
                Подсказки из заказов СУЗ (после «Подтянуть из СУЗ») и кодов из документов УПД.
              </p>
            ) : null}
          </div>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              className="btn-secondary"
              disabled={
                previewLoading ||
                (ssccPrintMode
                  ? !activeKituCode.trim() || !currentKituValid
                  : !markingCode.trim() || !currentCodeValid)
              }
              onClick={() => void loadPreview()}
            >
              <Eye size={16} />
              {previewLoading ? "Предпросмотр…" : "Предпросмотр"}
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={
                ssccPrintMode
                  ? !currentKituValid || !activeKituCode.trim()
                  : !currentCodeValid || !markingCode.trim()
              }
            >
              <Printer size={16} />
              {ssccPrintMode ? "Печать SSCC" : "Печать на принтере"}
            </button>
            {(ssccPrintMode ? ssccBatchCount > 1 : batchPrintCount > 1) ? (
              <button
                type="button"
                disabled={
                  isPrintingAll ||
                  (ssccPrintMode ? ssccBatchCount === 0 : batchPrintCount === 0)
                }
                onClick={() => void handlePrintAll()}
                className="btn-secondary"
              >
                <Printer size={16} />
                {isPrintingAll
                  ? "Печать…"
                  : ssccPrintMode
                    ? ssccBatchUsesSelection
                      ? `Печать выбранных (${ssccBatchCount})`
                      : `Печать всех (${ssccBatchCount})`
                    : batchPrintUsesSelection
                      ? `Печать выбранных (${batchPrintCount})`
                      : `Печать всех (${batchPrintCount})`}
              </button>
            ) : null}
          </div>
        </form>

        <section className="card-muted flex min-h-[400px] flex-col p-6 print:min-h-0 print:border-0 print:bg-white print:p-0">
          <div className="mb-3 flex items-center justify-between gap-2 print:hidden">
            <h2 className="text-sm font-semibold text-forest-900">Предпросмотр</h2>
            {previewLoading ? (
              <span className="text-xs text-slate-500">Обновление…</span>
            ) : null}
          </div>
          <div className="flex flex-1 items-center justify-center">
            {previewUrl ? (
              <div
                className="print-area overflow-hidden rounded-xl border border-forest-100 bg-white shadow-soft print:rounded-none print:border-0 print:shadow-none"
                style={{
                  width: `${previewWidth}px`,
                  height: `${previewHeight}px`,
                }}
              >
                <iframe
                  src={previewUrl}
                  title="Предпросмотр этикетки"
                  className="h-full w-full border-0"
                />
              </div>
            ) : (
              <div className="max-w-sm text-center text-sm text-slate-500 print:hidden">
                {previewError ?? "Загрузка предпросмотра…"}
              </div>
            )}
          </div>
          {previewError && previewUrl ? (
            <p className="mt-2 text-center text-xs text-red-600 print:hidden">{previewError}</p>
          ) : null}
        </section>
      </div>

      <section className="card mt-6 p-5 print:hidden">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-forest-900">Ранее созданные .pdf</h2>
          <button
            type="button"
            onClick={() => void loadPdfFiles()}
            disabled={pdfFilesLoading}
            className="btn-sm btn-secondary"
            title="Обновить список"
          >
            <RefreshCw size={14} className={pdfFilesLoading ? "animate-spin" : undefined} />
            Обновить
          </button>
        </div>

        {pdfFilesError ? (
          <p className="text-sm text-red-600">{pdfFilesError}</p>
        ) : pdfFilesLoading && pdfFiles.length === 0 ? (
          <p className="text-sm text-slate-500">Загрузка…</p>
        ) : pdfFiles.length === 0 ? (
          <p className="text-sm text-slate-500">Список пуст</p>
        ) : (
          <ul className="divide-y divide-forest-100">
            {pdfFiles.map((file) => (
              <li key={file.id}>
                <button
                  type="button"
                  onClick={() => void downloadLabelPdfFile(file)}
                  className="flex w-full items-center justify-between gap-4 py-3 text-left hover:bg-forest-50/60"
                >
                  <span className="truncate font-mono text-sm text-forest-900">{file.filename}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {formatPdfFileDate(file.created_at)} · {file.codes_count} шт.
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type InputFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (nextValue: string) => void;
};

function InputField({ id, label, value, onChange }: InputFieldProps) {
  return (
    <div>
      <label className="label-text" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="input-field"
      />
    </div>
  );
}
