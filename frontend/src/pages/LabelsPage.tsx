import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../components/ui/PageHeader";
import Alert from "../components/ui/Alert";
import bwipjs from "bwip-js";
import { Printer } from "lucide-react";
import apiClient from "../api/client";

type LabelTemplateOption = {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
  is_default: boolean;
};

type LabelSizeKey = "58x40" | "43x25";

type LabelSize = {
  key: LabelSizeKey;
  title: string;
  widthMm: number;
  heightMm: number;
};

const LABEL_SIZES: LabelSize[] = [
  { key: "58x40", title: "Стандарт 58х40", widthMm: 58, heightMm: 40 },
  { key: "43x25", title: "Малая 43х25", widthMm: 43, heightMm: 25 },
];

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
  const [sizeKey, setSizeKey] = useState<LabelSizeKey>("58x40");
  const [name, setName] = useState("");
  const [article, setArticle] = useState("");
  const [gtin, setGtin] = useState("");
  const [productSize, setProductSize] = useState("");
  const [markingCode, setMarkingCode] = useState("");
  const [printQueue, setPrintQueue] = useState<string[]>([]);
  const [suzCodeOptions, setSuzCodeOptions] = useState<string[]>([]);
  const [codesLoadError, setCodesLoadError] = useState<string | null>(null);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
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
      if (codes.length > 0) setMarkingCode(codes[0]);
      setPrintQueue(codes);
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
    const match = markingCode.match(/^01(\d{14})/);
    if (!match) return;
    const extractedGtin = match[1];
    setGtin(extractedGtin);

    let cancelled = false;

    apiClient
      .get(`/extra-fields/?gtin=${encodeURIComponent(extractedGtin)}`)
      .then((res) => {
        if (cancelled) return;
        const extraItems = res.data.items ?? [];
        if (extraItems.length > 0) {
          const fields = extraItems[0];
          if (fields.name) setName(fields.name);
          if (fields.article) setArticle(fields.article);
          if (fields.size) setProductSize(fields.size);
        }
      })
      .catch(() => {});

    apiClient
      .get(`/product-cards/?gtin=${encodeURIComponent(extractedGtin)}`)
      .then((res) => {
        if (cancelled) return;
        const cards = Array.isArray(res.data) ? res.data : (res.data as { items?: { name?: string }[] }).items ?? [];
        if (cards.length > 0) {
          const card = cards[0];
          if (card.name) setName(card.name);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("Карточка не найдена:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [markingCode]);

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

  async function handlePrint(event: FormEvent) {
    event.preventDefault();

    try {
      await printLabelPdf({
        codes: [markingCode],
        widthMm: selectedSize.widthMm,
        heightMm: selectedSize.heightMm,
        copies,
        templateId: selectedTemplateId || undefined,
      });
    } catch (err) {
      console.error("Ошибка генерации PDF:", err);
    }
  }

  async function handlePrintAll() {
    if (printQueue.length <= 1) return;

    setIsPrintingAll(true);
    try {
      await printLabelPdf({
        codes: printQueue,
        widthMm: selectedSize.widthMm,
        heightMm: selectedSize.heightMm,
        copies,
        templateId: selectedTemplateId || undefined,
      });
    } catch (err) {
      console.error("Ошибка генерации PDF:", err);
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
        </Alert>
      )}

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
                Размер этикетки
              </label>
              <select
                id="label-size"
                value={sizeKey}
                onChange={(event) => setSizeKey(event.target.value as LabelSizeKey)}
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
            {suzCodeOptions.length > 0 ? (
              <p className="mt-1 text-xs text-sage-500">
                Подсказки из заказов СУЗ (после «Подтянуть из СУЗ») и кодов из документов УПД.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="submit" className="btn-primary">
              <Printer size={16} />
              Печать на принтере
            </button>
            {printQueue.length > 1 ? (
              <button
                type="button"
                disabled={isPrintingAll}
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
