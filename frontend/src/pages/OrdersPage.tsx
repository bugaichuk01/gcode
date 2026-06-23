import { FormEvent, useEffect, useMemo, useState } from "react";
import PageHeader from "../components/ui/PageHeader";
import Alert from "../components/ui/Alert";
import axios from "axios";
import { Loader2, RefreshCw, X } from "lucide-react";
import apiClient from "../api/client";
import {
  detectSigningBackend,
  getUserCertificates,
  parseCertIndex,
  type SigningBackend,
  type UserCertificate,
} from "../services/signingService";
import { closeEmissionOrder, sendLocalOrderToSuz } from "../services/suzOrderApi";
import { RELEASE_METHOD_LABELS } from "../services/suzGtinRules";
import { useProductGroups } from "../hooks/useProductGroups";
import { TNVED_GROUPS } from "../data/tnvedGroups";

type EmissionOrderStatus =
  | "created"
  | "pending"
  | "available"
  | "exhausted"
  | "closed"
  | "rejected";

type EmissionOrder = {
  id: string;
  product_card_id: string | null;
  gtin: string | null;
  quantity: number;
  status: EmissionOrderStatus;
  suz_order_id: string | null;
  suz_error?: string | null;
  suz_marking_codes?: string[];
};

function getOrderError(order: EmissionOrder): string | null {
  if (order.status !== "rejected") return null;
  return order.suz_error || "Заказ отклонён СУЗ";
}

type SetItemOption = { gtin: string; quantity: number };

type ProductCardOption = {
  id: string;
  name: string;
  gtin: string | null;
  type: string;
  tn_ved: string;
  set_items: SetItemOption[];
};

interface OrderRow {
  cardId: string;
  cardName: string;
  gtin: string;
  quantity: number;
  productGroup: string;
  releaseMethodType: string;
  productionOrderId: string;
  paymentType: number | null;
  _status?: "draft" | "sending" | "sent" | "error";
  _error?: string;
  _suzOrderId?: string;
  _isSetUnit?: boolean;
}

type SuzSyncResult = {
  inserted: number;
  updated: number;
  total_remote: number;
};

type ImportExcelResult = {
  created: number;
  errors: string[];
  orders: Array<{
    row: number;
    order_id: string;
    gtin: string;
    quantity: number;
    product_group: string;
    release_method: string;
    status: string;
  }>;
};

type SuzOrderPayloadPreview = {
  body: Record<string, unknown>;
  body_string: string;
  release_method_type: string;
  allowed_release_method_types: string[];
  gtin: string;
  product_group: string;
  template_id: number;
};

const statusLabel: Record<string, string> = {
  created: "Создан",
  pending: "В ожидании",
  available: "Готов к выдаче",
  exhausted: "Не содержит больше кодов",
  closed: "Закрыт",
  rejected: "Не доступен для работы",
};

const statusColor: Record<string, string> = {
  created: "bg-slate-100 text-slate-700",
  pending: "bg-amber-100 text-amber-700",
  available: "bg-emerald-100 text-emerald-700",
  exhausted: "bg-blue-100 text-blue-700",
  closed: "bg-gray-100 text-gray-500",
  rejected: "bg-red-100 text-red-700",
};

const RELEASE_METHOD_TYPES = [
  { value: "PRODUCTION", label: "Произведён в РФ" },
  { value: "IMPORT", label: "Ввезён в РФ" },
  { value: "REMAINS", label: "Маркировка остатков" },
  { value: "REMARK", label: "Перемаркировка" },
  { value: "COMMISSION", label: "Принят на комиссию от физлица" },
  { value: "REAPPLY", label: "Маркировка вне производства" },
];

export default function OrdersPage() {
  const [orders, setOrders] = useState<EmissionOrder[]>([]);
  const [cards, setCards] = useState<ProductCardOption[]>([]);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [sendLoadingOrderId, setSendLoadingOrderId] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [orderGtin, setOrderGtin] = useState("");
  const [releaseMethodType, setReleaseMethodType] = useState("PRODUCTION");
  const [productionOrderId, setProductionOrderId] = useState("");
  const [productGroup, setProductGroup] = useState("perfumery");
  const [paymentType, setPaymentType] = useState<number | null>(null);
  const [paymentSupported, setPaymentSupported] = useState(false);
  const [orderRows, setOrderRows] = useState<OrderRow[]>([]);
  const [, setSelectedRowIdx] = useState<Set<number>>(new Set());
  const [editingOrderCell, setEditingOrderCell] = useState<{
    rowIdx: number;
    field: string;
  } | null>(null);
  const [gtinPatchOrderId, setGtinPatchOrderId] = useState<string | null>(null);
  const [gtinPatchValue, setGtinPatchValue] = useState("");
  const [isPatchingGtin, setIsPatchingGtin] = useState(false);
  const [sendModalOrderId, setSendModalOrderId] = useState<string | null>(null);
  const [sendReleaseMethod, setSendReleaseMethod] = useState("REMARK");
  const [sendProducer, setSendProducer] = useState("");
  const [sendAllowedMethods, setSendAllowedMethods] = useState<string[]>(["REMARK"]);
  const [sendPayloadPreview, setSendPayloadPreview] = useState<SuzOrderPayloadPreview | null>(null);
  const [certificates, setCertificates] = useState<UserCertificate[]>([]);
  const [selectedCertIndex, setSelectedCertIndex] = useState(parseCertIndex());
  const [signingBackend, setSigningBackend] = useState<SigningBackend | null>(null);
  const [isLoadingSendModal, setIsLoadingSendModal] = useState(false);
  const [fetchingCodes, setFetchingCodes] = useState<string | null>(null);
  const [closingOrder, setClosingOrder] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportExcelResult | null>(null);
  const { groups: productGroups } = useProductGroups();

  const mergeableSelectedIds = useMemo(() => {
    const createdWithCard = new Set(
      orders
        .filter((order) => order.status === "created" && order.product_card_id)
        .map((order) => order.id),
    );
    return selectedOrderIds.filter((id) => createdWithCard.has(id));
  }, [orders, selectedOrderIds]);

  const selectedCard = cards.find((c) => c.id === selectedCardId);
  const isSelectedBundle = selectedCard?.type === "bundle";
  const bundleHasItems = (selectedCard?.set_items?.length ?? 0) > 0;

  const singleSelectedDraftForSuz = useMemo(() => {
    if (selectedOrderIds.length !== 1) {
      return null;
    }
    const order = orders.find((candidate) => candidate.id === selectedOrderIds[0]);
    if (!order) {
      return null;
    }
    const hasGtin = Boolean(order.gtin && order.gtin.trim());
    if (order.status !== "created" || !hasGtin || order.suz_order_id !== null) {
      return null;
    }
    return order;
  }, [orders, selectedOrderIds]);

  async function loadOrders() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<EmissionOrder[]>("/emission-orders/");
      setOrders(Array.isArray(response.data) ? response.data : []);
    } catch (requestError) {
      console.error("Failed to load emission orders:", requestError);
      setError("Не удалось загрузить заказы СУЗ.");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadCards() {
    try {
      const response = await apiClient.get<
        Array<Record<string, unknown>> | { items: Array<Record<string, unknown>> }
      >("/product-cards/", { params: { limit: 1000, offset: 0 } });
      const raw = response.data;
      const list = Array.isArray(raw) ? raw : (raw.items ?? []);
      const options = list.map((card) => ({
        id: String(card.id),
        name: String(card.name ?? ""),
        gtin: (card.gtin as string | null | undefined) ?? null,
        type: (card.type as string | undefined) ?? "unit",
        tn_ved: (card.tn_ved as string | undefined) ?? "",
        set_items: Array.isArray(card.set_items)
          ? card.set_items.map((it: { gtin?: unknown; quantity?: unknown }) => ({
              gtin: String(it.gtin ?? ""),
              quantity: Number(it.quantity ?? 1),
            }))
          : [],
      }));
      setCards(options);
      if (options.length > 0 && !selectedCardId) {
        const first = options[0];
        setSelectedCardId(first.id);
        if (first.gtin) setOrderGtin(first.gtin);
        if (first.tn_ved) {
          const prefix = first.tn_ved.replace(/\D/g, "").slice(0, 4);
          const match = TNVED_GROUPS.find((g) => g.code === prefix);
          if (match) setProductGroup(match.productGroup);
        }
      }
    } catch (requestError) {
      console.error("Failed to load product cards for order form:", requestError);
      setError("Не удалось загрузить список карточек товаров.");
    }
  }

  useEffect(() => {
    void Promise.all([loadOrders(), loadCards()]);
  }, []);

  useEffect(() => {
    const afterWithdrawal = sessionStorage.getItem("afterWithdrawal");
    if (afterWithdrawal !== "remark") {
      return;
    }
    sessionStorage.removeItem("afterWithdrawal");
    const remarkQuantity = sessionStorage.getItem("remarkQuantity");
    if (remarkQuantity) {
      setQuantity(remarkQuantity);
      sessionStorage.removeItem("remarkQuantity");
    }
    setReleaseMethodType("REMARK");
    setIsModalOpen(true);
    setSyncInfo(
      "Повреждённые коды выведены из оборота. Закажите новые КМ с типом «Перемаркировка».",
    );
  }, []);

  useEffect(() => {
    setSelectedOrderIds((previous) => previous.filter((id) => orders.some((order) => order.id === id)));
  }, [orders]);

  useEffect(() => {
    if (!productGroup) {
      setPaymentSupported(false);
      return;
    }
    apiClient
      .get<{ supported: boolean }>("/emission-orders/payment-type-support", {
        params: { product_group: productGroup },
      })
      .then((res) => {
        setPaymentSupported(res.data.supported);
        setPaymentType(res.data.supported ? 2 : null);
      })
      .catch(() => setPaymentSupported(false));
  }, [productGroup]);

  async function handleSyncFromSuz() {
    setIsSyncing(true);
    setError(null);
    setSyncInfo(null);
    try {
      const response = await apiClient.post<SuzSyncResult>("/emission-orders/sync-from-suz");
      const { inserted, updated, total_remote } = response.data;
      setSyncInfo(
        `Синхронизация: получено из СУЗ ${total_remote}, новых ${inserted}, обновлено ${updated}.`,
      );
      await loadOrders();
    } catch (requestError) {
      console.error("Failed to sync SUZ orders:", requestError);
      if (axios.isAxiosError(requestError)) {
        const detail = requestError.response?.data?.detail;
        if (typeof detail === "string" && detail.trim()) {
          setError(detail);
          return;
        }
      }
      setError("Не удалось подтянуть заказы из СУЗ. Проверьте SUZ_* в .env бэкенда.");
    } finally {
      setIsSyncing(false);
    }
  }

  async function openSendToSuzModal(orderId: string) {
    setSendModalOrderId(orderId);
    setSendProducer("");
    setSendPayloadPreview(null);
    setError(null);
    setIsLoadingSendModal(true);
    try {
      const backend = await detectSigningBackend();
      setSigningBackend(backend);
      const certs = await getUserCertificates();
      setCertificates(certs);
      if (certs.length > 0) {
        setSelectedCertIndex(1);
      }
      const preview = await apiClient.get<SuzOrderPayloadPreview>(
        `/emission-orders/${orderId}/suz-order-payload`,
      );
      setSendPayloadPreview(preview.data);
      setSendReleaseMethod(preview.data.release_method_type);
      setSendAllowedMethods(preview.data.allowed_release_method_types);
    } catch (requestError) {
      console.error("Failed to prepare SUZ send:", requestError);
      if (axios.isAxiosError(requestError)) {
        const detail = requestError.response?.data?.detail;
        if (typeof detail === "string" && detail.trim()) {
          setError(detail);
        } else {
          setError("Не удалось подготовить отправку в СУЗ. Проверьте КриптоПро и GTIN заказа.");
        }
      } else if (requestError instanceof Error) {
        setError(requestError.message);
      } else {
        setError("Не удалось подготовить отправку в СУЗ.");
      }
      setSendModalOrderId(null);
    } finally {
      setIsLoadingSendModal(false);
    }
  }

  async function handleConfirmSendToSuz() {
    const orderId = sendModalOrderId;
    if (!orderId || !sendPayloadPreview) return;

    setSendLoadingOrderId(orderId);
    setSyncInfo(null);
    setError(null);
    try {
      const preview = (
        await apiClient.get<SuzOrderPayloadPreview>(`/emission-orders/${orderId}/suz-order-payload`, {
          params: {
            release_method_type: sendReleaseMethod,
            ...(sendProducer.trim() ? { producer: sendProducer.trim() } : {}),
          },
        })
      ).data;

      const pickedCert = certificates[selectedCertIndex - 1];
      await sendLocalOrderToSuz(
        orderId,
        preview.body as import("../services/suzOrderApi").SuzOrderBody,
        preview.body_string,
        { certIndex: selectedCertIndex, thumbprint: pickedCert?.thumbprint },
      );
      setSendModalOrderId(null);
      setSendPayloadPreview(null);
      setSyncInfo("Заказ отправлен в СУЗ.");
      await loadOrders();
    } catch (requestError) {
      console.error("Failed to send order to SUZ:", requestError);
      if (axios.isAxiosError(requestError)) {
        const detail = requestError.response?.data?.detail;
        if (typeof detail === "string" && detail.trim()) {
          setError(detail);
          return;
        }
      }
      if (requestError instanceof Error) {
        setError(requestError.message);
        return;
      }
      setError("Не удалось отправить заказ в СУЗ.");
    } finally {
      setSendLoadingOrderId(null);
    }
  }

  async function handlePatchOrderGtin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = gtinPatchOrderId;
    if (!id) return;
    const trimmed = gtinPatchValue.trim();
    if (trimmed.length < 8) {
      setError("GTIN должен быть не короче 8 цифр.");
      return;
    }

    setIsPatchingGtin(true);
    setError(null);
    try {
      await apiClient.patch(`/emission-orders/${id}/gtin`, { gtin: trimmed });
      setGtinPatchOrderId(null);
      setGtinPatchValue("");
      setSyncInfo("GTIN сохранён в заказе. Можно отправлять в СУЗ.");
      await loadOrders();
    } catch (requestError) {
      console.error("Failed to patch order GTIN:", requestError);
      if (axios.isAxiosError(requestError)) {
        const detail = requestError.response?.data?.detail;
        if (typeof detail === "string" && detail.trim()) {
          setError(detail);
          return;
        }
      }
      setError("Не удалось сохранить GTIN.");
    } finally {
      setIsPatchingGtin(false);
    }
  }

  function handleSelectCard(cardId: string) {
    setSelectedCardId(cardId);
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;

    if (card.gtin) {
      setOrderGtin(card.gtin);
    }

    if (card.tn_ved) {
      const prefix = card.tn_ved.replace(/\D/g, "").slice(0, 4);
      const match = TNVED_GROUPS.find((g) => g.code === prefix);
      if (match && productGroups.some((pg) => pg.value === match.productGroup)) {
        setProductGroup(match.productGroup);
      }
    }
  }

  function handleAddOrderRow() {
    const qty = Number(quantity);
    if (!selectedCardId || Number.isNaN(qty) || qty <= 0) {
      setError("Выберите карточку и укажите количество больше 0");
      return;
    }
    const card = cards.find((c) => c.id === selectedCardId);
    const effectiveGtin = orderGtin.trim() || card?.gtin || "";

    const isTech = card?.gtin?.startsWith("029") || card?.type === "tech_card";
    if (!effectiveGtin && !isTech) {
      setError("Укажите GTIN (карточка без GTIN). Заполните поле GTIN.");
      return;
    }

    const row: OrderRow = {
      cardId: selectedCardId,
      cardName: card?.name || "—",
      gtin: effectiveGtin,
      quantity: qty,
      productGroup,
      releaseMethodType,
      productionOrderId: productionOrderId.trim(),
      paymentType: paymentSupported ? paymentType : null,
      _status: "draft",
    };
    setOrderRows((prev) => [...prev, row]);
    setError(null);
    setSyncInfo(`Добавлено позиций в заказ: ${orderRows.length + 1}`);

    setQuantity("1");
    setOrderGtin("");
    setProductionOrderId("");
  }

  function handleAddSetUnits() {
    const card = cards.find((c) => c.id === selectedCardId);
    if (!card) {
      setError("Выберите карточку набора");
      return;
    }
    if (card.type !== "bundle") {
      setError("Выбранная карточка не является набором");
      return;
    }
    if (!card.set_items || card.set_items.length === 0) {
      setError(
        "У набора не указан состав. Сначала добавьте вложения в карточку набора в Национальном каталоге.",
      );
      return;
    }

    const setQty = Number(quantity) || 1;

    const unitRows: OrderRow[] = card.set_items
      .filter((it) => it.gtin)
      .map((it) => ({
        cardId: selectedCardId,
        cardName: `${card.name} → вложение ${it.gtin}`,
        gtin: it.gtin,
        quantity: setQty * it.quantity,
        productGroup,
        releaseMethodType,
        productionOrderId: productionOrderId.trim(),
        paymentType: paymentSupported ? paymentType : null,
        _status: "draft",
        _isSetUnit: true,
      }));

    if (unitRows.length === 0) {
      setError("В составе набора нет валидных GTIN вложений");
      return;
    }

    setOrderRows((prev) => [...prev, ...unitRows]);
    setError(null);
    setSyncInfo(
      `Добавлено единиц набора: ${unitRows.length} (количество рассчитано из состава карточки НК)`,
    );
    setQuantity("1");
  }

  async function handleCreateAllOrders() {
    if (orderRows.length === 0) {
      setError("Список пуст. Добавьте позиции через «Добавить в заказ»");
      return;
    }
    if (orderRows.length > 100) {
      setError("Максимум 100 заказов за раз (лимит СУЗ)");
      return;
    }
    setIsSubmitting(true);
    setError(null);

    let created = 0;
    let failed = 0;

    for (let i = 0; i < orderRows.length; i++) {
      const row = orderRows[i];
      if (row._status === "sent") {
        created++;
        continue;
      }

      setOrderRows((prev) =>
        prev.map((r, idx) => (idx === i ? { ...r, _status: "sending" } : r)),
      );

      try {
        const payload: Record<string, unknown> = {
          product_card_id: row.cardId,
          quantity: row.quantity,
          product_group: row.productGroup,
          release_method_type: row.releaseMethodType,
        };
        if (row.gtin.length >= 8) payload.gtin = row.gtin;
        if (row.productionOrderId) payload.production_order_id = row.productionOrderId;
        if (row.paymentType) payload.payment_type = row.paymentType;

        await apiClient.post("/emission-orders/", payload);
        created++;
        setOrderRows((prev) =>
          prev.map((r, idx) =>
            idx === i ? { ...r, _status: "sent", _error: undefined } : r,
          ),
        );
      } catch (err: unknown) {
        failed++;
        let detail = "Ошибка";
        if (axios.isAxiosError(err)) {
          const responseDetail = err.response?.data?.detail;
          if (typeof responseDetail === "string" && responseDetail.trim()) {
            detail = responseDetail;
          } else if (err.message) {
            detail = err.message;
          }
        } else if (err instanceof Error) {
          detail = err.message;
        }
        setOrderRows((prev) =>
          prev.map((r, idx) =>
            idx === i ? { ...r, _status: "error", _error: detail } : r,
          ),
        );
      }
    }

    setIsSubmitting(false);
    if (failed === 0) {
      setSyncInfo(`Создано черновиков заказов: ${created}`);
      setOrderRows([]);
      setSelectedRowIdx(new Set());
      setIsModalOpen(false);
      await loadOrders();
    } else {
      setError(
        `Создано: ${created}, с ошибками: ${failed}. Наведите на «Ошибка» для деталей.`,
      );
      await loadOrders();
    }
  }

  function handleRemoveOrderRow(idx: number) {
    setOrderRows((prev) => prev.filter((_, i) => i !== idx));
    setSelectedRowIdx((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => {
        if (i < idx) next.add(i);
        else if (i > idx) next.add(i - 1);
      });
      return next;
    });
  }

  function handleClearOrderRows() {
    setOrderRows([]);
    setSelectedRowIdx(new Set());
    setEditingOrderCell(null);
  }

  function updateOrderRowField(rowIdx: number, field: string, value: string | number) {
    setOrderRows((prev) =>
      prev.map((row, idx) => {
        if (idx !== rowIdx) return row;
        if (field === "quantity") {
          return { ...row, quantity: Math.max(1, Number(value) || 1) };
        }
        if (field === "gtin") {
          return { ...row, gtin: String(value).replace(/\D/g, "").slice(0, 14) };
        }
        if (field === "paymentType") {
          return { ...row, paymentType: value ? Number(value) : null };
        }
        return { ...row, [field]: value };
      }),
    );
  }

  function finishOrderCellEdit() {
    setEditingOrderCell(null);
  }

  function applyReleaseMethodToAll(method: string) {
    setOrderRows((prev) =>
      prev.map((row) => ({
        ...row,
        releaseMethodType: method,
      })),
    );
    setSyncInfo(
      `Способ выпуска изменён для всех позиций: ${
        RELEASE_METHOD_TYPES.find((t) => t.value === method)?.label
      }`,
    );
  }

  function applyPaymentTypeToAll(pt: number) {
    setOrderRows((prev) =>
      prev.map((row) => {
        if (row.paymentType !== null) {
          return { ...row, paymentType: pt };
        }
        return row;
      }),
    );
    setSyncInfo(`Способ оплаты изменён: ${pt === 2 ? "по нанесению" : "по эмиссии"}`);
  }

  async function handleCloseOrder(orderId: string, suzOrderId: string) {
    setClosingOrder(orderId);
    setError(null);
    try {
      const pickedCert = certificates[selectedCertIndex - 1];
      await closeEmissionOrder(orderId, suzOrderId, {
        certIndex: selectedCertIndex,
        thumbprint: pickedCert?.thumbprint,
      });
      setSyncInfo("Заказ закрыт в СУЗ");
      await loadOrders();
    } catch (requestError) {
      console.error("Failed to close order in SUZ:", requestError);
      if (axios.isAxiosError(requestError)) {
        const detail = requestError.response?.data?.detail;
        if (typeof detail === "string" && detail.trim()) {
          setError(detail);
          return;
        }
      }
      if (requestError instanceof Error) {
        setError(requestError.message);
        return;
      }
      setError("Ошибка при закрытии заказа в СУЗ");
    } finally {
      setClosingOrder(null);
    }
  }

  async function handleFetchCodes(orderId: string, suzOrderId: string) {
    setFetchingCodes(orderId);
    setError(null);
    try {
      const response = await apiClient.post<{ codes_count: number }>(
        `/emission-orders/${orderId}/fetch-codes`,
      );
      const { codes_count } = response.data;

      try {
        const pickedCert = certificates[selectedCertIndex - 1];
        await closeEmissionOrder(orderId, suzOrderId, {
          certIndex: selectedCertIndex,
          thumbprint: pickedCert?.thumbprint,
        });
        setSyncInfo(`Скачано ${codes_count} кодов. Заказ закрыт в СУЗ.`);
      } catch (closeErr) {
        console.warn("Не удалось закрыть заказ автоматически:", closeErr);
        setSyncInfo(`Скачано ${codes_count} кодов. Закройте заказ вручную.`);
      }

      await loadOrders();
    } catch (requestError) {
      console.error("Failed to fetch marking codes:", requestError);
      if (axios.isAxiosError(requestError)) {
        const detail = requestError.response?.data?.detail;
        if (typeof detail === "string" && detail.trim()) {
          setError(detail);
          return;
        }
      }
      setError("Ошибка при скачивании кодов");
    } finally {
      setFetchingCodes(null);
    }
  }

  async function handleImportExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await apiClient.post<ImportExcelResult>(
        "/emission-orders/import-excel-orders",
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      setImportResult(res.data);
      setError(null);
      await loadOrders();
    } catch (requestError) {
      console.error("Failed to import orders from Excel:", requestError);
      if (axios.isAxiosError(requestError)) {
        const detail = requestError.response?.data?.detail;
        if (typeof detail === "string" && detail.trim()) {
          setError(detail);
        } else {
          setError("Ошибка импорта");
        }
      } else {
        setError("Ошибка импорта");
      }
    }
    e.target.value = "";
  }

  async function handleDownloadExcelTemplate() {
    try {
      const res = await apiClient.get("/emission-orders/excel-template", {
        responseType: "blob",
      });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = "order_template.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      console.error("Failed to download Excel template:", requestError);
      setError("Не удалось скачать шаблон Excel.");
    }
  }

  async function handleMergeOrders() {
    if (mergeableSelectedIds.length < 2) {
      return;
    }
    setIsMerging(true);
    setError(null);
    try {
      await apiClient.post("/emission-orders/merge", {
        order_ids: mergeableSelectedIds,
      });
      setSelectedOrderIds([]);
      await loadOrders();
    } catch (requestError) {
      console.error("Failed to merge emission orders:", requestError);
      setError("Не удалось объединить выбранные заказы.");
    } finally {
      setIsMerging(false);
    }
  }

  function toggleOrder(orderId: string, checked: boolean) {
    setSelectedOrderIds((previous) => {
      if (checked) {
        return [...previous, orderId];
      }
      return previous.filter((id) => id !== orderId);
    });
  }

  return (
    <div className="page-container">
      <PageHeader
        title="Заказы СУЗ"
        description="Черновик создаётся локально («Заказать коды»); в СУЗ — кнопка в строке таблицы или «Отправить в СУЗ (выбранный)» после отметки одного черновика с GTIN. Список с сервера — «Подтянуть из СУЗ»."
        actions={
          <>
            <button
              type="button"
              onClick={() => void handleDownloadExcelTemplate()}
              className="btn-secondary"
            >
              ⬇ Шаблон Excel
            </button>
            <label className="btn-primary cursor-pointer">
              📥 Загрузить заказы
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(event) => void handleImportExcel(event)}
              />
            </label>
            <button
              type="button"
              onClick={() => void handleSyncFromSuz()}
              disabled={isSyncing}
              className="btn-secondary"
            >
              {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Подтянуть из СУЗ
            </button>
            {singleSelectedDraftForSuz ? (
              <button
                type="button"
                onClick={() => void openSendToSuzModal(singleSelectedDraftForSuz.id)}
                disabled={sendLoadingOrderId === singleSelectedDraftForSuz.id}
                className="btn-secondary !border-amber-200 !bg-amber-50 !text-amber-950 hover:!bg-amber-100"
              >
                {sendLoadingOrderId === singleSelectedDraftForSuz.id ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : null}
                Отправить в СУЗ (выбранный)
              </button>
            ) : null}
            <button type="button" onClick={() => setIsModalOpen(true)} className="btn-primary">
              Заказать коды
            </button>
          </>
        }
      />

      {mergeableSelectedIds.length >= 2 ? (
        <div className="mb-6 flex justify-start">
          <button
            type="button"
            onClick={() => void handleMergeOrders()}
            disabled={isMerging}
            className="btn-accent"
          >
            {isMerging ? <Loader2 size={16} className="animate-spin" /> : null}
            Объединить заказы
          </button>
        </div>
      ) : null}

      {error ? (
        <Alert variant="error" onDismiss={() => setError(null)} className="mb-6 whitespace-pre-wrap">
          {error}
        </Alert>
      ) : null}

      {syncInfo ? (
        <Alert variant="success" onDismiss={() => setSyncInfo(null)} className="mb-6">
          {syncInfo}
        </Alert>
      ) : null}

      {importResult ? (
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
          <p className="font-medium text-emerald-700">
            Создано {importResult.created} заказов
          </p>
          {importResult.errors.length > 0 ? (
            <div className="mt-2">
              <p className="font-medium text-amber-600">Ошибки:</p>
              {importResult.errors.map((entry, index) => (
                <p key={index} className="text-xs text-amber-600">
                  {entry}
                </p>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setImportResult(null)}
            className="mt-2 text-xs text-slate-400 hover:text-slate-600"
          >
            Скрыть
          </button>
        </div>
      ) : null}

      <div className="table-container">
        <table className="table-base min-w-full">
          <thead>
            <tr>
              <th className="px-4 py-3 font-medium" />
              <th className="px-4 py-3 font-medium">Заказ СУЗ</th>
              <th className="px-4 py-3 font-medium">GTIN</th>
              <th className="px-4 py-3 font-medium">ID карточки</th>
              <th className="px-4 py-3 font-medium">Количество</th>
              <th className="px-4 py-3 font-medium">Статус</th>
              <th className="min-w-[150px] px-4 py-3 font-medium">Действия</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sage-500">
                  Загрузка заказов...
                </td>
              </tr>
            ) : null}

            {!isLoading && orders.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sage-500">
                  Заказов пока нет. Нажмите «Подтянуть из СУЗ» или создайте заказ вручную.
                </td>
              </tr>
            ) : null}

            {orders.map((order) => {
              const isCreated = order.status === "created";
              const canSelect = isCreated && Boolean(order.product_card_id);
              const hasGtin = Boolean(order.gtin && order.gtin.trim());
              const canSpecifyGtin =
                order.status === "created" &&
                Boolean(order.product_card_id) &&
                order.suz_order_id == null &&
                !hasGtin;
              const canSendToSuz =
                order.status === "created" &&
                hasGtin &&
                order.suz_order_id == null;
              const isChecked = selectedOrderIds.includes(order.id);
              const isSendingRow = sendLoadingOrderId === order.id;
              const canFetchCodes = Boolean(order.suz_order_id) && order.status === "available";
              const canCloseOrder =
                Boolean(order.suz_order_id) &&
                (order.status === "exhausted" || order.status === "available");
              const hasCachedCodes = (order.suz_marking_codes?.length ?? 0) > 0;
              const showPlaceholder =
                !canSpecifyGtin &&
                !canSendToSuz &&
                !canFetchCodes &&
                !canCloseOrder &&
                !hasCachedCodes;
              return (
                <tr key={order.id}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={!canSelect}
                      onChange={(event) => toggleOrder(order.id, event.target.checked)}
                      className="checkbox-field text-forest-700 focus:ring-forest-500 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </td>
                  <td className="max-w-[140px] truncate px-4 py-3 font-mono text-xs" title={order.suz_order_id ?? ""}>
                    {order.suz_order_id ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{order.gtin ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs sm:text-sm">
                    {order.product_card_id ?? "—"}
                  </td>
                  <td className="px-4 py-3">{order.quantity}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${statusColor[order.status] ?? "bg-gray-100 text-gray-500"}`}
                    >
                      {statusLabel[order.status] ?? order.status}
                    </span>
                    {order.status === "rejected" && (
                      <p className="text-xs text-red-500 mt-0.5">
                        ⚠️ {getOrderError(order)}
                      </p>
                    )}
                  </td>
                  <td className="max-w-[200px] px-4 py-3">
                    <div className="flex flex-col items-start gap-1.5">
                      {canSpecifyGtin ? (
                        <button
                          type="button"
                          onClick={() => {
                            setGtinPatchOrderId(order.id);
                            setGtinPatchValue("");
                            setError(null);
                          }}
                          className="btn-xs btn-secondary !min-h-[32px]"
                        >
                          Указать GTIN
                        </button>
                      ) : null}
                      {canSendToSuz ? (
                        <button
                          type="button"
                          onClick={() => void openSendToSuzModal(order.id)}
                          disabled={isSendingRow}
                          className="btn-xs btn-secondary !min-h-[32px] !border-amber-200 !bg-amber-50 !text-amber-900 hover:!bg-amber-100"
                        >
                          {isSendingRow ? <Loader2 size={14} className="animate-spin" /> : null}
                          Отправить в СУЗ
                        </button>
                      ) : null}
                      {canFetchCodes ? (
                        <button
                          type="button"
                          onClick={() => void handleFetchCodes(order.id, order.suz_order_id!)}
                          disabled={fetchingCodes === order.id}
                          className="btn-xs btn-primary !min-h-[32px]"
                        >
                          {fetchingCodes === order.id ? "Загрузка..." : "Скачать КМ"}
                        </button>
                      ) : null}
                      {hasCachedCodes ? (
                        <a
                          href={`/api/v1/emission-orders/${order.id}/codes.csv`}
                          download
                          className="btn-xs btn-primary !min-h-[32px]"
                        >
                          CSV ({order.suz_marking_codes!.length})
                        </a>
                      ) : null}
                      {canCloseOrder ? (
                        <button
                          type="button"
                          onClick={() => void handleCloseOrder(order.id, order.suz_order_id!)}
                          disabled={closingOrder === order.id}
                          className="btn-xs btn-secondary !min-h-[32px] !bg-sage-700 !text-white hover:!bg-sage-800"
                        >
                          {closingOrder === order.id ? "Закрытие..." : "Закрыть заказ"}
                        </button>
                      ) : null}
                      {showPlaceholder ? <span className="text-xs text-sage-400">—</span> : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {isModalOpen ? (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-forest-950">Заказать коды</h2>
                <p className="text-sm text-sage-600">Локальный черновик заказа; затем отправьте его кнопкой «Отправить в СУЗ».</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsModalOpen(false);
                  setProductionOrderId("");
                  setPaymentType(null);
                  setOrderRows([]);
                }}
                className="rounded-lg p-1 text-sage-500 transition hover:bg-forest-50"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <label className="flex flex-col gap-1.5">
                <span className="label-text">Карточка товара</span>
                <select
                  value={selectedCardId}
                  onChange={(event) => handleSelectCard(event.target.value)}
                  required
                  className="select-field"
                >
                  {cards.length === 0 ? <option value="">Нет доступных карточек</option> : null}
                  {cards.map((card) => (
                    <option key={card.id} value={card.id}>
                      {card.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="label-text">Количество</span>
                <input
                  type="number"
                  min={1}
                  required
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  className="input-field"
                />
              </label>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Товарная группа
                </label>
                <select
                  value={productGroup}
                  onChange={(e) => setProductGroup(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {productGroups.map((g) => (
                    <option key={g.value} value={g.value}>{g.label}</option>
                  ))}
                </select>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="label-text">GTIN для СУЗ (если карточка без GTIN)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="14 цифр"
                  value={orderGtin}
                  onChange={(event) => setOrderGtin(event.target.value.replace(/\D/g, ""))}
                  className="input-field font-mono"
                />
                <span className="text-xs text-sage-500">
                  API СУЗ требует GTIN в теле заказа. Для 029… при отправке будет только REMARK без серийников.
                </span>
              </label>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Способ выпуска
                </label>
                <select
                  value={releaseMethodType}
                  onChange={(event) => setReleaseMethodType(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {RELEASE_METHOD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {releaseMethodType === "REMARK" ? (
                  <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    Перемаркировка: сначала выведите повреждённые коды из оборота с причиной
                    «Повреждение/утрата», затем закажите новые КМ здесь.
                  </div>
                ) : null}
              </div>

              {paymentSupported ? (
                <div className="form-group">
                  <label>Способ оплаты кодов</label>
                  <select
                    value={paymentType ?? 2}
                    onChange={(e) => setPaymentType(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value={2}>Оплата по нанесению</option>
                    <option value={1}>Оплата по эмиссии</option>
                  </select>
                  <p className="hint text-xs text-slate-400">
                    По нанесению — списание при нанесении кода. По эмиссии — при получении.
                  </p>
                </div>
              ) : null}

              <div className="form-group">
                <label>Идентификатор производственного заказа</label>
                <input
                  type="text"
                  value={productionOrderId}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^a-zA-Z0-9\-]/g, "");
                    setProductionOrderId(v);
                  }}
                  placeholder="Опционально, латиница (напр. ORDER-2026-001)"
                  maxLength={256}
                  className="input-field"
                />
                <p className="hint text-xs text-slate-400">
                  Необязательное поле. Только латинские буквы, цифры и дефис.
                </p>
              </div>

              {isSelectedBundle && !bundleHasItems && (
                <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Это набор, но у него не указан состав. Добавьте вложенные единицы
                  в карточку набора в Национальном каталоге, затем заказывайте коды.
                </div>
              )}
              {isSelectedBundle && bundleHasItems && (
                <div className="mt-2 rounded border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-700">
                  Набор «{selectedCard?.name}» содержит {selectedCard?.set_items.length} вложений.
                  Кнопка «Добавить единицы для наборов» развернёт их в позиции заказа
                  (количество = ваше количество × количество в наборе).
                </div>
              )}

              <div className="flex justify-between gap-2 border-t border-slate-200 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    setProductionOrderId("");
                    setPaymentType(null);
                    setOrderRows([]);
                  }}
                  className="btn-secondary"
                >
                  Закрыть
                </button>
                <div className="flex gap-2">
                  {isSelectedBundle ? (
                    <button
                      type="button"
                      onClick={handleAddSetUnits}
                      disabled={!bundleHasItems}
                      className="btn-primary !bg-purple-600 hover:!bg-purple-700"
                      title={
                        bundleHasItems
                          ? "Развернуть набор в единицы (количество из карточки НК)"
                          : "У набора не указан состав в НК"
                      }
                    >
                      + Добавить единицы для наборов
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleAddOrderRow}
                      disabled={cards.length === 0}
                      className="btn-primary"
                    >
                      + Добавить в заказ
                    </button>
                  )}
                </div>
              </div>
            </div>

            {orderRows.length > 0 ? (
              <div className="mt-4 border-t border-slate-200 pt-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">
                    Позиции заказа ({orderRows.length})
                  </span>
                  <button
                    type="button"
                    onClick={handleClearOrderRows}
                    className="text-xs text-slate-500 hover:text-red-600"
                  >
                    Очистить
                  </button>
                </div>
                <div className="mb-2 flex flex-wrap items-center gap-2 rounded bg-slate-50 p-2 text-xs">
                  <span className="text-slate-500">Массово для всех:</span>
                  <select
                    onChange={(e) => {
                      if (e.target.value) applyReleaseMethodToAll(e.target.value);
                      e.target.value = "";
                    }}
                    defaultValue=""
                    className="rounded border border-slate-300 px-2 py-1"
                  >
                    <option value="">Способ выпуска…</option>
                    {RELEASE_METHOD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  {orderRows.some((r) => r.paymentType !== null) && (
                    <select
                      onChange={(e) => {
                        if (e.target.value) applyPaymentTypeToAll(Number(e.target.value));
                        e.target.value = "";
                      }}
                      defaultValue=""
                      className="rounded border border-slate-300 px-2 py-1"
                    >
                      <option value="">Способ оплаты…</option>
                      <option value="2">Оплата по нанесению</option>
                      <option value="1">Оплата по эмиссии</option>
                    </select>
                  )}
                </div>
                <div className="max-h-60 overflow-auto rounded border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr>
                        <th className="px-2 py-1 text-left">Карточка</th>
                        <th className="px-2 py-1 text-left">GTIN</th>
                        <th className="px-2 py-1 text-left">Кол-во</th>
                        <th className="px-2 py-1 text-left">Способ выпуска</th>
                        <th className="px-2 py-1 text-left">Статус</th>
                        <th className="px-2 py-1" />
                      </tr>
                    </thead>
                    <tbody>
                      {orderRows.map((row, idx) => {
                        const canEditRow =
                          !row._status || row._status === "draft" || row._status === "error";
                        const rowCard = cards.find((c) => c.id === row.cardId);
                        const isTechRow =
                          rowCard?.gtin?.startsWith("029") || rowCard?.type === "tech_card";

                        return (
                        <tr key={idx} className="border-t border-slate-100">
                          <td className="max-w-[120px] truncate px-2 py-1" title={row.cardName}>
                            {row._isSetUnit && (
                              <span className="mr-1 text-purple-600" title="Единица набора">
                                ⬡
                              </span>
                            )}
                            {row.cardName}
                          </td>
                          <td className="px-2 py-1 font-mono">
                            {editingOrderCell?.rowIdx === idx &&
                            editingOrderCell?.field === "gtin" &&
                            canEditRow &&
                            !isTechRow ? (
                              <input
                                type="text"
                                inputMode="numeric"
                                autoFocus
                                value={row.gtin}
                                maxLength={14}
                                onChange={(e) => updateOrderRowField(idx, "gtin", e.target.value)}
                                onBlur={finishOrderCellEdit}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === "Escape") finishOrderCellEdit();
                                }}
                                className="w-32 rounded border border-blue-400 px-1 py-0.5 font-mono"
                              />
                            ) : canEditRow && !isTechRow ? (
                              <span
                                className="cursor-pointer rounded px-1 hover:bg-blue-50"
                                onClick={() => setEditingOrderCell({ rowIdx: idx, field: "gtin" })}
                              >
                                {row.gtin || "авто"}
                              </span>
                            ) : (
                              <span>{row.gtin || "авто"}</span>
                            )}
                          </td>
                          <td className="px-2 py-1">
                            {editingOrderCell?.rowIdx === idx &&
                            editingOrderCell?.field === "quantity" &&
                            canEditRow ? (
                              <input
                                type="number"
                                min={1}
                                autoFocus
                                value={row.quantity}
                                onChange={(e) => updateOrderRowField(idx, "quantity", e.target.value)}
                                onBlur={finishOrderCellEdit}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === "Escape") finishOrderCellEdit();
                                }}
                                className="w-16 rounded border border-blue-400 px-1 py-0.5"
                              />
                            ) : canEditRow ? (
                              <span
                                className="cursor-pointer rounded px-1 hover:bg-blue-50"
                                onClick={() =>
                                  setEditingOrderCell({ rowIdx: idx, field: "quantity" })
                                }
                              >
                                {row.quantity}
                              </span>
                            ) : (
                              <span>{row.quantity}</span>
                            )}
                          </td>
                          <td className="px-2 py-1">
                            {editingOrderCell?.rowIdx === idx &&
                            editingOrderCell?.field === "releaseMethodType" &&
                            canEditRow ? (
                              <select
                                autoFocus
                                value={row.releaseMethodType}
                                onChange={(e) => {
                                  updateOrderRowField(idx, "releaseMethodType", e.target.value);
                                  finishOrderCellEdit();
                                }}
                                onBlur={finishOrderCellEdit}
                                className="rounded border border-blue-400 px-1 py-0.5"
                              >
                                {RELEASE_METHOD_TYPES.map((t) => (
                                  <option key={t.value} value={t.value}>
                                    {t.label}
                                  </option>
                                ))}
                              </select>
                            ) : canEditRow ? (
                              <span
                                className="cursor-pointer rounded px-1 hover:bg-blue-50"
                                onClick={() =>
                                  setEditingOrderCell({ rowIdx: idx, field: "releaseMethodType" })
                                }
                              >
                                {RELEASE_METHOD_TYPES.find((t) => t.value === row.releaseMethodType)
                                  ?.label || row.releaseMethodType}
                              </span>
                            ) : (
                              <span>
                                {RELEASE_METHOD_TYPES.find((t) => t.value === row.releaseMethodType)
                                  ?.label || row.releaseMethodType}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1">
                            {row._status === "sent" ? (
                              <span className="text-emerald-600">Создан ✓</span>
                            ) : null}
                            {row._status === "sending" ? (
                              <span className="text-amber-600">Отправка...</span>
                            ) : null}
                            {row._status === "error" ? (
                              <span className="text-red-600" title={row._error}>
                                Ошибка
                              </span>
                            ) : null}
                            {!row._status || row._status === "draft" ? (
                              <span className="text-slate-400">Черновик</span>
                            ) : null}
                          </td>
                          <td className="px-2 py-1">
                            <button
                              type="button"
                              onClick={() => handleRemoveOrderRow(idx)}
                              className="text-red-500 hover:text-red-700"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCreateAllOrders()}
                  disabled={isSubmitting}
                  className="btn-primary mt-3 w-full"
                >
                  {isSubmitting
                    ? "Создание заказов..."
                    : `Создать все заказы (${orderRows.length})`}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {sendModalOrderId !== null ? (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-forest-950">Отправка в СУЗ</h2>
                <p className="mt-1 text-sm text-sage-600">
                  Подпись тела запроса (X-Signature) через КриптоПро в браузере, затем POST /api/v3/order.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSendModalOrderId(null);
                  setSendPayloadPreview(null);
                }}
                className="rounded-lg p-1 text-sage-500 transition hover:bg-forest-50"
              >
                <X size={18} />
              </button>
            </div>

            {isLoadingSendModal ? (
              <p className="flex items-center gap-2 text-sm text-sage-600">
                <Loader2 size={16} className="animate-spin" />
                Подготовка…
              </p>
            ) : (
              <div className="space-y-3">
                {sendPayloadPreview ? (
                  <p className="font-mono text-xs text-sage-600">
                    GTIN: {sendPayloadPreview.gtin} · productGroup: {sendPayloadPreview.product_group} · templateId: {sendPayloadPreview.template_id}
                    {signingBackend ? (
                      <>
                        {" "}
                        · подпись: {signingBackend === "cadesplugin" ? "cadesplugin" : "crypto-pro"}
                      </>
                    ) : null}
                  </p>
                ) : null}

                <label className="flex flex-col gap-1.5">
                  <span className="label-text">Способ выпуска</span>
                  <select
                    value={sendReleaseMethod}
                    onChange={(event) => setSendReleaseMethod(event.target.value)}
                    disabled={sendAllowedMethods.length <= 1}
                    className="select-field"
                  >
                    {sendAllowedMethods.map((method) => (
                      <option key={method} value={method}>
                        {RELEASE_METHOD_LABELS[method] ?? method}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="label-text">ИНН владельца (producer), если карточка чужая</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={sendProducer}
                    onChange={(event) => setSendProducer(event.target.value.replace(/\D/g, ""))}
                    className="input-field font-mono"
                  />
                </label>

                {certificates.length > 0 ? (
                  <label className="flex flex-col gap-1.5">
                    <span className="label-text">Сертификат ЭП (cadesplugin)</span>
                    <select
                      value={selectedCertIndex}
                      onChange={(event) => setSelectedCertIndex(Number(event.target.value))}
                      className="select-field"
                    >
                      {certificates.map((certificate, idx) => (
                        <option key={certificate.thumbprint} value={idx + 1}>
                          {certificate.ownerName} (до {certificate.validTo})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="text-xs text-amber-800">
                    Сертификат: индекс {selectedCertIndex} (VITE_CERT_INDEX). Подпись только в браузере.
                  </p>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSendModalOrderId(null);
                      setSendPayloadPreview(null);
                    }}
                    className="btn-secondary"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    disabled={!sendPayloadPreview || sendLoadingOrderId === sendModalOrderId}
                    onClick={() => void handleConfirmSendToSuz()}
                    className="btn-primary !bg-amber-600 hover:!bg-amber-700"
                  >
                    {sendLoadingOrderId === sendModalOrderId ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : null}
                    Подписать и отправить
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {gtinPatchOrderId !== null ? (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-forest-950">GTIN для отправки в СУЗ</h2>
                <p className="mt-1 text-sm text-sage-600">
                  Сохраняется только в этом заказе; карточку в Нацкаталоге можно не менять.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setGtinPatchOrderId(null);
                  setGtinPatchValue("");
                }}
                className="rounded-lg p-1 text-sage-500 transition hover:bg-forest-50"
              >
                <X size={18} />
              </button>
            </div>
            <form className="space-y-4" onSubmit={handlePatchOrderGtin}>
              <label className="flex flex-col gap-1.5">
                <span className="label-text">GTIN (8–14 цифр)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  minLength={8}
                  maxLength={14}
                  value={gtinPatchValue}
                  onChange={(event) => setGtinPatchValue(event.target.value.replace(/\D/g, ""))}
                  className="input-field font-mono"
                />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setGtinPatchOrderId(null);
                    setGtinPatchValue("");
                  }}
                  className="btn-secondary"
                >
                  Отмена
                </button>
                <button type="submit" disabled={isPatchingGtin} className="btn-primary">
                  {isPatchingGtin ? <Loader2 size={16} className="animate-spin" /> : null}
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
