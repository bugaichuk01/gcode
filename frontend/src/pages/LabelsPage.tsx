import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import PageHeader from "../components/ui/PageHeader";
import Alert from "../components/ui/Alert";
import bwipjs from "bwip-js";
import { Printer, RefreshCw } from "lucide-react";
import apiClient from "../api/client";
import { useCisStatusCheck } from "../hooks/useCisStatusCheck";
import {
  CIS_STATUS_LABELS,
  type CisStatusRowFields,
  formatCisStatusLabel,
} from "../utils/cisStatus";
import { fetchGtinProductFields, fetchGtinProductFieldsMap } from "../utils/gtinProductFields";
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

type PrintCodeRow = {
  code: string;
  gtin: string;
  name: string;
  article: string;
  productSize: string;
  status: string;
};

function createPrintCodeRow(code: string): PrintCodeRow {
  const gtinMatch = code.match(/^01(\d{14})/);
  return {
    code,
    gtin: gtinMatch?.[1] ?? "",
    name: "",
    article: "",
    productSize: "",
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
  productMap: Record<string, { name: string; article: string; size: string }>,
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
    };
  });
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

function generateDataMatrix(canvas: HTMLCanvasElement, code: string): void {
  bwipjs.toCanvas(canvas, {
    bcid: "datamatrix",
    text: code,
    scale: 3,
    paddingwidth: 2,
    paddingheight: 2,
  });
}

function clearCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  canvas.width = 0;
  canvas.height = 0;
}

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

async function printLabelPdf(params: {
  codes: string[];
  widthMm: number;
  heightMm: number;
  copies: number;
  templateId?: string;
}): Promise<void> {
  const response = params.templateId
    ? await apiClient.post(
        "/labels/pdf/from-template",
        {
          template_id: params.templateId,
          codes: params.codes,
          copies: params.copies,
        },
        { responseType: "blob" },
      )
    : await apiClient.post(
        "/labels/pdf/batch",
        {
          codes: params.codes,
          width_mm: params.widthMm,
          height_mm: params.heightMm,
          copies: params.copies,
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
}

export default function LabelsPage() {
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
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [printNotice, setPrintNotice] = useState<string | null>(null);
  const [isPrintingAll, setIsPrintingAll] = useState(false);
  const [copies, setCopies] = useState(1);
  const [templates, setTemplates] = useState<LabelTemplateOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    apiClient
      .get<LabelTemplateOption[]>("/labels/templates")
      .then((r) => setTemplates(r.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const code = markingCode.trim();
    if (!code) {
      clearCanvas(canvas);
      setBarcodeError("Введите код маркировки для генерации DataMatrix.");
      return;
    }

    try {
      generateDataMatrix(canvas, code);
      setBarcodeError(null);
    } catch (error) {
      console.error("Ошибка генерации DataMatrix:", error);
      clearCanvas(canvas);
      setBarcodeError("Не удалось сгенерировать DataMatrix. Проверьте корректность кода.");
    }
  }, [markingCode]);

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
  const invalidQueueCount = queueWithValidity.filter((item) => !item.valid).length;

  function prepareCodesForPrint(codes: string[]): string[] | null {    const { printable, rejected } = filterPrintableCodes(codes);
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
      await printLabelPdf({
        codes: [code],
        widthMm: selectedSize.widthMm,
        heightMm: selectedSize.heightMm,
        copies,
        templateId: selectedTemplateId || undefined,
      });
    } catch (err) {
      console.error("Ошибка генерации PDF:", err);
      setPrintError(await parseLabelApiError(err));
    }
  }

  async function handlePrintAll() {
    if (printQueue.length <= 1) return;

    setIsPrintingAll(true);
    setPrintError(null);
    const printable = prepareCodesForPrint(printQueue.map((row) => row.code));
    if (!printable) {
      setIsPrintingAll(false);
      return;
    }

    try {
      await printLabelPdf({
        codes: printable,
        widthMm: selectedSize.widthMm,
        heightMm: selectedSize.heightMm,
        copies,
        templateId: selectedTemplateId || undefined,
      });
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
        description="Настройте шаблон, проверьте предпросмотр и отправьте этикетку в печать."
        compact
      />

      {printQueue.length > 1 && (
        <Alert variant="warning" className="mb-6 print:hidden">
          В очереди печати: {printQueue.length} кодов
          {invalidQueueCount > 0
            ? ` (${invalidQueueCount} без криптохвоста — будут исключены при печати)`
            : ""}
        </Alert>
      )}

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

      {showStatusRefreshWarning ? (
        <Alert variant="warning" className="mb-4 print:hidden">
          Обновите статус кодов перед печатью — без этого поля товара, GTIN и статус ЧЗ могут быть пустыми.
        </Alert>
      ) : null}

      {printQueue.length > 0 ? (
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

      {printQueue.length > 0 ? (
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

          <InputField id="label-name" label="Наименование товара" value={name} onChange={setName} />
          <InputField id="label-article" label="Артикул" value={article} onChange={setArticle} />
          <InputField id="label-gtin" label="GTIN" value={gtin} onChange={setGtin} />
          <InputField id="label-product-size" label="Размер" value={productSize} onChange={setProductSize} />
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

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="submit"
              className="btn-primary"
              disabled={!currentCodeValid || !markingCode.trim()}
            >
              <Printer size={16} />
              Печать на принтере
            </button>
            {printQueue.length > 1 ? (
              <button
                type="button"
                disabled={isPrintingAll || invalidQueueCount === printQueue.length}
                onClick={() => void handlePrintAll()}
                className="btn-secondary"
              >
                <Printer size={16} />
                {isPrintingAll ? "Печать…" : `Печать всех (${printQueue.length})`}
              </button>
            ) : null}
          </div>
        </form>

        <section className="card-muted flex min-h-[400px] items-center justify-center p-8 print:min-h-0 print:border-0 print:bg-white print:p-0">
          <div
            className="print-area overflow-hidden rounded-xl border border-forest-100 bg-white text-forest-950 shadow-soft print:rounded-none print:border-0 print:shadow-none"
            style={{
              width: `${previewWidth}px`,
              height: `${previewHeight}px`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              padding: "8px",
              boxSizing: "border-box",
            }}
          >
            <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-between text-[10px] leading-tight">
              <div>
                <div className="label-name line-clamp-3 font-semibold text-xs">
                  {name || "Наименование товара"}
                </div>
                <div className="label-detail mt-1 text-slate-500">Арт: {article || "-"}</div>
              </div>
              <div className="mt-1 space-y-0.5">
                <div className="label-detail break-all text-slate-500">GTIN: {gtin || "-"}</div>
                <div className="label-detail break-words text-slate-500">Размер: {productSize || "-"}</div>
              </div>
            </div>
            <div className="relative flex shrink-0 items-center justify-center">
              <canvas
                ref={canvasRef}
                className="max-h-full max-w-full object-contain"
                aria-label="DataMatrix preview"
              />
              {barcodeError ? (
                <p className="pointer-events-none absolute inset-x-0 bottom-0 text-center text-[9px] leading-snug text-red-600 print:hidden">
                  {barcodeError}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      </div>
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
