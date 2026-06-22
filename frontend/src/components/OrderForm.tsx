import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  RELEASE_METHOD_LABELS,
  releaseMethodOptionsForGtin,
  validateGtin14,
  normalizeGtin14,
} from "../services/suzGtinRules";

export type OrderFormValues = {
  gtin: string;
  quantity: number;
  releaseMethodType: string;
  producer: string;
};

type OrderFormProps = {
  initialGtin?: string;
  initialQuantity?: number;
  submitLabel?: string;
  disabled?: boolean;
  isSubmitting?: boolean;
  onSubmit: (values: OrderFormValues) => void | Promise<void>;
};

export default function OrderForm({
  initialGtin = "",
  initialQuantity = 1,
  submitLabel = "Создать заказ",
  disabled = false,
  isSubmitting = false,
  onSubmit,
}: OrderFormProps) {
  const [gtin, setGtin] = useState(initialGtin);
  const [quantity, setQuantity] = useState(String(initialQuantity));
  const [releaseMethodType, setReleaseMethodType] = useState("REMARK");
  const [producer, setProducer] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const gtin14 = useMemo(() => normalizeGtin14(gtin) ?? "", [gtin]);

  const { allowed, defaultMethod } = useMemo(() => {
    if (gtin14.length !== 14) {
      return { allowed: [] as string[], defaultMethod: "REMARK" };
    }
    const opts = releaseMethodOptionsForGtin(gtin14);
    return { allowed: opts.allowed as string[], defaultMethod: opts.defaultMethod };
  }, [gtin14]);

  useEffect(() => {
    if (gtin14.length === 14 && !allowed.includes(releaseMethodType)) {
      setReleaseMethodType(defaultMethod);
    }
  }, [gtin14, allowed, defaultMethod, releaseMethodType]);

  const is029RemarkOnly = gtin14.startsWith("029");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const gtinError = validateGtin14(gtin);
    const parsedQty = Number(quantity);
    if (gtinError) {
      setValidationError(gtinError);
      return;
    }
    if (Number.isNaN(parsedQty) || parsedQty <= 0) {
      setValidationError("Количество должно быть больше 0.");
      return;
    }
    if (!allowed.includes(releaseMethodType)) {
      setValidationError(
        is029RemarkOnly
          ? "Для GTIN технического диапазона (029…) допустима только перемаркировка (REMARK)."
          : "Выберите допустимый способ выпуска для этого GTIN.",
      );
      return;
    }
    setValidationError(null);
    void onSubmit({
      gtin: gtin14,
      quantity: parsedQty,
      releaseMethodType,
      producer: producer.trim(),
    });
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        GTIN (14 цифр)
        <input
          type="text"
          inputMode="numeric"
          required
          minLength={8}
          maxLength={14}
          value={gtin}
          onChange={(event) => setGtin(event.target.value.replace(/\D/g, ""))}
          className="rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none ring-blue-500 transition focus:ring-2"
        />
        {is029RemarkOnly ? (
          <span className="text-xs text-amber-800">
            Технический диапазон 029… — только REMARK; серийные номера не передаются, СУЗ сгенерирует сама.
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Количество
        <input
          type="number"
          min={1}
          required
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 outline-none ring-blue-500 transition focus:ring-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Способ выпуска (releaseMethodType)
        <select
          value={releaseMethodType}
          onChange={(event) => setReleaseMethodType(event.target.value)}
          disabled={allowed.length <= 1}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none ring-blue-500 transition focus:ring-2 disabled:bg-slate-50"
        >
          {allowed.map((method) => (
            <option key={method} value={method}>
              {RELEASE_METHOD_LABELS[method] ?? method}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-700">
        ИНН владельца карточки (producer)
        <input
          type="text"
          inputMode="numeric"
          placeholder="Только если карточка не ваша"
          value={producer}
          onChange={(event) => setProducer(event.target.value.replace(/\D/g, ""))}
          className="rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none ring-blue-500 transition focus:ring-2"
        />
        <span className="text-xs text-slate-500">
          При REMARK на чужой карточке без суббаккаунта — укажите ИНН владельца; серийники не передавайте.
        </span>
      </label>

      {validationError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {validationError}
        </p>
      ) : null}

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={disabled || isSubmitting}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Отправка…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
