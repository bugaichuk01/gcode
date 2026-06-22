import { ChangeEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  OPERATIONS_TAB_STORAGE_KEY,
  type OperationsTab,
} from "./OperationsPage";
import axios from "axios";
import { Search } from "lucide-react";
import apiClient from "../api/client";
import PageHeader from "../components/ui/PageHeader";
import Alert from "../components/ui/Alert";
import EmptyState from "../components/ui/EmptyState";

interface CodeItem {
  code: string;
  gtin: string | null;
  order_id: string;
  suz_order_id: string | null;
  quantity_total: number;
  created_at: string;
}

type MarkingCodesImportResult = {
  added: number;
  skipped: number;
  errors: string[];
};

function formatApiError(err: unknown): string {
  if (!axios.isAxiosError(err)) {
    return "Ошибка при импорте файла";
  }
  const detail = err.response?.data?.detail;
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail.map((d) => (typeof d === "object" && d && "msg" in d ? String(d.msg) : String(d))).join("; ");
  }
  return "Ошибка при импорте файла";
}

export default function CodesPage() {
  const navigate = useNavigate();
  const [codes, setCodes] = useState<CodeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterGtin, setFilterGtin] = useState("");
  const [page, setPage] = useState(0);
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [checkedCount, setCheckedCount] = useState(0);
  const [statusResults, setStatusResults] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const limit = 50;

  function toggleCode(code: string) {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function toggleAll() {
    if (selectedCodes.size === codes.length) {
      setSelectedCodes(new Set());
    } else {
      setSelectedCodes(new Set(codes.map((c) => c.code)));
    }
  }

  function handleExportSelected() {
    const csv = Array.from(selectedCodes).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/plain" }));
    a.download = `codes_${selectedCodes.size}.csv`;
    a.click();
  }

  async function handlePrintLabels() {
    if (selectedCodes.size === 0) {
      setError("Выберите коды для печати");
      return;
    }

    const widthMm = 58;
    const heightMm = 40;

    try {
      setPrinting(true);
      setError(null);
      const res = await apiClient.post(
        "/labels/pdf/batch",
        {
          codes: Array.from(selectedCodes),
          width_mm: widthMm,
          height_mm: heightMm,
          copies: 1,
        },
        { responseType: "blob" },
      );

      const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const win = window.open(url, "_blank");
      if (win) {
        win.onload = () => win.print();
      }
    } catch {
      setError("Ошибка генерации этикеток");
    } finally {
      setPrinting(false);
    }
  }

  function handleCreateUpd() {
    sessionStorage.setItem("updCodes", JSON.stringify(Array.from(selectedCodes)));
    navigate("/upd");
  }

  function navigateToOperationsTab(tab: OperationsTab, codesKey: string) {
    sessionStorage.setItem(codesKey, JSON.stringify(Array.from(selectedCodes)));
    sessionStorage.setItem(OPERATIONS_TAB_STORAGE_KEY, tab);
    navigate("/operations");
  }

  function handleIntroduce() {
    navigateToOperationsTab("utilisation", "utilisationCodes");
  }

  function handleWithdraw() {
    navigateToOperationsTab("withdrawal", "withdrawalCodes");
  }

  function handleRemark() {
    sessionStorage.setItem("withdrawalCodes", JSON.stringify(Array.from(selectedCodes)));
    sessionStorage.setItem("withdrawalType", "DAMAGE_LOSS");
    sessionStorage.setItem("afterWithdrawal", "remark");
    sessionStorage.setItem("remarkQuantity", String(selectedCodes.size));
    window.location.href = "/withdrawal";
  }

  function handleReturn() {
    navigateToOperationsTab("returns", "returnCodes");
  }

  function handleAggregate() {
    navigateToOperationsTab("aggregation", "aggregationCodes");
  }

  async function handleCheckStatus() {
    const codesArr = Array.from(selectedCodes);
    setCheckingStatus(true);
    setCheckedCount(0);
    setError(null);
    const allResults: Record<string, string> = {};

    try {
      for (let i = 0; i < codesArr.length; i += 50) {
        const batch = codesArr.slice(i, i + 50);
        const res = await apiClient.post("/emission-orders/codes/check-status", {
          cises: batch,
        });
        res.data.results.forEach(
          (item: { cis: string; status?: string; error?: string }, idx: number) => {
            const status = item.status || item.error || "unknown";
            const requestCode = batch[idx];
            if (requestCode) {
              allResults[requestCode] = status;
            }
            if (item.cis && item.cis !== requestCode) {
              allResults[item.cis] = status;
            }
          },
        );
        setStatusResults({ ...allResults });
        setCheckedCount((prev) => prev + batch.length);
      }
      console.log("allResults:", allResults);
      console.log("items[0].code:", codes[0]?.code);
      console.log("statusResults keys:", Object.keys(allResults));
    } catch {
      setError("Ошибка при проверке статусов");
    } finally {
      setCheckingStatus(false);
    }
  }

  const statusLabels: Record<string, { label: string; className: string }> = {
    INTRODUCED: { label: "В обороте", className: "badge-published" },
    APPLIED: { label: "Нанесён", className: "badge-info" },
    EMITTED: { label: "Эмитирован", className: "badge-warning" },
    WRITTEN_OFF: { label: "Выбыл", className: "badge-draft" },
    RETIRED: { label: "Выбыл", className: "badge-draft" },
    not_found: { label: "Не найден в ЧЗ", className: "badge-draft" },
    error: { label: "Ошибка", className: "badge-error" },
    unknown: { label: "Неизвестен", className: "badge-warning" },
  };

  async function loadCodes() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (filterGtin) params.set("gtin", filterGtin);
      params.set("limit", String(limit));
      params.set("offset", String(page * limit));

      const res = await apiClient.get(`/emission-orders/codes?${params}`);
      setCodes(res.data.items);
      setTotal(res.data.total);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCodes();
  }, [search, filterGtin, page]);

  async function handleImportCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setImporting(true);
    setImportResult(null);
    setError(null);

    try {
      const isXlsx = file.name.toLowerCase().endsWith(".xlsx");
      if (isXlsx) {
        const res = await apiClient.post<MarkingCodesImportResult>(
          "/excel/import-marking-codes",
          formData,
        );
        const { added, skipped, errors } = res.data;
        setImportResult(
          `Импорт завершён: добавлено ${added} кодов${skipped > 0 ? `, пропущено ${skipped}` : ""}${errors.length > 0 ? `. Ошибки: ${errors.join(", ")}` : ""}`,
        );
      } else {
        const res = await apiClient.post<{
          imported: number;
          order_id: string;
        }>("/emission-orders/codes/import-csv", formData);
        const { imported, order_id } = res.data;
        setImportResult(
          `Импортировано ${imported} кодов (заказ ${order_id.slice(0, 8)}...)`,
        );
      }
      await loadCodes();
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  }

  async function handleExportCsv() {
    setExporting(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (filterGtin) {
        params.gtin = filterGtin;
      }

      const res = await apiClient.get("/emission-orders/codes/export-csv", {
        params,
        responseType: "blob",
      });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `codes_${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="page-container">
      <PageHeader
        title="Коды маркировки"
        description="Все скачанные КМ из заказов СУЗ. Импортируйте, проверяйте статус и отправляйте в печать или УПД."
        actions={
          <>
            <label className="cursor-pointer rounded-lg bg-slate-600 px-4 py-1.5 text-sm text-white hover:bg-slate-700">
              {importing ? "Импорт..." : "Импорт CSV/Excel"}
              <input
                type="file"
                accept=".csv,.txt,.xlsx"
                className="hidden"
                disabled={importing}
                onChange={(event) => void handleImportCsv(event)}
              />
            </label>
            <button
              type="button"
              onClick={() => void handleExportCsv()}
              disabled={exporting}
              className="rounded-lg bg-slate-600 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {exporting ? "Экспорт..." : `Экспорт CSV (${total})`}
            </button>
          </>
        }
      />

      <div className="toolbar mb-6">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-sage-400" />
          <input
            type="text"
            placeholder="Поиск по коду..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="input-field pl-10"
          />
        </div>
        <input
          type="text"
          placeholder="Фильтр по GTIN..."
          value={filterGtin}
          onChange={(e) => {
            setFilterGtin(e.target.value);
            setPage(0);
          }}
          className="input-field w-full sm:w-48"
        />
        <span className="rounded-xl bg-forest-50 px-3 py-2 text-sm font-medium text-forest-800">
          Всего: {total.toLocaleString("ru-RU")}
        </span>
        {codes.length > 0 ? (
          <>
            <button
              type="button"
              onClick={() => setSelectedCodes(new Set(codes.map((c) => c.code)))}
              className="text-xs text-blue-600 hover:underline"
            >
              Выбрать все ({codes.length})
            </button>
            {selectedCodes.size > 0 ? (
              <button
                type="button"
                onClick={() => setSelectedCodes(new Set())}
                className="text-xs text-slate-400 hover:underline"
              >
                Снять выбор
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {importResult ? (
        <Alert variant="success" onDismiss={() => setImportResult(null)} className="mb-4">
          {importResult}
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="error" onDismiss={() => setError(null)} className="mb-4">
          {error}
        </Alert>
      ) : null}

      {selectedCodes.size > 0 ? (
        <div className="toolbar mb-6 !border-forest-200 !bg-forest-50/80">
          <span className="text-sm font-semibold text-forest-800">
            Выбрано: {selectedCodes.size}
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCheckStatus}
              disabled={checkingStatus}
              className="btn-sm btn-accent"
            >
              {checkingStatus
                ? `Проверка... (${checkedCount}/${selectedCodes.size})`
                : `Проверить статус (${selectedCodes.size})`}
            </button>
            <button type="button" onClick={handleIntroduce} className="btn-sm btn-accent">
              Ввести в оборот ({selectedCodes.size})
            </button>
            <button
              type="button"
              onClick={handleWithdraw}
              className="btn-sm btn-accent !bg-red-600 hover:!bg-red-700"
            >
              Вывести из оборота ({selectedCodes.size})
            </button>
            <button
              type="button"
              onClick={handleRemark}
              className="btn-sm rounded-lg bg-orange-600 px-4 py-1.5 text-sm text-white hover:bg-orange-700"
            >
              Перемаркировать ({selectedCodes.size})
            </button>
            <button
              type="button"
              onClick={handleReturn}
              className="btn-sm btn-accent !bg-teal-600 hover:!bg-teal-700"
            >
              Вернуть в оборот ({selectedCodes.size})
            </button>
            <button type="button" onClick={handleAggregate} className="btn-sm btn-accent">
              Агрегировать ({selectedCodes.size})
            </button>
            <button type="button" onClick={handleCreateUpd} className="btn-sm btn-primary">
              Создать УПД ({selectedCodes.size})
            </button>
            <button
              type="button"
              onClick={() => void handlePrintLabels()}
              disabled={printing}
              className="btn-sm btn-secondary disabled:opacity-50"
            >
              {printing
                ? `Генерация PDF (${selectedCodes.size})...`
                : `Печать этикеток (${selectedCodes.size})`}
            </button>
            <button type="button" onClick={handleExportSelected} className="btn-sm btn-secondary">
              Экспорт CSV
            </button>
            <button type="button" onClick={() => setSelectedCodes(new Set())} className="btn-sm btn-ghost">
              Снять выбор
            </button>
          </div>
        </div>
      ) : null}

      <div className="table-container">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-10">
                <input
                  type="checkbox"
                  checked={selectedCodes.size === codes.length && codes.length > 0}
                  onChange={toggleAll}
                  className="checkbox-field"
                />
              </th>
              <th>Код маркировки</th>
              <th>GTIN</th>
              <th>Заказ СУЗ</th>
              <th>Дата заказа</th>
              <th>Кодов в заказе</th>
              <th>Статус ЧЗ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sage-500">
                  Загрузка...
                </td>
              </tr>
            ) : codes.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    title="Нет кодов маркировки"
                    description="Скачайте КМ из заказов СУЗ или импортируйте CSV/Excel файл."
                  />
                </td>
              </tr>
            ) : (
              codes.map((item, idx) => (
                <tr key={idx}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedCodes.has(item.code)}
                      onChange={() => toggleCode(item.code)}
                      className="checkbox-field"
                    />
                  </td>
                  <td className="max-w-xs truncate font-mono text-xs">{item.code}</td>
                  <td>{item.gtin || "—"}</td>
                  <td className="font-mono text-xs text-sage-500">
                    {item.suz_order_id ? `${item.suz_order_id.slice(0, 8)}...` : "—"}
                  </td>
                  <td>{new Date(item.created_at).toLocaleDateString("ru-RU")}</td>
                  <td>{item.quantity_total}</td>
                  <td>
                    {statusResults[item.code] ? (
                      <span
                        className={
                          statusLabels[statusResults[item.code]]?.className ??
                          "badge-draft"
                        }
                      >
                        {statusLabels[statusResults[item.code]]?.label ??
                          statusResults[item.code]}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > limit ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-1">
          <button
            type="button"
            onClick={() => setPage(0)}
            disabled={page === 0}
            className="btn-sm btn-ghost disabled:opacity-40"
          >
            «
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="btn-sm btn-ghost disabled:opacity-40"
          >
            ‹
          </button>
          {Array.from({ length: totalPages }, (_, i) => i)
            .filter((i) => Math.abs(i - page) <= 2)
            .map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => setPage(i)}
                className={`btn-sm min-w-[36px] ${
                  i === page ? "btn-primary" : "btn-ghost"
                }`}
              >
                {i + 1}
              </button>
            ))}
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={(page + 1) * limit >= total}
            className="btn-sm btn-ghost disabled:opacity-40"
          >
            ›
          </button>
          <button
            type="button"
            onClick={() => setPage(totalPages - 1)}
            disabled={(page + 1) * limit >= total}
            className="btn-sm btn-ghost disabled:opacity-40"
          >
            »
          </button>
          <span className="ml-2 text-sm text-sage-500">
            {page * limit + 1}–{Math.min((page + 1) * limit, total)} из {total}
          </span>
        </div>
      ) : null}
    </div>
  );
}
