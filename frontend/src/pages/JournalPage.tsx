import { useEffect, useState } from "react";
import apiClient from "../api/client";

interface JournalEntry {
  id: string;
  operation_type: string;
  status: "success" | "error" | "pending";
  description: string | null;
  related_id: string | null;
  codes_count: number | null;
  gtin: string | null;
  error_message: string | null;
  created_at: string;
}

interface JournalResponse {
  items: JournalEntry[];
  total: number;
  limit: number;
  offset: number;
}

const TYPE_LABELS: Record<string, string> = {
  order_created: "Создан заказ СУЗ",
  order_sent: "Заказ отправлен",
  codes_downloaded: "КМ скачаны",
  order_closed: "Заказ закрыт",
  utilisation_sent: "Ввод в оборот",
  withdrawal_sent: "Вывод из оборота",
  aggregation_sent: "Агрегация КИТУ",
  return_sent: "Возврат в оборот",
  upd_created: "УПД создан",
  upd_sent: "УПД отправлен",
  cis_checked: "Проверка статуса КМ",
  label_printed: "Печать этикеток",
  card_created: "Карточка НК создана",
  token_updated: "Токен обновлён",
};

const TYPE_ICONS: Record<string, string> = {
  order_created: "📋",
  order_sent: "📤",
  codes_downloaded: "⬇️",
  order_closed: "✅",
  utilisation_sent: "🔄",
  withdrawal_sent: "📦",
  aggregation_sent: "📫",
  return_sent: "↩️",
  upd_created: "📄",
  upd_sent: "📨",
  cis_checked: "🔍",
  label_printed: "🖨️",
  card_created: "🗂️",
  token_updated: "🔑",
};

const STATUS_CONFIG = {
  success: { label: "Успешно", color: "bg-emerald-100 text-emerald-700" },
  error: { label: "Ошибка", color: "bg-red-100 text-red-700" },
  pending: { label: "В обработке", color: "bg-amber-100 text-amber-700" },
};

const OPERATION_TYPES = Object.entries(TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterGtin, setFilterGtin] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const [stats, setStats] = useState<Record<string, { success?: number; error?: number; pending?: number }>>({});

  async function loadJournal() {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        limit: String(limit),
        offset: String(offset),
      };
      if (search) params.search = search;
      if (filterType) params.operation_type = filterType;
      if (filterStatus) params.status = filterStatus;
      if (filterGtin) params.gtin = filterGtin;
      if (dateFrom) params.date_from = new Date(dateFrom).toISOString();
      if (dateTo) params.date_to = new Date(dateTo + "T23:59:59").toISOString();

      const res = await apiClient.get<JournalResponse>("/journal/", { params });
      setEntries(res.data.items);
      setTotal(res.data.total);
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    const res = await apiClient.get<{ stats: typeof stats }>("/journal/stats");
    setStats(res.data.stats || {});
  }

  useEffect(() => {
    loadJournal();
  }, [offset, filterType, filterStatus]);

  useEffect(() => {
    loadStats();
  }, []);

  async function handleSearch() {
    setOffset(0);
    loadJournal();
  }

  async function handleExport() {
    setExporting(true);
    try {
      const params: Record<string, string> = {};
      if (filterType) params.operation_type = filterType;
      if (filterStatus) params.status = filterStatus;
      if (filterGtin) params.gtin = filterGtin;
      if (dateFrom) params.date_from = new Date(dateFrom).toISOString();
      if (dateTo) params.date_to = new Date(dateTo + "T23:59:59").toISOString();

      const res = await apiClient.get("/journal/export-excel", {
        params,
        responseType: "blob",
      });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `journal_${new Date().toISOString().split("T")[0]}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Журнал операций</h1>
          <p className="text-sm text-slate-500 mt-1">
            История всех операций с кодами маркировки
          </p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm disabled:opacity-50 flex items-center gap-2"
        >
          {exporting ? "Экспорт..." : "⬇ Скачать Excel"}
        </button>
      </div>

      {Object.keys(stats).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { type: "withdrawal_sent", label: "Выводов из оборота", color: "text-red-600" },
            { type: "codes_downloaded", label: "Скачиваний КМ", color: "text-blue-600" },
            { type: "utilisation_sent", label: "Вводов в оборот", color: "text-emerald-600" },
            { type: "label_printed", label: "Печатей этикеток", color: "text-purple-600" },
          ].map(({ type, label, color }) => (
            <div key={type} className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">{label} (30 дней)</p>
              <p className={`text-2xl font-bold mt-1 ${color}`}>
                {(stats[type]?.success || 0) + (stats[type]?.error || 0)}
              </p>
              {(stats[type]?.error ?? 0) > 0 && (
                <p className="text-xs text-red-500 mt-1">
                  Ошибок: {stats[type]?.error}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <input
            type="text"
            placeholder="Поиск по описанию, GTIN, ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
          <input
            type="text"
            placeholder="Фильтр по GTIN"
            value={filterGtin}
            onChange={(e) => setFilterGtin(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
          <button
            type="button"
            onClick={handleSearch}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            Найти
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <select
            value={filterType}
            onChange={(e) => {
              setFilterType(e.target.value);
              setOffset(0);
            }}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
          >
            <option value="">Все операции</option>
            {OPERATION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value);
              setOffset(0);
            }}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
          >
            <option value="">Все статусы</option>
            <option value="success">Успешно</option>
            <option value="error">Ошибка</option>
            <option value="pending">В обработке</option>
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            aria-label="Дата от"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            aria-label="Дата до"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <p className="text-sm text-slate-500">
            Всего: <strong>{total}</strong> записей
          </p>
          {totalPages > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <button
                type="button"
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0}
                className="px-3 py-1 border border-slate-300 rounded disabled:opacity-40"
              >
                ←
              </button>
              <span className="text-slate-500">
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setOffset(offset + limit)}
                disabled={offset + limit >= total}
                className="px-3 py-1 border border-slate-300 rounded disabled:opacity-40"
              >
                →
              </button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-600 w-40">Дата</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600 w-48">Операция</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600 w-28">Статус</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Описание</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600 w-36">GTIN</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600 w-20">Кодов</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Загрузка...
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Нет операций. Они появятся после первых действий в системе.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className={`border-b border-slate-100 hover:bg-slate-50 ${
                      entry.status === "error" ? "bg-red-50/30" : ""
                    }`}
                  >
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(entry.created_at).toLocaleString("ru-RU")}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5">
                        <span>{TYPE_ICONS[entry.operation_type] || "⚙️"}</span>
                        <span className="text-xs font-medium">
                          {TYPE_LABELS[entry.operation_type] || entry.operation_type}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          STATUS_CONFIG[entry.status]?.color
                        }`}
                      >
                        {STATUS_CONFIG[entry.status]?.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div>{entry.description}</div>
                      {entry.error_message && (
                        <div
                          className="text-red-500 mt-0.5 cursor-help"
                          title={entry.error_message}
                        >
                          ⚠️ {entry.error_message.slice(0, 60)}
                          {entry.error_message.length > 60 ? "..." : ""}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {entry.gtin || "—"}
                    </td>
                    <td className="px-4 py-3 text-center text-slate-600">
                      {entry.codes_count ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
