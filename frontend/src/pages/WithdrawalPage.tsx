import { useEffect, useState } from "react";
import apiClient from "../api/client";
import PageHeader from "../components/ui/PageHeader";
import Alert from "../components/ui/Alert";
import { signBodyBase64 } from "../services/signingService";
import { useProductGroups } from "../hooks/useProductGroups";

interface WithdrawalReport {
  id: string;
  withdrawal_type: string;
  product_group: string;
  marking_codes: string[];
  status: "draft" | "pending" | "accepted" | "rejected" | "error";
  document_id: string | null;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
}

const WITHDRAWAL_TYPES = [
  { value: "SOLD", label: "Розничная продажа" },
  { value: "DAMAGE_LOSS", label: "Утрата/повреждение" },
  { value: "DEFECT", label: "Брак" },
  { value: "LIQUIDATION", label: "Ликвидация" },
  { value: "OTHER", label: "Прочее" },
];

const statusConfig: Record<
  WithdrawalReport["status"],
  { label: string; className: string }
> = {
  draft: { label: "Черновик", className: "badge-draft" },
  pending: { label: "Отправлен", className: "badge-warning" },
  accepted: { label: "Принят", className: "badge-success" },
  rejected: { label: "Отклонён", className: "badge-error" },
  error: { label: "Ошибка", className: "badge-error" },
};

export default function WithdrawalPage() {
  const { groups: productGroups } = useProductGroups();
  const [reports, setReports] = useState<WithdrawalReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [signing, setSigning] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [codesText, setCodesText] = useState("");
  const [withdrawalType, setWithdrawalType] = useState("SOLD");
  const [productGroup, setProductGroup] = useState("perfumery");
  const [creating, setCreating] = useState(false);

  async function loadReports() {
    try {
      const res = await apiClient.get<WithdrawalReport[]>("/withdrawal/");
      setReports(res.data);
    } catch {
      setError("Не удалось загрузить отчёты");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReports();
    const storedType = sessionStorage.getItem("withdrawalType");
    if (storedType) {
      setWithdrawalType(storedType);
      sessionStorage.removeItem("withdrawalType");
    }
    const stored = sessionStorage.getItem("withdrawalCodes");
    if (stored) {
      const codes = JSON.parse(stored) as string[];
      setCodesText(codes.join("\n"));
      setShowForm(true);
      sessionStorage.removeItem("withdrawalCodes");
    }
  }, []);

  async function handleCreate() {
    const codes = codesText
      .split("\n")
      .map((c) => c.trim())
      .filter(Boolean);
    if (codes.length === 0) {
      setError("Введите коды маркировки");
      return;
    }
    const invalid = codes.filter((c) => c.length < 20);
    if (invalid.length > 0) {
      setError("Обнаружены некорректные коды (слишком короткие)");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      await apiClient.post("/withdrawal/", {
        marking_codes: codes,
        withdrawal_type: withdrawalType,
        product_group: productGroup,
      });
      setCodesText("");
      setShowForm(false);
      setSuccess(`Черновик создан (${codes.length} кодов)`);
      await loadReports();
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

  async function handleSign(report: WithdrawalReport) {
    setSigning(report.id);
    setError(null);
    try {
      const bodyRes = await apiClient.get<{ body: string; body_b64: string }>(
        `/withdrawal/${report.id}/body`,
      );
      const { body_b64 } = bodyRes.data;
      const signature = await signBodyBase64(body_b64);

      await apiClient.post(`/withdrawal/${report.id}/send`, { signature });
      setSuccess("Документ вывода из оборота отправлен!");
      await loadReports();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : err && typeof err === "object" && "response" in err
            ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
            : undefined;
      setError(message || "Ошибка при отправке");
    } finally {
      setSigning(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Удалить документ?")) return;
    try {
      await apiClient.delete(`/withdrawal/${id}`);
      await loadReports();
    } catch {
      setError("Не удалось удалить документ");
    }
  }

  const codesCount = codesText.split("\n").filter((c) => c.trim()).length;

  return (
    <div className="page-container">
      <PageHeader
        title="Вывод из оборота"
        description="Документ LK_RECEIPT — фиксирует продажу или списание маркированного товара"
        actions={
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            className="btn-accent !bg-red-600 hover:!bg-red-700"
          >
            + Создать документ
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

      {showForm ? (
        <div className="card mb-6">
          <h2 className="mb-4 text-base font-semibold text-sage-900">
            Новый документ вывода из оборота
          </h2>

          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-sage-700">
                Причина выбытия
              </label>
              <select
                value={withdrawalType}
                onChange={(e) => setWithdrawalType(e.target.value)}
                className="select-field"
              >
                {WITHDRAWAL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
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
            <p className="mt-1 text-xs text-sage-400">Кодов: {codesCount}</p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating}
              className="btn-accent !bg-red-600 hover:!bg-red-700"
            >
              {creating ? "Создание..." : "Создать черновик"}
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

      <div className="table-container">
        <table className="table-base">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Причина</th>
              <th>Группа</th>
              <th>Кодов</th>
              <th>Статус</th>
              <th>ID документа</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sage-400">
                  Загрузка...
                </td>
              </tr>
            ) : reports.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sage-400">
                  Нет документов. Создайте первый документ вывода из оборота.
                </td>
              </tr>
            ) : (
              reports.map((report) => (
                <tr key={report.id}>
                  <td className="text-xs text-sage-500">
                    {new Date(report.created_at).toLocaleString("ru-RU")}
                  </td>
                  <td>
                    {WITHDRAWAL_TYPES.find((t) => t.value === report.withdrawal_type)?.label ||
                      report.withdrawal_type}
                  </td>
                  <td>{report.product_group}</td>
                  <td>{report.marking_codes.length}</td>
                  <td>
                    <span className={statusConfig[report.status].className}>
                      {statusConfig[report.status].label}
                    </span>
                    {report.error_message ? (
                      <p
                        className="mt-1 max-w-xs cursor-help text-xs text-red-500"
                        title={report.error_message}
                      >
                        {report.error_message.slice(0, 60)}
                        {report.error_message.length > 60 ? "..." : ""}
                      </p>
                    ) : null}
                  </td>
                  <td className="font-mono text-xs text-sage-400">
                    {report.document_id ? `${report.document_id.slice(0, 16)}...` : "—"}
                  </td>
                  <td>
                    <div className="flex flex-wrap items-center gap-2">
                      {(report.status === "draft" || report.status === "error") && (
                        <button
                          type="button"
                          onClick={() => void handleSign(report)}
                          disabled={signing === report.id}
                          className="btn-sm btn-accent !bg-red-600 hover:!bg-red-700"
                        >
                          {signing === report.id ? "Подписание..." : "Подписать и отправить"}
                        </button>
                      )}
                      {report.status === "accepted" ? (
                        <span className="text-xs font-medium text-forest-600">✓ Принят</span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void handleDelete(report.id)}
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
