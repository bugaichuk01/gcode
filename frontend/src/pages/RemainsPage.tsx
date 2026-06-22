import { useState } from "react";
import { Link } from "react-router-dom";
import apiClient from "../api/client";
import PageHeader from "../components/ui/PageHeader";
import Alert from "../components/ui/Alert";
import { signBodyBase64 } from "../services/signingService";
import { useProductGroups } from "../hooks/useProductGroups";

const PREP_STEPS = [
  "Создать карточку товара в Национальном каталоге (если нет)",
  "Заказать коды маркировки с типом «Маркировка остатков» (REMAINS) в разделе «Заказы»",
  "Скачать коды маркировки",
  "Распечатать и наклеить этикетки на товар",
  "Вернуться сюда и ввести скачанные коды в оборот",
];

export default function RemainsPage() {
  const { groups: productGroups } = useProductGroups();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [productGroup, setProductGroup] = useState("perfumery");
  const [codesText, setCodesText] = useState("");
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const codes = codesText
    .split("\n")
    .map((code) => code.trim())
    .filter(Boolean);

  async function handleSign() {
    if (codes.length === 0) {
      setError("Введите коды маркировки");
      return;
    }

    setSigning(true);
    setError(null);
    try {
      const bodyRes = await apiClient.post<{ body: string; body_b64: string }>(
        "/emission-orders/introduce-ost-body",
        {
          marking_codes: codes,
          product_group: productGroup,
        },
      );
      const { body_b64 } = bodyRes.data;
      const signature = await signBodyBase64(body_b64);

      await apiClient.post("/emission-orders/introduce-ost", {
        marking_codes: codes,
        product_group: productGroup,
        signature,
      });

      setSuccess(
        `LP_INTRODUCE_OST отправлен! ${codes.length} кодов введены в оборот как остатки.`,
      );
      setStep(3);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : err && typeof err === "object" && "response" in err
            ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
            : undefined;
      setError(message || "Ошибка");
    } finally {
      setSigning(false);
    }
  }

  return (
    <div className="page-container max-w-3xl">
      <PageHeader
        title="Маркировка остатков"
        description="Ввод в оборот товаров, купленных до введения обязательной маркировки"
      />

      {error ? (
        <Alert variant="error" onDismiss={() => setError(null)} className="mb-6">
          {error}
        </Alert>
      ) : null}

      <div className="mb-8 flex flex-wrap items-center gap-4">
        {([1, 2, 3] as const).map((stepNumber) => (
          <div key={stepNumber} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                step >= stepNumber
                  ? "bg-forest-600 text-white"
                  : "bg-sage-200 text-sage-500"
              }`}
            >
              {stepNumber}
            </div>
            <span
              className={`text-sm ${
                step >= stepNumber ? "font-medium text-sage-700" : "text-sage-400"
              }`}
            >
              {stepNumber === 1
                ? "Подготовка"
                : stepNumber === 2
                  ? "Ввод в оборот"
                  : "Готово"}
            </span>
            {stepNumber < 3 ? <div className="hidden h-px w-8 bg-sage-200 sm:block" /> : null}
          </div>
        ))}
      </div>

      {step === 1 ? (
        <div className="card-panel space-y-4 p-6">
          <h2 className="font-semibold text-forest-950">Что нужно сделать перед этим:</h2>
          <div className="space-y-3">
            {PREP_STEPS.map((prepStep, index) => (
              <div key={prepStep} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-forest-100 text-xs font-bold text-forest-600">
                  {index + 1}
                </span>
                <p className="text-sm text-sage-600">{prepStep}</p>
              </div>
            ))}
          </div>
          <div className="pt-2">
            <button type="button" onClick={() => setStep(2)} className="btn-primary">
              Продолжить →
            </button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="card-panel space-y-4 p-6">
          <h2 className="font-semibold text-forest-950">Ввод остатков в оборот</h2>

          <label className="flex flex-col gap-1.5">
            <span className="label-text">Товарная группа</span>
            <select
              value={productGroup}
              onChange={(event) => setProductGroup(event.target.value)}
              className="select-field"
            >
              {productGroups.map((group) => (
                <option key={group.value} value={group.value}>
                  {group.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="label-text">Коды маркировки (по одному на строку)</span>
            <textarea
              value={codesText}
              onChange={(event) => setCodesText(event.target.value)}
              rows={8}
              className="input-field font-mono text-xs"
              placeholder="010290000406494821..."
            />
            <span className="text-xs text-sage-400">Кодов: {codes.length}</span>
          </label>

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Документ LP_INTRODUCE_OST будет подписан вашей УКЭП через КриптоПро. Убедитесь, что
            коды уже нанесены на товар перед отправкой.
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={() => setStep(1)} className="btn-secondary">
              ← Назад
            </button>
            <button
              type="button"
              onClick={() => void handleSign()}
              disabled={signing || codes.length === 0}
              className="btn-primary"
            >
              {signing
                ? "Подписание и отправка..."
                : `Подписать и ввести в оборот (${codes.length})`}
            </button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="card-panel border-emerald-200 p-8 text-center">
          <div className="mb-4 text-5xl">✅</div>
          <h2 className="mb-2 text-xl font-bold text-emerald-700">Остатки введены в оборот!</h2>
          <p className="mb-6 text-sm text-sage-500">{success}</p>
          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                setStep(1);
                setCodesText("");
                setSuccess(null);
              }}
              className="btn-secondary"
            >
              Ввести ещё
            </button>
            <Link to="/operations" className="btn-primary">
              Реестр КМ →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
