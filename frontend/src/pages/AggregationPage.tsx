import { useEffect, useState } from "react";
import apiClient from "../api/client";
import PageHeader from "../components/ui/PageHeader";
import Alert from "../components/ui/Alert";
import { signBodyBase64 } from "../services/signingService";
import { useProductGroups } from "../hooks/useProductGroups";

const DEFAULT_GCP = "460000000";

interface AggregationDocument {
  id: string;
  kitu_code: string;
  product_group: string;
  marking_codes: string[];
  units_capacity: number | null;
  status: "draft" | "pending" | "accepted" | "rejected" | "error";
  document_id: string | null;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
}

interface GeneratedAggregate {
  id: string;
  kitu_code: string;
  units_capacity: number | null;
  status: "generated";
}

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

export default function AggregationPage() {
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

  const [showForm, setShowForm] = useState(false);
  const [codesText, setCodesText] = useState("");
  const [productGroup, setProductGroup] = useState("perfumery");
  const [kituCode, setKituCode] = useState("");
  const [creating, setCreating] = useState(false);

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
    const stored = sessionStorage.getItem("aggregationCodes");
    if (stored) {
      const codes = JSON.parse(stored) as string[];
      setCodesText(codes.join("\n"));
      setShowForm(true);
      sessionStorage.removeItem("aggregationCodes");
    }
  }, []);

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
  }

  function handleRemoveAggregate(id: string) {
    setAggregates((prev) => prev.filter((a) => a.id !== id));
  }

  function handleUseAggregateForPackage(agg: GeneratedAggregate) {
    setKituCode(agg.kitu_code);
    setShowForm(true);
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
      await loadDocuments();
    } catch {
      setError("Не удалось удалить документ");
    }
  }

  const codesCount = codesText.split("\n").filter((c) => c.trim()).length;

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

      <div className="mb-6 rounded-xl border border-forest-200 bg-forest-50/80 px-4 py-3 text-sm text-forest-800">
        <strong>Агрегация КИТУ</strong> — генерация SSCC-кодов партией и объединение КМ под
        транспортным кодом. Сканирование и наполнение единицами — в следующих шагах (P6.8).
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
        <span className="text-sm font-medium text-sage-700">Режим работы (сканер — P6.8):</span>
        <label className="flex items-center gap-2 text-sm text-sage-500">
          <input
            type="radio"
            name="assemblyMode"
            value="before"
            checked={assemblyMode === "before"}
            onChange={() => setAssemblyMode("before")}
            disabled
          />
          До сборки
        </label>
        <label className="flex items-center gap-2 text-sm text-sage-500">
          <input
            type="radio"
            name="assemblyMode"
            value="after"
            checked={assemblyMode === "after"}
            onChange={() => setAssemblyMode("after")}
            disabled
          />
          После сборки
        </label>
      </div>

      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-sage-900">Агрегаты (КИТУ)</h2>
          <button
            type="button"
            onClick={handleClearAggregates}
            disabled={aggregates.length === 0}
            className="btn-secondary btn-sm disabled:opacity-50"
          >
            Очистить
          </button>
        </div>
        <div className="table-container">
          <table className="table-base">
            <thead>
              <tr>
                <th>КИТУ</th>
                <th>Кол-во единиц</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {aggregates.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sage-400">
                    Сгенерируйте партию КИТУ выше
                  </td>
                </tr>
              ) : (
                aggregates.map((agg) => (
                  <tr key={agg.id}>
                    <td className="font-mono text-xs">{agg.kitu_code}</td>
                    <td>{formatUnitsCapacity(agg.units_capacity)}</td>
                    <td>
                      <span className="badge-draft">Сгенерирован</span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2">
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
        <h2 className="mb-2 text-base font-semibold text-sage-900">Единицы</h2>
        <div className="table-container">
          <table className="table-base">
            <thead>
              <tr>
                <th>Код</th>
                <th>Статус</th>
                <th>Товар</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-sage-400">
                  Наполнение единицами — в следующих шагах (сканер / импорт)
                </td>
              </tr>
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
      <div className="table-container">
        <table className="table-base">
          <thead>
            <tr>
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
                <td colSpan={8} className="px-4 py-8 text-center text-sage-400">
                  Загрузка...
                </td>
              </tr>
            ) : documents.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sage-400">
                  Нет упаковок. Создайте первую транспортную упаковку.
                </td>
              </tr>
            ) : (
              documents.map((doc) => (
                <tr key={doc.id}>
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
    </div>
  );
}
