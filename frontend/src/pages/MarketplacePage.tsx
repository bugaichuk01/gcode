import { useEffect, useState } from "react";
import apiClient from "../api/client";
import { useProductGroups } from "../hooks/useProductGroups";

interface SaleItem {
  marking_code: string;
  price: number;
  sale_date: string;
  order_id: string;
  article: string;
  product_name: string;
  selected: boolean;
}

interface SalesResponse {
  marketplace: string;
  sales: SaleItem[];
  total: number;
  period: string;
}

type Tab = "wb" | "ozon";

const MARKETPLACE_CONFIG = {
  wb: {
    label: "Wildberries",
    color: "text-purple-600",
    bg: "bg-purple-50",
    border: "border-purple-200",
    activeBg: "bg-purple-600",
    logo: "🟣",
  },
  ozon: {
    label: "Ozon",
    color: "text-blue-600",
    bg: "bg-blue-50",
    border: "border-blue-200",
    activeBg: "bg-blue-600",
    logo: "🔵",
  },
};

export default function MarketplacePage() {
  const { groups: productGroups } = useProductGroups();
  const [tab, setTab] = useState<Tab>("wb");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(() =>
    new Date().toISOString().split("T")[0],
  );
  const [productGroup, setProductGroup] = useState("perfumery");
  const [sales, setSales] = useState<SaleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState<Record<
    Tab,
    { connected: boolean; label: string; description: string }
  > | null>(null);

  useEffect(() => {
    apiClient
      .get("/marketplace/status")
      .then((r) => setStatus(r.data))
      .catch(() => {});
  }, []);

  async function handleLoad() {
    setLoading(true);
    setError(null);
    setSales([]);
    setSuccess(null);
    try {
      const endpoint =
        tab === "wb" ? "/marketplace/wb/sales" : "/marketplace/ozon/sales";
      const res = await apiClient.post<SalesResponse>(endpoint, {
        date_from: dateFrom,
        date_to: dateTo,
        product_group: productGroup,
      });
      setSales(res.data.sales);
      setPeriod(res.data.period);
    } catch (err: unknown) {
      const detail =
        err &&
        typeof err === "object" &&
        "response" in err &&
        (err as { response?: { data?: { detail?: string } } }).response?.data
          ?.detail;
      setError(
        typeof detail === "string" ? detail : "Ошибка загрузки продаж",
      );
    } finally {
      setLoading(false);
    }
  }

  function toggleSale(idx: number) {
    setSales((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, selected: !s.selected } : s)),
    );
  }

  function toggleAll() {
    const allSelected = sales.every((s) => s.selected);
    setSales((prev) => prev.map((s) => ({ ...s, selected: !allSelected })));
  }

  async function handleCreateWithdrawal() {
    const selected = sales.filter((s) => s.selected);
    if (selected.length === 0) {
      setError("Выберите хотя бы один код для вывода");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await apiClient.post<{
        codes_count: number;
        withdrawal_id: string;
      }>("/marketplace/create-withdrawal", {
        marketplace: tab,
        marking_codes: selected.map((s) => s.marking_code),
        prices: selected.map((s) => s.price),
        product_group: productGroup,
        date_from: dateFrom,
        date_to: dateTo,
      });
      setSuccess(
        `✅ Создан черновик вывода ${res.data.codes_count} кодов (ID: ${res.data.withdrawal_id.slice(0, 8)}...). ` +
          "Перейдите в раздел «Операции → Вывод из оборота» для подписи и отправки.",
      );
      setSales([]);
    } catch (err: unknown) {
      const detail =
        err &&
        typeof err === "object" &&
        "response" in err &&
        (err as { response?: { data?: { detail?: string } } }).response?.data
          ?.detail;
      setError(
        typeof detail === "string" ? detail : "Ошибка создания вывода",
      );
    } finally {
      setCreating(false);
    }
  }

  const selectedCount = sales.filter((s) => s.selected).length;
  const cfg = MARKETPLACE_CONFIG[tab];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Маркетплейсы</h1>
        <p className="text-sm text-slate-500 mt-1">
          Вывод из оборота при продажах через Wildberries и Ozon FBS
        </p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex justify-between">
          {error}
          <button type="button" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}
      {success && (
        <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700 flex justify-between">
          {success}
          <button type="button" onClick={() => setSuccess(null)}>
            ✕
          </button>
        </div>
      )}

      {status && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {(["wb", "ozon"] as Tab[]).map((mp) => {
            const s = status[mp];
            const c = MARKETPLACE_CONFIG[mp];
            return (
              <div
                key={mp}
                className={`rounded-xl border p-4 ${
                  s.connected
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-slate-200 bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{c.logo}</span>
                    <span className="font-medium text-sm">{s.label}</span>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      s.connected
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {s.connected ? "Подключён" : "Не настроен"}
                  </span>
                </div>
                {!s.connected && (
                  <p className="text-xs text-slate-400 mt-2">
                    Добавьте API ключ в настройках организации
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-2 mb-6">
        {(["wb", "ozon"] as Tab[]).map((mp) => {
          const c = MARKETPLACE_CONFIG[mp];
          return (
            <button
              key={mp}
              type="button"
              onClick={() => {
                setTab(mp);
                setSales([]);
                setSuccess(null);
              }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-colors ${
                tab === mp
                  ? `${c.activeBg} text-white`
                  : "border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {c.logo} {c.label}
            </button>
          );
        })}
      </div>

      <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-5 mb-6`}>
        <h3 className={`font-semibold text-sm mb-4 ${cfg.color}`}>
          Загрузить продажи {cfg.label}
        </h3>
        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Дата от</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Дата до</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">
              Товарная группа
            </label>
            <select
              value={productGroup}
              onChange={(e) => setProductGroup(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            >
              {productGroups.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void handleLoad()}
              disabled={loading}
              className={`w-full py-2 rounded-lg text-sm text-white font-medium disabled:opacity-50 ${
                tab === "wb"
                  ? "bg-purple-600 hover:bg-purple-700"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {loading ? "Загрузка..." : "Загрузить продажи"}
            </button>
          </div>
        </div>

        <div className="mt-3 px-3 py-2 bg-white/70 rounded text-xs text-slate-500">
          ℹ️ Сейчас используются демо-данные.
          {tab === "wb"
            ? " Для реальных данных добавьте Statistics API ключ Wildberries в настройках организации."
            : " Для реальных данных добавьте Client-Id и Api-Key Ozon в настройках организации."}
        </div>
      </div>

      {sales.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-slate-700">
                Продажи за {period} — найдено {sales.length}
              </span>
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs text-blue-600 hover:underline"
              >
                {sales.every((s) => s.selected) ? "Снять всё" : "Выбрать всё"}
              </button>
            </div>
            <span className="text-sm text-slate-500">
              Выбрано: <strong>{selectedCount}</strong>
            </span>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="w-10 px-4 py-2" />
                <th className="px-4 py-2 text-left font-medium text-slate-600">
                  Код маркировки
                </th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">
                  Артикул
                </th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">
                  Заказ
                </th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">
                  Дата
                </th>
                <th className="px-4 py-2 text-right font-medium text-slate-600">
                  Цена
                </th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale, idx) => (
                <tr
                  key={sale.order_id + sale.marking_code}
                  className={`border-b border-slate-100 cursor-pointer ${
                    sale.selected ? "bg-blue-50/30" : "hover:bg-slate-50"
                  }`}
                  onClick={() => toggleSale(idx)}
                >
                  <td className="px-4 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={sale.selected}
                      onChange={() => toggleSale(idx)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4"
                    />
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-600">
                    {sale.marking_code.slice(0, 30)}...
                  </td>
                  <td className="px-4 py-2 text-xs">{sale.article || "—"}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {sale.order_id}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {sale.sale_date}
                  </td>
                  <td className="px-4 py-2 text-right text-sm font-medium">
                    {sale.price.toLocaleString("ru-RU")} ₽
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between bg-slate-50">
            <div className="text-sm text-slate-600">
              Итого к выводу: <strong>{selectedCount}</strong> кодов на сумму{" "}
              <strong>
                {sales
                  .filter((s) => s.selected)
                  .reduce((sum, s) => sum + s.price, 0)
                  .toLocaleString("ru-RU")}{" "}
                ₽
              </strong>
            </div>
            <button
              type="button"
              onClick={() => void handleCreateWithdrawal()}
              disabled={creating || selectedCount === 0}
              className={`px-6 py-2 rounded-lg text-sm text-white font-medium disabled:opacity-50 ${
                tab === "wb"
                  ? "bg-purple-600 hover:bg-purple-700"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {creating
                ? "Создание..."
                : `Создать вывод из оборота (${selectedCount})`}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-semibold text-slate-700 mb-3">Как это работает</h3>
        <div className="space-y-2">
          {[
            {
              n: 1,
              text:
                tab === "wb"
                  ? "WB FBS: продавец обязан вывести КМ из оборота в течение 3 дней с момента продажи"
                  : "Ozon FBS: продавец выводит КМ из оборота в течение 30 дней. При FBO — Ozon делает это автоматически",
            },
            {
              n: 2,
              text: "Выберите период и загрузите список продаж с кодами маркировки",
            },
            {
              n: 3,
              text: "Отметьте коды которые нужно вывести (обычно все проданные)",
            },
            {
              n: 4,
              text: "Нажмите «Создать вывод из оборота» — создастся черновик с причиной DISTANCE_SOLD",
            },
            {
              n: 5,
              text: "Перейдите в «Операции → Вывод из оборота» и подпишите документ УКЭП",
            },
          ].map((step) => (
            <div key={step.n} className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                {step.n}
              </span>
              <p className="text-sm text-slate-600">{step.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
