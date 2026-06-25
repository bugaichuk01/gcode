import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Send, X } from "lucide-react";
import Alert from "../components/ui/Alert";
import { useCisStatusCheck } from "../hooks/useCisStatusCheck";
import {
  createAggregationDraft,
  createSetAggregationDraft,
  createUtilisationDraft,
  sendAggregationDocument,
  sendIntroduceGoodsDocument,
  sendSetAggregationDocument,
  sendUtilisationDocument,
} from "../services/chzDocumentSend";
import apiClient from "../api/client";
import { CIS_STATUS_LABELS, formatCisStatusLabel } from "../utils/cisStatus";
import { hasCryptoTail } from "../utils/markingCode";

export type ConveyorActionType =
  | "utilisation"
  | "introduce"
  | "aggregation"
  | "set_formation";

type PipelineStatus = "idle" | "waiting" | "success" | "error";

export interface ConveyorAction {
  id: string;
  type: ConveyorActionType | "";
  utilisationParams: {
    useProductionDateFromTable: boolean;
    productionDate: string;
    specifyExpiry: boolean;
  };
  aggregationParams: {
    kituCode: string;
  };
  setFormationParams: {
    productCardId: string;
    setCode: string;
  };
  introduceParams: {
    documentType: string;
    productionDate: string;
    useProductionDateFromTable: boolean;
    tnved: string;
    fillTnvedFromCards: boolean;
    fillCertificateFromCards: boolean;
  };
  pipelineStatus: PipelineStatus;
  pipelineMessage: string | null;
}

const ACTION_OPTIONS: {
  value: ConveyorActionType;
  label: string;
  disabled?: boolean;
  disabledLabel?: string;
}[] = [
  { value: "utilisation", label: "Нанесение" },
  { value: "introduce", label: "Ввод в оборот" },
  { value: "aggregation", label: "Формирование упаковки" },
  { value: "set_formation", label: "Формирование набора" },
];

const DISABLED_ACTION_TYPES = new Set<ConveyorActionType>();

function createEmptyAction(defaultKituCode: string): ConveyorAction {
  return {
    id: crypto.randomUUID(),
    type: "",
    utilisationParams: {
      useProductionDateFromTable: false,
      productionDate: new Date().toISOString().slice(0, 10),
      specifyExpiry: false,
    },
    aggregationParams: {
      kituCode: defaultKituCode,
    },
    setFormationParams: {
      productCardId: "",
      setCode: "",
    },
    introduceParams: {
      documentType: "Производство РФ",
      productionDate: new Date().toISOString().slice(0, 10),
      useProductionDateFromTable: false,
      tnved: "",
      fillTnvedFromCards: false,
      fillCertificateFromCards: false,
    },
    pipelineStatus: "idle",
    pipelineMessage: null,
  };
}

const pipelineStatusConfig: Record<
  PipelineStatus,
  { label: string; className: string }
> = {
  idle: { label: "Ожидание", className: "badge-draft" },
  waiting: { label: "Выполняется...", className: "badge-warning" },
  success: { label: "Успех", className: "badge-success" },
  error: { label: "Ошибка", className: "badge-error" },
};

export interface ChzConveyorTabProps {
  markingCodes: string[];
  kituCodes: string[];
  defaultKituCode: string;
  productGroup: string;
}

interface BundleCardOption {
  id: string;
  name: string;
  gtin: string | null;
  set_items: Array<{ gtin: string; quantity: number }>;
}

function isBundleCard(card: { is_set?: boolean; type?: string }): boolean {
  return Boolean(card.is_set || card.type === "set" || card.type === "bundle");
}

export default function ChzConveyorTab({
  markingCodes,
  kituCodes,
  defaultKituCode,
  productGroup,
}: ChzConveyorTabProps) {
  const [actions, setActions] = useState<ConveyorAction[]>(() => [
    createEmptyAction(defaultKituCode),
  ]);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [pipelineSuccess, setPipelineSuccess] = useState<string | null>(null);
  const [bundleCards, setBundleCards] = useState<BundleCardOption[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiClient.get<
          Array<Record<string, unknown>> | { items: Array<Record<string, unknown>> }
        >("/product-cards/", { params: { limit: 1000, offset: 0 } });
        const raw = res.data;
        const list = Array.isArray(raw) ? raw : (raw.items ?? []);
        const bundles = list
          .filter((card) => isBundleCard(card as { is_set?: boolean; type?: string }))
          .map((card) => ({
            id: String(card.id),
            name: String(card.name ?? ""),
            gtin: (card.gtin as string | null | undefined) ?? null,
            set_items: Array.isArray(card.set_items)
              ? card.set_items.map((it: { gtin?: unknown; quantity?: unknown }) => ({
                  gtin: String(it.gtin ?? ""),
                  quantity: Number(it.quantity ?? 1),
                }))
              : [],
          }));
        setBundleCards(bundles);
      } catch {
        setBundleCards([]);
      }
    })();
  }, []);

  const {
    checking,
    checkedCount,
    results: statusResults,
    error: statusCheckError,
    setError: setStatusCheckError,
    checkStatus,
  } = useCisStatusCheck();

  const overviewCodes = useMemo(() => {
    const codes = [...markingCodes];
    kituCodes.forEach((kitu) => {
      if (!codes.includes(kitu)) {
        codes.push(kitu);
      }
    });
    return codes;
  }, [markingCodes, kituCodes]);

  useEffect(() => {
    if (!defaultKituCode) {
      return;
    }
    setActions((prev) =>
      prev.map((action) =>
        action.aggregationParams.kituCode
          ? action
          : {
              ...action,
              aggregationParams: { kituCode: defaultKituCode },
            },
      ),
    );
  }, [defaultKituCode]);

  const updateAction = useCallback((id: string, patch: Partial<ConveyorAction>) => {
    setActions((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

  function handleAddAction() {
    setActions((prev) => [...prev, createEmptyAction(defaultKituCode)]);
  }

  function handleRemoveAction(id: string) {
    setActions((prev) => (prev.length <= 1 ? prev : prev.filter((a) => a.id !== id)));
  }

  function handleActionTypeChange(id: string, type: ConveyorActionType | "") {
    if (type && DISABLED_ACTION_TYPES.has(type)) {
      return;
    }
    updateAction(id, { type, pipelineStatus: "idle", pipelineMessage: null });
  }

  async function executeAction(action: ConveyorAction): Promise<void> {
    if (!action.type || DISABLED_ACTION_TYPES.has(action.type)) {
      throw new Error("Действие недоступно");
    }

    if (action.type === "utilisation") {
      if (markingCodes.length === 0) {
        throw new Error("Нет кодов маркировки для нанесения");
      }
      const invalid = markingCodes.filter((c) => !hasCryptoTail(c));
      if (invalid.length > 0) {
        throw new Error(
          `Некорректные коды без криптохвоста: ${invalid.slice(0, 2).join(", ")}`,
        );
      }
      const draft = await createUtilisationDraft(markingCodes, productGroup);
      const result = await sendUtilisationDocument(draft.id);
      if (result.status === "error" || result.status === "rejected") {
        throw new Error(result.error_message || "СУЗ отклонил отчёт о нанесении");
      }
      return;
    }

    if (action.type === "aggregation") {
      const kitu = action.aggregationParams.kituCode.trim() || defaultKituCode;
      if (!kitu) {
        throw new Error("Укажите код КИТУ для формирования упаковки");
      }
      if (markingCodes.length < 2) {
        throw new Error("Для агрегации нужно минимум 2 кода маркировки");
      }
      const draft = await createAggregationDraft(markingCodes, productGroup, kitu);
      const result = await sendAggregationDocument(draft.id);
      if (result.status === "error" || result.status === "rejected") {
        throw new Error(result.error_message || "СУЗ отклонил документ агрегации");
      }
      return;
    }

    if (action.type === "set_formation") {
      const { productCardId, setCode } = action.setFormationParams;
      if (!productCardId) {
        throw new Error("Выберите карточку набора");
      }
      if (!setCode.trim()) {
        throw new Error("Укажите код набора (КИН) для unitSerialNumber");
      }
      if (markingCodes.length === 0) {
        throw new Error("Нет кодов вложений для формирования набора");
      }
      const draft = await createSetAggregationDraft({
        markingCodes,
        productGroup,
        setCode: setCode.trim(),
        productCardId,
      });
      const result = await sendSetAggregationDocument(draft.id);
      if (result.status === "error" || result.status === "rejected") {
        throw new Error(result.error_message || "СУЗ отклонил документ формирования набора");
      }
      return;
    }

    if (action.type === "introduce") {
      if (markingCodes.length === 0) {
        throw new Error("Нет кодов маркировки для ввода в оборот");
      }
      const invalid = markingCodes.filter((c) => !hasCryptoTail(c));
      if (invalid.length > 0) {
        throw new Error(
          `Некорректные коды без криптохвоста: ${invalid.slice(0, 2).join(", ")}`,
        );
      }
      const { introduceParams } = action;
      if (!introduceParams.fillTnvedFromCards && !introduceParams.tnved.trim()) {
        throw new Error("Укажите ТНВЭД или включите заполнение из карточек");
      }
      const productionDate = introduceParams.useProductionDateFromTable
        ? null
        : introduceParams.productionDate || null;
      const result = await sendIntroduceGoodsDocument(markingCodes, productGroup, {
        productionDate,
        defaultTnvedCode: introduceParams.tnved.trim() || undefined,
        fillTnvedFromCards: introduceParams.fillTnvedFromCards,
        fillCertificateFromCards: introduceParams.fillCertificateFromCards,
      });
      if (!result.success) {
        throw new Error("True API отклонил документ ввода в оборот");
      }
      return;
    }

    throw new Error("Тип действия не поддерживается");
  }

  async function handleSendPipeline() {
    const currentActions = actions;
    const configured = currentActions.filter((a) => a.type);
    if (configured.length === 0) {
      setPipelineError("Добавьте хотя бы одно действие с выбранным типом");
      return;
    }

    const hasDisabled = configured.some(
      (a) => a.type && DISABLED_ACTION_TYPES.has(a.type),
    );
    if (hasDisabled) {
      setPipelineError("Конвейер содержит недоступные действия");
      return;
    }

    setPipelineRunning(true);
    setPipelineError(null);
    setPipelineSuccess(null);
    setActions((prev) =>
      prev.map((a) => ({ ...a, pipelineStatus: "idle" as PipelineStatus, pipelineMessage: null })),
    );

    for (let i = 0; i < currentActions.length; i++) {
      const action = currentActions[i];
      if (!action.type) {
        continue;
      }

      const actionIndex = i + 1;
      setActions((prev) =>
        prev.map((a) =>
          a.id === action.id
            ? { ...a, pipelineStatus: "waiting", pipelineMessage: "Формирование и отправка..." }
            : a,
        ),
      );

      try {
        await executeAction(action);
        setActions((prev) =>
          prev.map((a) =>
            a.id === action.id
              ? { ...a, pipelineStatus: "success", pipelineMessage: "Документ принят" }
              : a,
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Ошибка выполнения";
        setActions((prev) =>
          prev.map((a) =>
            a.id === action.id ? { ...a, pipelineStatus: "error", pipelineMessage: message } : a,
          ),
        );
        setPipelineError(`Остановлено на действии ${actionIndex}: ${message}`);
        setPipelineRunning(false);
        return;
      }
    }

    setPipelineSuccess(`Конвейер выполнен: ${configured.length} документ(ов) отправлено в ГИС МТ`);
    setPipelineRunning(false);
  }

  async function handleCheckStatuses() {
    if (overviewCodes.length === 0) {
      setStatusCheckError("Нет кодов для проверки");
      return;
    }
    setStatusCheckError(null);
    await checkStatus(overviewCodes);
  }

  return (
    <div className="mb-8">
      <div className="mb-4 rounded-xl border border-forest-200 bg-forest-50/80 px-4 py-3 text-sm text-forest-800">
        <strong>Работа с ЧЗ</strong> — конвейер действий: каждый шаг формирует отдельный документ
        и отправляется в ГИС МТ по порядку после успеха предыдущего. Нанесение и агрегация — через
        СУЗ-токен; ввод в оборот — через True API. Подпись CryptoPro.
      </div>

      {pipelineError ? (
        <Alert variant="error" onDismiss={() => setPipelineError(null)} className="mb-4">
          {pipelineError}
        </Alert>
      ) : null}
      {pipelineSuccess ? (
        <Alert variant="success" onDismiss={() => setPipelineSuccess(null)} className="mb-4">
          {pipelineSuccess}
        </Alert>
      ) : null}
      {statusCheckError ? (
        <Alert variant="error" onDismiss={() => setStatusCheckError(null)} className="mb-4">
          {statusCheckError}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-sage-900">Действия</h2>
            <button
              type="button"
              onClick={handleAddAction}
              disabled={pipelineRunning}
              className="btn-secondary btn-sm"
            >
              <Plus className="h-4 w-4" />
              Добавить
            </button>
          </div>

          {actions.map((action, index) => (
            <div key={action.id} className="card relative">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-sage-900">Действие {index + 1}</h3>
                <div className="flex items-center gap-2">
                  <span className={pipelineStatusConfig[action.pipelineStatus].className}>
                    {pipelineStatusConfig[action.pipelineStatus].label}
                  </span>
                  {index > 0 ? (
                    <button
                      type="button"
                      onClick={() => handleRemoveAction(action.id)}
                      disabled={pipelineRunning}
                      className="rounded p-1 text-sage-400 hover:bg-red-50 hover:text-red-500"
                      aria-label={`Удалить действие ${index + 1}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-sage-600">
                  Выберите действие
                </label>
                <select
                  value={action.type}
                  onChange={(e) =>
                    handleActionTypeChange(action.id, e.target.value as ConveyorActionType | "")
                  }
                  disabled={pipelineRunning}
                  className="select-field text-sm"
                >
                  <option value="">— выберите —</option>
                  {ACTION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                      {opt.label}
                      {opt.disabled ? ` (${opt.disabledLabel})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {action.type === "utilisation" ? (
                <div className="space-y-3 border-t border-sage-100 pt-3">
                  <label className="flex items-center gap-2 text-sm text-sage-700">
                    <input
                      type="checkbox"
                      checked={action.utilisationParams.useProductionDateFromTable}
                      onChange={(e) =>
                        updateAction(action.id, {
                          utilisationParams: {
                            ...action.utilisationParams,
                            useProductionDateFromTable: e.target.checked,
                          },
                        })
                      }
                      disabled={pipelineRunning}
                      className="rounded border-sage-300"
                    />
                    Брать дату производства из таблицы
                  </label>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-sage-600">
                      Дата производства
                    </label>
                    <input
                      type="date"
                      value={action.utilisationParams.productionDate}
                      onChange={(e) =>
                        updateAction(action.id, {
                          utilisationParams: {
                            ...action.utilisationParams,
                            productionDate: e.target.value,
                          },
                        })
                      }
                      disabled={
                        pipelineRunning || action.utilisationParams.useProductionDateFromTable
                      }
                      className="input-field text-sm disabled:opacity-50"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-sage-700">
                    <input
                      type="checkbox"
                      checked={action.utilisationParams.specifyExpiry}
                      onChange={(e) =>
                        updateAction(action.id, {
                          utilisationParams: {
                            ...action.utilisationParams,
                            specifyExpiry: e.target.checked,
                          },
                        })
                      }
                      disabled={pipelineRunning}
                      className="rounded border-sage-300"
                    />
                    Указать срок годности
                  </label>
                  <p className="text-xs text-sage-400">
                    Кодов в сессии: {markingCodes.length}. Товарная группа: {productGroup}.
                  </p>
                </div>
              ) : null}

              {action.type === "aggregation" ? (
                <div className="space-y-3 border-t border-sage-100 pt-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-sage-600">
                      КИТУ (SSCC)
                    </label>
                    {kituCodes.length > 0 ? (
                      <select
                        value={action.aggregationParams.kituCode}
                        onChange={(e) =>
                          updateAction(action.id, {
                            aggregationParams: { kituCode: e.target.value },
                          })
                        }
                        disabled={pipelineRunning}
                        className="select-field font-mono text-sm"
                      >
                        {kituCodes.map((kitu) => (
                          <option key={kitu} value={kitu}>
                            {kitu}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={action.aggregationParams.kituCode}
                        onChange={(e) =>
                          updateAction(action.id, {
                            aggregationParams: { kituCode: e.target.value },
                          })
                        }
                        disabled={pipelineRunning}
                        placeholder="Код КИТУ"
                        className="input-field font-mono text-sm"
                      />
                    )}
                  </div>
                  <p className="text-xs text-sage-400">
                    КМ для упаковки: {markingCodes.length}. Товарная группа: {productGroup}.
                  </p>
                </div>
              ) : null}

              {action.type === "introduce" ? (
                <div className="space-y-3 border-t border-sage-100 pt-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-sage-600">
                      Вид документа
                    </label>
                    <input
                      type="text"
                      value={action.introduceParams.documentType}
                      disabled
                      className="input-field text-sm disabled:opacity-70"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-sage-700">
                    <input
                      type="checkbox"
                      checked={action.introduceParams.useProductionDateFromTable}
                      onChange={(e) =>
                        updateAction(action.id, {
                          introduceParams: {
                            ...action.introduceParams,
                            useProductionDateFromTable: e.target.checked,
                          },
                        })
                      }
                      disabled={pipelineRunning}
                      className="rounded border-sage-300"
                    />
                    Брать дату производства из таблицы
                  </label>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-sage-600">
                      Дата производства
                    </label>
                    <input
                      type="date"
                      value={action.introduceParams.productionDate}
                      onChange={(e) =>
                        updateAction(action.id, {
                          introduceParams: {
                            ...action.introduceParams,
                            productionDate: e.target.value,
                          },
                        })
                      }
                      disabled={
                        pipelineRunning || action.introduceParams.useProductionDateFromTable
                      }
                      className="input-field text-sm disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-sage-600">ТНВЭД</label>
                    <input
                      type="text"
                      value={action.introduceParams.tnved}
                      onChange={(e) =>
                        updateAction(action.id, {
                          introduceParams: {
                            ...action.introduceParams,
                            tnved: e.target.value,
                          },
                        })
                      }
                      disabled={pipelineRunning || action.introduceParams.fillTnvedFromCards}
                      placeholder="0000000000"
                      className="input-field text-sm disabled:opacity-50"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-sage-700">
                    <input
                      type="checkbox"
                      checked={action.introduceParams.fillTnvedFromCards}
                      onChange={(e) =>
                        updateAction(action.id, {
                          introduceParams: {
                            ...action.introduceParams,
                            fillTnvedFromCards: e.target.checked,
                          },
                        })
                      }
                      disabled={pipelineRunning}
                      className="rounded border-sage-300"
                    />
                    Заполнить ТНВЭД из карточек
                  </label>
                  <label className="flex items-center gap-2 text-sm text-sage-700">
                    <input
                      type="checkbox"
                      checked={action.introduceParams.fillCertificateFromCards}
                      onChange={(e) =>
                        updateAction(action.id, {
                          introduceParams: {
                            ...action.introduceParams,
                            fillCertificateFromCards: e.target.checked,
                          },
                        })
                      }
                      disabled={pipelineRunning}
                      className="rounded border-sage-300"
                    />
                    Документ соответствия / Заполнение из карточек
                  </label>
                  <p className="text-xs text-sage-400">
                    Кодов в сессии: {markingCodes.length}. Товарная группа: {productGroup}.
                  </p>
                </div>
              ) : null}

              {action.type === "set_formation" ? (
                <div className="space-y-3 border-t border-sage-100 pt-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-sage-600">
                      Карточка набора
                    </label>
                    <select
                      value={action.setFormationParams.productCardId}
                      onChange={(e) =>
                        updateAction(action.id, {
                          setFormationParams: {
                            ...action.setFormationParams,
                            productCardId: e.target.value,
                          },
                        })
                      }
                      disabled={pipelineRunning}
                      className="select-field text-sm"
                    >
                      <option value="">— выберите набор —</option>
                      {bundleCards.map((card) => (
                        <option key={card.id} value={card.id}>
                          {card.name}
                          {card.gtin ? ` (${card.gtin})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  {action.setFormationParams.productCardId ? (
                    <p className="text-xs text-sage-500">
                      Состав по карточке:{" "}
                      {bundleCards
                        .find((c) => c.id === action.setFormationParams.productCardId)
                        ?.set_items.map((it) => `${it.gtin}×${it.quantity}`)
                        .join(", ") || "—"}
                    </p>
                  ) : null}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-sage-600">
                      Код набора (КИН)
                    </label>
                    <input
                      type="text"
                      value={action.setFormationParams.setCode}
                      onChange={(e) =>
                        updateAction(action.id, {
                          setFormationParams: {
                            ...action.setFormationParams,
                            setCode: e.target.value,
                          },
                        })
                      }
                      disabled={pipelineRunning}
                      placeholder="КМ набора (unitSerialNumber)"
                      className="input-field font-mono text-sm"
                    />
                  </div>
                  <p className="text-xs text-sage-400">
                    Вложения (КМ) из сессии: {markingCodes.length}. Сканер вложений — P6.8.
                    Набор при успехе автоматически вводится в оборот.
                  </p>
                </div>
              ) : null}

              {action.pipelineMessage ? (
                <p
                  className={`mt-3 text-xs ${
                    action.pipelineStatus === "error" ? "text-red-600" : "text-sage-500"
                  }`}
                >
                  {action.pipelineMessage}
                </p>
              ) : null}
            </div>
          ))}

          <button
            type="button"
            onClick={() => void handleSendPipeline()}
            disabled={pipelineRunning}
            className="btn-accent w-full"
          >
            <Send className="h-4 w-4" />
            {pipelineRunning ? "Отправка в ГИС МТ..." : "Отправить В ГИС МТ"}
          </button>
        </div>

        <div className="lg:col-span-3">
          <div className="card">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-sage-900">Обзор кодов</h2>
              <button
                type="button"
                onClick={() => void handleCheckStatuses()}
                disabled={checking || overviewCodes.length === 0}
                className="btn-secondary btn-sm"
              >
                {checking
                  ? `Проверка... (${checkedCount}/${overviewCodes.length})`
                  : "Проверить Статус"}
              </button>
            </div>

            <p className="mb-4 text-xs text-sage-500">
              Коды из текущей сессии агрегации: КМ ({markingCodes.length}) и КИТУ (
              {kituCodes.length}).
            </p>

            <div className="table-container max-h-[480px] overflow-y-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="w-12">№</th>
                    <th>Код / КИТУ</th>
                    <th>Тип</th>
                    <th>Статус в ЧЗ</th>
                  </tr>
                </thead>
                <tbody>
                  {overviewCodes.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-sage-400">
                        Нет кодов в сессии. Добавьте КМ на вкладке «Агрегация» или в форме
                        упаковки.
                      </td>
                    </tr>
                  ) : (
                    overviewCodes.map((code, idx) => {
                      const isKitu = kituCodes.includes(code);
                      const statusFields = statusResults[code];
                      const statusKey = statusFields?.status ?? "";
                      const statusMeta = CIS_STATUS_LABELS[statusKey];
                      return (
                        <tr key={`${code}-${idx}`}>
                          <td className="text-sage-500">{idx + 1}</td>
                          <td className="max-w-xs break-all font-mono text-xs">{code}</td>
                          <td className="text-xs">{isKitu ? "КИТУ" : "КМ"}</td>
                          <td>
                            {statusFields ? (
                              <span className={statusMeta?.className ?? "badge-draft"}>
                                {formatCisStatusLabel(statusKey)}
                              </span>
                            ) : (
                              <span className="text-xs text-sage-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
