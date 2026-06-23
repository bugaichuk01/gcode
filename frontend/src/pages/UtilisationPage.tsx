import { useEffect, useState } from "react";
import apiClient from "../api/client";
import { hasCryptoTail } from "../utils/markingCode";
import PageHeader from "../components/ui/PageHeader";
import Alert from "../components/ui/Alert";
import { signBody } from "../services/signingService";
import { useProductGroups } from "../hooks/useProductGroups";

interface UtilisationReport {
  id: string;
  product_group: string;
  marking_codes: string[];
  status: "draft" | "pending" | "accepted" | "rejected" | "error";
  report_id: string | null;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
}

const statusConfig: Record<
  UtilisationReport["status"],
  { label: string; className: string }
> = {
  draft: { label: "Черновик", className: "badge-draft" },
  pending: { label: "Отправлен", className: "badge-draft" },
  accepted: { label: "Принят", className: "badge-success" },
  rejected: { label: "Отклонён", className: "badge-error" },
  error: { label: "Ошибка", className: "badge-error" },
};

export default function UtilisationPage() {
  const { groups: productGroups } = useProductGroups();
  const [reports, setReports] = useState<UtilisationReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [signing, setSigning] = useState<string | null>(null);

  const [codesText, setCodesText] = useState("");
  const [productGroup, setProductGroup] = useState("perfumery");
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);

  async function loadReports() {
    try {
      const res = await apiClient.get<UtilisationReport[]>("/utilisation/");
      setReports(res.data);
    } catch {
      setError("Не удалось загрузить отчёты");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReports();
    const stored = sessionStorage.getItem("utilisationCodes");
    if (stored) {
      const codes = JSON.parse(stored) as string[];
      setCodesText(codes.join("\n"));
      setShowForm(true);
      sessionStorage.removeItem("utilisationCodes");
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

    const invalidCodes = codes.filter((c) => !hasCryptoTail(c));
    if (invalidCodes.length > 0) {
      setError(
        `Обнаружены некорректные коды (без криптохвоста): ${invalidCodes.slice(0, 3).join(", ")}. ` +
          "Используйте полные коды маркировки из раздела 'Коды маркировки'.",
      );
      return;
    }

    setCreating(true);
    setError(null);
    try {
      await apiClient.post("/utilisation/", {
        marking_codes: codes,
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
      setError(detail || "Ошибка создания отчёта");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Удалить отчёт?")) return;
    try {
      await apiClient.delete(`/utilisation/${id}`);
      await loadReports();
    } catch {
      setError("Не удалось удалить отчёт");
    }
  }

  async function handleSign(report: UtilisationReport) {
    setSigning(report.id);
    setError(null);
    try {
      const bodyRes = await apiClient.get<{ body: string }>(`/utilisation/${report.id}/body`);
      const { body } = bodyRes.data;
      const signature = await signBody(body);

      await apiClient.post(`/utilisation/${report.id}/send`, { signature });
      setSuccess(
        "Отчёт о нанесении успешно отправлен! Коды переходят в статус «Нанесён».",
      );
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

  const codesCount = codesText.split("\n").filter((c) => c.trim()).length;

  return (
    <div className="page-container">
      <PageHeader
        title="Ввод в оборот"
        description="Отчёт о нанесении кодов маркировки — переводит КМ из «Эмитирован» в «Нанесён»"
        actions={
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            className="btn-accent"
          >
            + Создать отчёт
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
            Новый отчёт о нанесении
          </h2>

          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-sage-700">
              Товарная группа
            </label>
            <select
              value={productGroup}
              onChange={(e) => setProductGroup(e.target.value)}
              className="input-field max-w-xs"
            >
              {productGroups.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
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
            <p className="mt-1 text-xs text-amber-600">
              ⚠️ Используйте полные коды маркировки из раздела «Коды маркировки» (кнопка «Ввести в
              оборот»). Укороченные коды не принимаются ЧЗ.
            </p>
            <p className="mt-1 text-xs text-sage-400">Кодов: {codesCount}</p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating}
              className="btn-accent"
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

      <Alert variant="info" className="mb-6">
        <strong>Для духов и туалетной воды:</strong> отчёт о нанесении формируется
        автоматически СУЗом после скачивания кодов. Нажмите «Подписать и отправить», чтобы
        подтвердить ввод в оборот.
      </Alert>

      <div className="table-container">
        <table className="table-base">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Товарная группа</th>
              <th>Кодов</th>
              <th>Статус</th>
              <th>ID отчёта</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sage-400">
                  Загрузка...
                </td>
              </tr>
            ) : reports.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sage-400">
                  Нет отчётов. Создайте первый отчёт о нанесении.
                </td>
              </tr>
            ) : (
              reports.map((report) => (
                <tr key={report.id}>
                  <td className="text-xs text-sage-500">
                    {new Date(report.created_at).toLocaleString("ru-RU")}
                  </td>
                  <td>{report.product_group}</td>
                  <td>{report.marking_codes.length}</td>
                  <td>
                    <span className={statusConfig[report.status].className}>
                      {statusConfig[report.status].label}
                    </span>
                    {report.error_message && (
                      <p
                        className="text-xs text-red-500 mt-1 max-w-xs cursor-help"
                        title={report.error_message}
                      >
                        {report.error_message.slice(0, 80)}
                        {report.error_message.length > 80 ? "..." : ""}
                      </p>
                    )}
                  </td>
                  <td className="font-mono text-xs text-sage-400">
                    {report.report_id ? `${report.report_id.slice(0, 16)}...` : "—"}
                  </td>
                  <td>
                    {(report.status === "draft" || report.status === "error") && (
                      <button
                        type="button"
                        onClick={() => void handleSign(report)}
                        disabled={signing === report.id}
                        className="btn-sm btn-accent"
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
                      className="px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded ml-2"
                    >
                      Удалить
                    </button>
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
