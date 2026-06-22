import { FormEvent, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import axios from "axios";
import apiClient from "../api/client";
import PageHeader from "../components/ui/PageHeader";
import Alert from "../components/ui/Alert";
import {
  checkPluginStatus,
  getUserCertificates,
  signData,
  type UserCertificate,
} from "../services/cryptoPro";

type EdoTypeApi = "edo_lite" | "commercial_edo";

type CreateUpdResponse = {
  id?: string | number;
  message?: string;
  edo_type?: EdoTypeApi;
};

type UpdListItem = {
  id: string;
  document_number: string;
  status: string;
  marking_codes: string[];
  created_at: string;
};

type SendUpdRequest = {
  signature: {
    format: "detached_cms_base64";
    value: string;
    thumbprint: string;
    signed_at: string;
    metadata: Record<string, string>;
  };
};

const CRYPTO_PLUGIN_ERROR =
  "Проверьте, подключен ли у вас плагин в браузере (КриптоПро ЭЦП Browser plug-in). Для корректной работы рекомендуем использовать Яндекс Браузер или Chromium GOST.";

export default function UpdPage() {
  const [documentNumber, setDocumentNumber] = useState("");
  const [markingCodes, setMarkingCodes] = useState("");
  const [preloadedCodesCount, setPreloadedCodesCount] = useState(0);
  const [disableOwnerControl, setDisableOwnerControl] = useState(false);
  const [edoType, setEdoType] = useState<EdoTypeApi>("edo_lite");
  const [sellerInn, setSellerInn] = useState("");
  const [sellerKpp, setSellerKpp] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [sellerAddress, setSellerAddress] = useState("");
  const [buyerInn, setBuyerInn] = useState("");
  const [buyerKpp, setBuyerKpp] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isPluginChecking, setIsPluginChecking] = useState(false);
  const [isCertificatesLoading, setIsCertificatesLoading] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [certificates, setCertificates] = useState<UserCertificate[]>([]);
  const [selectedThumbprint, setSelectedThumbprint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | number | null>(null);
  const [upds, setUpds] = useState<UpdListItem[]>([]);

  useEffect(() => {
    const stored = sessionStorage.getItem("updCodes");
    if (stored) {
      const codes = JSON.parse(stored) as string[];
      setMarkingCodes(codes.join("\n"));
      setPreloadedCodesCount(codes.length);
      sessionStorage.removeItem("updCodes");

      if (codes.length > 0) {
        const firstCode = codes[0];
        const match = firstCode.match(/^01(\d{14})/);
        if (match) {
          const gtin = match[1];
          apiClient
            .get<{ items: Array<{ edo_inn?: string; edo_kpp?: string; edo_address?: string }> }>(
              `/extra-fields/?gtin=${gtin}`,
            )
            .then((res) => {
              const items = res.data.items;
              if (items.length > 0) {
                const f = items[0];
                if (f.edo_inn) setSellerInn(f.edo_inn);
                if (f.edo_kpp) setSellerKpp(f.edo_kpp);
                if (f.edo_address) setSellerAddress(f.edo_address);
              }
            })
            .catch(() => {});
        }
      }
    }
  }, []);

  async function loadUpds() {
    try {
      const res = await apiClient.get<UpdListItem[]>("/upd/list");
      setUpds(res.data);
    } catch {

    }
  }

  useEffect(() => {
    void loadUpds();
  }, []);

  function getMarkingCodes(): string[] {
    return markingCodes
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async function handleCreateUpd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreating(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = {
        document_number: documentNumber.trim(),
        marking_codes: getMarkingCodes(),
        disable_owner_control: disableOwnerControl,
        edo_type: edoType,
        seller_inn: sellerInn || undefined,
        seller_kpp: sellerKpp || undefined,
        seller_name: sellerName || undefined,
        seller_address: sellerAddress || undefined,
        buyer_inn: buyerInn || undefined,
        buyer_kpp: buyerKpp || undefined,
        buyer_name: buyerName || undefined,
        buyer_address: buyerAddress || undefined,
      };
      const response = await apiClient.post<CreateUpdResponse>("/upd/create", payload);
      const createdId = response.data?.id ?? null;
      setDraftId(createdId);
      setCertificates([]);
      setSelectedThumbprint("");
      setSuccess(
        createdId
          ? `Черновик УПД создан (ID: ${String(createdId)}).`
          : "Черновик УПД успешно создан.",
      );
      await loadUpds();
    } catch (requestError) {
      console.error("Failed to create UPD:", requestError);
      setError("Не удалось создать УПД. Проверьте данные формы.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleSignAndSend() {
    if (!draftId) {
      setError("Сначала создайте УПД, чтобы подписать и отправить документ.");
      return;
    }

    setIsPluginChecking(true);
    setIsCertificatesLoading(true);
    setError(null);
    setSuccess(null);
    setCertificates([]);
    setSelectedThumbprint("");

    const pluginStatus = await checkPluginStatus();
    if (!pluginStatus.installed) {
      setError(pluginStatus.hint ?? CRYPTO_PLUGIN_ERROR);
      setIsPluginChecking(false);
      setIsCertificatesLoading(false);
      return;
    }

    try {
      const availableCertificates = await getUserCertificates();
      if (availableCertificates.length === 0) {
        setError("Доступные сертификаты не найдены. Вставьте токен и повторите попытку.");
        return;
      }

      setCertificates(availableCertificates);
      setSelectedThumbprint(availableCertificates[0].thumbprint);
      setSuccess("Плагин найден. Выберите сертификат для подписи.");
    } catch (pluginError) {
      setError(pluginError instanceof Error ? pluginError.message : CRYPTO_PLUGIN_ERROR);
    } finally {
      setIsPluginChecking(false);
      setIsCertificatesLoading(false);
    }
  }

  async function handleConfirmSigning() {
    if (!draftId) {
      setError("Сначала создайте УПД, чтобы подписать документ.");
      return;
    }

    if (!selectedThumbprint) {
      setError("Выберите сертификат для подписи.");
      return;
    }

    setIsSigning(true);
    setError(null);
    setSuccess(null);

    try {
      const xmlResponse = await apiClient.get<Blob>(`/upd/${String(draftId)}/download-xml`, {
        responseType: "blob",
      });
      const xmlString = await xmlResponse.data.text();
      const signature = await signData(selectedThumbprint, xmlString);
      const sendPayload: SendUpdRequest = { signature };
      await apiClient.post(`/upd/${String(draftId)}/send`, sendPayload);
      setSuccess(
        edoType === "edo_lite"
          ? "Документ подписан и успешно отправлен в ЭДО Лайт."
          : "Документ подписан и передан в обработчик коммерческого ЭДО.",
      );
    } catch (signError) {
      if (axios.isAxiosError(signError) && signError.response?.status === 404) {
        setError("Черновик УПД не найден.");
        return;
      }

      if (axios.isAxiosError(signError) && signError.response?.status === 502) {
        setError("Не удалось отправить документ в ЭДО. Попробуйте позже.");
        return;
      }

      if (axios.isAxiosError(signError) && signError.response?.status === 422) {
        setError(
          typeof signError.response?.data?.detail === "string"
            ? signError.response.data.detail
            : "Некорректный payload подписи. Проверьте сертификат и повторите попытку.",
        );
        return;
      }

      setError(
        signError instanceof Error
          ? signError.message
          : "Не удалось подписать документ. Проверьте сертификат и токен.",
      );
    } finally {
      setIsSigning(false);
    }
  }

  async function handleSaveDraftXml() {
    if (!draftId) {
      setError("Сначала создайте УПД, чтобы скачать XML-черновик.");
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const response = await apiClient.get<Blob>(`/upd/${String(draftId)}/download-xml`, {
        responseType: "blob",
      });

      const blob = new Blob([response.data], { type: "application/xml" });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = "upd_draft.xml";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);

      setSuccess("XML-черновик успешно скачан.");
    } catch (requestError) {
      console.error("Failed to download XML draft:", requestError);
      if (axios.isAxiosError(requestError) && requestError.response?.status === 404) {
        setError("Черновик УПД не найден.");
        return;
      }
      setError("Не удалось скачать XML-черновик.");
    }
  }

  return (
    <div className="page-container">
      <PageHeader
        title="Документы УПД"
        description="Формирование УПД, выбор типа ЭДО и дальнейшие действия с черновиком."
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

      <section className="card mb-8 p-6">
        <h2 className="text-lg font-semibold text-forest-950">Создание УПД на отгрузку</h2>

        {preloadedCodesCount > 0 && (
          <Alert variant="info" className="mt-4">
            Загружено {preloadedCodesCount} кодов маркировки из реестра
          </Alert>
        )}

        <form className="mt-5 space-y-5" onSubmit={handleCreateUpd}>
          <label className="flex flex-col gap-1.5">
            <span className="label-text">Номер документа</span>
            <input
              required
              value={documentNumber}
              onChange={(event) => setDocumentNumber(event.target.value)}
              className="input-field"
              placeholder="УПД-0047 от 19.04.2026"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="label-text">Коды маркировки (каждый код с новой строки)</span>
            <textarea
              required
              value={markingCodes}
              onChange={(event) => setMarkingCodes(event.target.value)}
              rows={8}
              className="input-field resize-y font-mono text-xs !min-h-[160px] !py-3"
              placeholder={
                "0104601234567890215ABC123DEF4567821\n0104601234567890215XYZ98765432109812"
              }
            />
          </label>

          <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={disableOwnerControl}
              onChange={(event) => setDisableOwnerControl(event.target.checked)}
              className="checkbox-field"
            />
            <span className="text-sm text-sage-700">Отключить контроль владельца</span>
          </label>

          <fieldset className="space-y-3 rounded-xl border border-forest-100 bg-forest-50/40 p-4">
            <legend className="px-1 text-sm font-semibold text-forest-900">Тип ЭДО</legend>
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="edoType"
                value="edo_lite"
                checked={edoType === "edo_lite"}
                onChange={() => setEdoType("edo_lite")}
                className="h-4 w-4 border-sage-300 text-forest-700 focus:ring-forest-500"
              />
              <span className="text-sm text-sage-700">ЭДО Лайт</span>
            </label>
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="edoType"
                value="commercial_edo"
                checked={edoType === "commercial_edo"}
                onChange={() => setEdoType("commercial_edo")}
                className="h-4 w-4 border-sage-300 text-forest-700 focus:ring-forest-500"
              />
              <span className="text-sm text-sage-700">Коммерческое ЭДО</span>
            </label>
          </fieldset>

          <div className="rounded-xl border border-forest-100 bg-white p-4 space-y-3">
            <h3 className="text-sm font-semibold text-forest-900">Продавец</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="label-text">ИНН</span>
                <input
                  type="text"
                  value={sellerInn}
                  onChange={(e) => setSellerInn(e.target.value)}
                  placeholder="10 или 12 цифр"
                  className="input-field"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="label-text">КПП</span>
                <input
                  type="text"
                  value={sellerKpp}
                  onChange={(e) => setSellerKpp(e.target.value)}
                  placeholder="9 цифр"
                  className="input-field"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="label-text">Наименование организации</span>
              <input
                type="text"
                value={sellerName}
                onChange={(e) => setSellerName(e.target.value)}
                className="input-field"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label-text">Адрес</span>
              <input
                type="text"
                value={sellerAddress}
                onChange={(e) => setSellerAddress(e.target.value)}
                className="input-field"
              />
            </label>
          </div>

          <div className="rounded-xl border border-forest-100 bg-white p-4 space-y-3">
            <h3 className="text-sm font-semibold text-forest-900">Покупатель</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="label-text">ИНН</span>
                <input
                  type="text"
                  value={buyerInn}
                  onChange={(e) => setBuyerInn(e.target.value)}
                  placeholder="10 или 12 цифр"
                  className="input-field"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="label-text">КПП</span>
                <input
                  type="text"
                  value={buyerKpp}
                  onChange={(e) => setBuyerKpp(e.target.value)}
                  placeholder="9 цифр"
                  className="input-field"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="label-text">Наименование организации</span>
              <input
                type="text"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                className="input-field"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label-text">Адрес</span>
              <input
                type="text"
                value={buyerAddress}
                onChange={(e) => setBuyerAddress(e.target.value)}
                className="input-field"
              />
            </label>
          </div>

          <button type="submit" disabled={isCreating} className="btn-primary">
            {isCreating ? <Loader2 size={16} className="animate-spin" /> : null}
            Создать УПД на отгрузку
          </button>
        </form>
      </section>

      <section className="card mb-8 p-6">
        <h2 className="text-lg font-semibold text-forest-950">Дальнейшие действия</h2>
        {draftId ? (
          <p className="mt-1 text-sm text-sage-600">Активный черновик: {String(draftId)}</p>
        ) : (
          <p className="mt-1 text-sm text-sage-600">
            После создания УПД выберите дальнейшее действие.
          </p>
        )}

        <div className="mt-5">
          {edoType === "edo_lite" ? (
            <button
              type="button"
              onClick={() => void handleSignAndSend()}
              disabled={isPluginChecking || isCertificatesLoading || isSigning}
              className="btn-accent"
            >
              {isPluginChecking || isCertificatesLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : null}
              Подписать и отправить
            </button>
          ) : (
            <button type="button" onClick={() => void handleSaveDraftXml()} className="btn-secondary">
              Сохранить черновик в XML
            </button>
          )}
        </div>

        {edoType === "edo_lite" && certificates.length > 0 ? (
          <div className="card-muted mt-5 p-5">
            <p className="text-sm font-semibold text-forest-900">Выберите сертификат для подписи</p>
            <select
              value={selectedThumbprint}
              onChange={(event) => setSelectedThumbprint(event.target.value)}
              className="select-field mt-3"
            >
              {certificates.map((certificate) => (
                <option key={certificate.thumbprint} value={certificate.thumbprint}>
                  {certificate.ownerName} (до {new Date(certificate.validTo).toLocaleDateString("ru-RU")})
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-sage-500">
              Отпечаток:{" "}
              {certificates.find((certificate) => certificate.thumbprint === selectedThumbprint)
                ?.thumbprint ?? "не выбран"}
            </p>
            <button
              type="button"
              onClick={() => void handleConfirmSigning()}
              disabled={isSigning || !selectedThumbprint}
              className="btn-primary mt-4"
            >
              {isSigning ? <Loader2 size={16} className="animate-spin" /> : null}
              Подтвердить подписание
            </button>
          </div>
        ) : null}
      </section>

      {upds.length > 0 && (
        <section>
          <h3 className="mb-4 text-lg font-semibold text-forest-950">Документы УПД</h3>
          <div className="table-container">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Статус</th>
                  <th>Кодов</th>
                  <th>Дата</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {upds.map((upd) => (
                  <tr key={upd.id}>
                    <td>{upd.document_number}</td>
                    <td>
                      <span
                        className={
                          upd.status === "sent"
                            ? "badge-published"
                            : upd.status === "signed"
                              ? "badge-info"
                              : "badge-draft"
                        }
                      >
                        {upd.status === "sent"
                          ? "Отправлен"
                          : upd.status === "signed"
                            ? "Подписан"
                            : "Черновик"}
                      </span>
                    </td>
                    <td>{upd.marking_codes?.length ?? 0}</td>
                    <td>{new Date(upd.created_at).toLocaleDateString("ru-RU")}</td>
                    <td>
                      <a
                        href={`/api/v1/upd/${upd.id}/download-xml`}
                        download
                        className="text-sm font-medium text-forest-700 hover:text-forest-900 hover:underline"
                      >
                        Скачать XML
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
