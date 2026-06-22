import { useEffect, useRef, useState } from "react";
import axios from "axios";
import apiClient from "../api/client";
import PageHeader from "../components/ui/PageHeader";
import Alert from "../components/ui/Alert";

interface IncomingUPD {
  id: string;
  document_number: string;
  document_date: string | null;
  seller_inn: string | null;
  seller_name: string | null;
  document_codes: string[];
  scanned_codes: string[];
  extra_codes: string[];
  missing_codes: string[];
  duplicate_codes: string[];
  status: "pending" | "checked" | "accepted" | "rejected";
  created_at: string;
}

const STATUS_CONFIG: Record<
  IncomingUPD["status"],
  { label: string; className: string }
> = {
  pending: { label: "Ожидает проверки", className: "bg-amber-100 text-amber-700" },
  checked: { label: "Проверен", className: "bg-blue-100 text-blue-700" },
  accepted: { label: "Принят", className: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "Отклонён", className: "bg-red-100 text-red-700" },
};

export default function IncomingUPDPage() {
  const [docs, setDocs] = useState<IncomingUPD[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<IncomingUPD | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [scannedText, setScannedText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const xmlRef = useRef<HTMLInputElement>(null);

  const [docNumber, setDocNumber] = useState("");
  const [docDate, setDocDate] = useState("");
  const [sellerInn, setSellerInn] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [docCodes, setDocCodes] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await apiClient.get<IncomingUPD[]>("/incoming-upd/");
      setDocs(res.data);
    } catch {
      setError("Не удалось загрузить входящие УПД");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleXmlUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await apiClient.post<{
        document_number: string;
        document_date: string | null;
        seller_inn: string | null;
        seller_name: string | null;
        document_codes: string[];
      }>("/incoming-upd/parse-xml", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const data = res.data;
      setDocNumber(data.document_number || "");
      setDocDate(data.document_date || "");
      setSellerInn(data.seller_inn || "");
      setSellerName(data.seller_name || "");
      setDocCodes(data.document_codes.join("\n"));
      setShowCreate(true);
      setError(null);
    } catch (requestError) {
      if (axios.isAxiosError(requestError)) {
        const detail = requestError.response?.data?.detail;
        setError(typeof detail === "string" ? detail : "Ошибка парсинга XML");
      } else {
        setError("Ошибка парсинга XML");
      }
    }
    event.target.value = "";
  }

  async function handleCreate() {
    const codes = docCodes
      .split("\n")
      .map((code) => code.trim())
      .filter(Boolean);
    if (!docNumber || codes.length === 0) {
      setError("Укажите номер документа и коды");
      return;
    }

    try {
      const res = await apiClient.post<IncomingUPD>("/incoming-upd/", {
        document_number: docNumber,
        document_date: docDate || null,
        seller_inn: sellerInn || null,
        seller_name: sellerName || null,
        document_codes: codes,
      });
      setShowCreate(false);
      setDocNumber("");
      setDocDate("");
      setSellerInn("");
      setSellerName("");
      setDocCodes("");
      setSelected(res.data);
      setScannedText("");
      setError(null);
      await load();
    } catch (requestError) {
      if (axios.isAxiosError(requestError)) {
        const detail = requestError.response?.data?.detail;
        setError(typeof detail === "string" ? detail : "Ошибка создания УПД");
      } else {
        setError("Ошибка создания УПД");
      }
    }
  }

  async function handleScan() {
    if (!selected) return;

    const codes = scannedText
      .split("\n")
      .map((code) => code.trim())
      .filter(Boolean);

    try {
      const res = await apiClient.post<IncomingUPD>(
        `/incoming-upd/${selected.id}/scan`,
        { scanned_codes: codes },
      );
      setSelected(res.data);
      await load();
    } catch (requestError) {
      if (axios.isAxiosError(requestError)) {
        const detail = requestError.response?.data?.detail;
        setError(typeof detail === "string" ? detail : "Ошибка сверки");
      } else {
        setError("Ошибка сверки");
      }
    }
  }

  async function handleAccept() {
    if (!selected) return;

    try {
      await apiClient.post(`/incoming-upd/${selected.id}/accept`);
      setSuccess("УПД принят");
      setSelected(null);
      await load();
    } catch {
      setError("Не удалось принять УПД");
    }
  }

  async function handleReject() {
    if (!selected) return;

    try {
      await apiClient.post(`/incoming-upd/${selected.id}/reject`);
      setSuccess("УПД отклонён");
      setSelected(null);
      await load();
    } catch {
      setError("Не удалось отклонить УПД");
    }
  }

  const docCodesCount = docCodes.split("\n").filter((code) => code.trim()).length;
  const scannedCount = scannedText.split("\n").filter((code) => code.trim()).length;

  return (
    <div className="page-container max-w-7xl">
      <PageHeader
        title="Приёмка УПД"
        description="Входящие универсальные передаточные документы от поставщиков"
        actions={
          <>
            <label className="btn-secondary cursor-pointer">
              📂 Загрузить XML
              <input
                ref={xmlRef}
                type="file"
                accept=".xml"
                className="hidden"
                onChange={(event) => void handleXmlUpload(event)}
              />
            </label>
            <button type="button" onClick={() => setShowCreate(true)} className="btn-primary">
              + Создать вручную
            </button>
          </>
        }
      />

      {error ? (
        <Alert variant="error" onDismiss={() => setError(null)} className="mb-6">
          {error}
        </Alert>
      ) : null}

      {success ? (
        <Alert variant="success" onDismiss={() => setSuccess(null)} className="mb-6">
          {success}
        </Alert>
      ) : null}

      {showCreate ? (
        <div className="card-panel mb-6 p-6">
          <h2 className="mb-4 font-semibold text-forest-950">Новый входящий УПД</h2>
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="label-text">Номер документа *</span>
              <input
                value={docNumber}
                onChange={(event) => setDocNumber(event.target.value)}
                className="input-field"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label-text">Дата</span>
              <input
                type="date"
                value={docDate}
                onChange={(event) => setDocDate(event.target.value)}
                className="input-field"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label-text">ИНН поставщика</span>
              <input
                value={sellerInn}
                onChange={(event) => setSellerInn(event.target.value)}
                className="input-field"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label-text">Наименование поставщика</span>
              <input
                value={sellerName}
                onChange={(event) => setSellerName(event.target.value)}
                className="input-field"
              />
            </label>
          </div>
          <label className="mb-4 flex flex-col gap-1.5">
            <span className="label-text">Коды маркировки из документа (один на строку)</span>
            <textarea
              value={docCodes}
              onChange={(event) => setDocCodes(event.target.value)}
              rows={6}
              className="input-field font-mono text-xs"
            />
            <span className="text-xs text-sage-400">Кодов: {docCodesCount}</span>
          </label>
          <div className="flex gap-3">
            <button type="button" onClick={() => void handleCreate()} className="btn-primary">
              Создать
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">
              Отмена
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="table-container overflow-hidden">
          <div className="border-b border-sage-200 px-4 py-3 font-medium text-sage-700">
            Входящие документы ({docs.length})
          </div>
          <div className="divide-y divide-sage-100">
            {loading ? (
              <div className="px-4 py-8 text-center text-sage-400">Загрузка...</div>
            ) : docs.length === 0 ? (
              <div className="px-4 py-8 text-center text-sage-400">Нет входящих УПД</div>
            ) : (
              docs.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => {
                    setSelected(doc);
                    setScannedText(doc.scanned_codes.join("\n"));
                  }}
                  className={`w-full px-4 py-3 text-left hover:bg-sage-50 ${
                    selected?.id === doc.id ? "bg-forest-50" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-forest-950">
                        № {doc.document_number}
                      </p>
                      <p className="text-xs text-sage-500">
                        {doc.seller_name || doc.seller_inn || "Поставщик не указан"}
                      </p>
                      <p className="text-xs text-sage-400">
                        {doc.document_codes.length} кодов
                        {doc.extra_codes.length > 0 ? (
                          <span className="ml-2 text-amber-500">
                            +{doc.extra_codes.length} лишних
                          </span>
                        ) : null}
                        {doc.missing_codes.length > 0 ? (
                          <span className="ml-2 text-red-500">
                            -{doc.missing_codes.length} недостача
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                        STATUS_CONFIG[doc.status]?.className
                      }`}
                    >
                      {STATUS_CONFIG[doc.status]?.label}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {selected ? (
          <div className="card-panel p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold text-forest-950">№ {selected.document_number}</h3>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-sage-400 hover:text-sage-600"
              >
                ✕
              </button>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-sage-500">Поставщик</p>
                <p className="font-medium">{selected.seller_name || "—"}</p>
              </div>
              <div>
                <p className="text-sage-500">ИНН</p>
                <p className="font-medium">{selected.seller_inn || "—"}</p>
              </div>
              <div>
                <p className="text-sage-500">Кодов в документе</p>
                <p className="font-medium">{selected.document_codes.length}</p>
              </div>
              <div>
                <p className="text-sage-500">Дата</p>
                <p className="font-medium">{selected.document_date || "—"}</p>
              </div>
            </div>

            {selected.status === "checked" ? (
              <div className="mb-4 space-y-2">
                {selected.extra_codes.length > 0 ? (
                  <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                    <p className="font-medium text-amber-700">
                      Лишние коды ({selected.extra_codes.length}) — есть в сканировании, нет в
                      документе:
                    </p>
                    <p className="mt-1 font-mono text-amber-600">
                      {selected.extra_codes
                        .slice(0, 3)
                        .map((code) => code.slice(0, 30))
                        .join(", ")}
                      {selected.extra_codes.length > 3 ? "..." : ""}
                    </p>
                  </div>
                ) : null}
                {selected.missing_codes.length > 0 ? (
                  <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs">
                    <p className="font-medium text-red-700">
                      Недостача ({selected.missing_codes.length}) — есть в документе, нет в
                      сканировании:
                    </p>
                    <p className="mt-1 font-mono text-red-600">
                      {selected.missing_codes
                        .slice(0, 3)
                        .map((code) => code.slice(0, 30))
                        .join(", ")}
                      {selected.missing_codes.length > 3 ? "..." : ""}
                    </p>
                  </div>
                ) : null}
                {selected.duplicate_codes.length > 0 ? (
                  <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs">
                    <p className="font-medium text-red-700">
                      Дубликаты ({selected.duplicate_codes.length}):
                    </p>
                    <p className="mt-1 font-mono text-red-600">
                      {selected.duplicate_codes
                        .slice(0, 3)
                        .map((code) => code.slice(0, 30))
                        .join(", ")}
                    </p>
                  </div>
                ) : null}
                {selected.extra_codes.length === 0 &&
                selected.missing_codes.length === 0 &&
                selected.duplicate_codes.length === 0 ? (
                  <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                    Все коды совпадают — расхождений нет
                  </div>
                ) : null}
              </div>
            ) : null}

            {selected.status === "pending" ? (
              <div className="mb-4">
                <label className="mb-1.5 flex flex-col gap-1.5">
                  <span className="label-text">
                    Введите отсканированные коды (по одному на строку)
                  </span>
                  <textarea
                    value={scannedText}
                    onChange={(event) => setScannedText(event.target.value)}
                    rows={6}
                    className="input-field font-mono text-xs"
                    placeholder="Сканируйте коды или вставьте из файла..."
                  />
                </label>
                <p className="text-xs text-sage-400">Отсканировано: {scannedCount}</p>
                <button
                  type="button"
                  onClick={() => void handleScan()}
                  className="btn-primary mt-2"
                >
                  Сверить с документом
                </button>
              </div>
            ) : null}

            {selected.status === "checked" || selected.status === "pending" ? (
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => void handleAccept()}
                  className="btn-primary flex-1 !bg-emerald-600 hover:!bg-emerald-700"
                >
                  ✓ Принять
                </button>
                <button
                  type="button"
                  onClick={() => void handleReject()}
                  className="btn-secondary flex-1 !border-red-200 !bg-red-50 !text-red-700 hover:!bg-red-100"
                >
                  ✕ Отклонить
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="card-panel flex items-center justify-center p-8 text-sage-400">
            Выберите документ для просмотра и сверки
          </div>
        )}
      </div>
    </div>
  );
}
