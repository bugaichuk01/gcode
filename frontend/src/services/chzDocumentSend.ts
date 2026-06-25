import apiClient from "../api/client";
import { signBody, signBodyBase64 } from "./signingService";

export interface UtilisationReport {
  id: string;
  product_group: string;
  marking_codes: string[];
  status: "draft" | "pending" | "accepted" | "rejected" | "error";
  report_id: string | null;
  error_message: string | null;
}

export interface AggregationDocument {
  id: string;
  kitu_code: string;
  product_group: string;
  marking_codes: string[];
  status: "draft" | "pending" | "accepted" | "rejected" | "error";
  aggregation_type?: string;
  product_card_id?: string | null;
  document_id: string | null;
  error_message: string | null;
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (err && typeof err === "object" && "response" in err) {
    const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
    if (typeof detail === "string") {
      return detail;
    }
  }
  return "Неизвестная ошибка";
}

export async function createUtilisationDraft(
  markingCodes: string[],
  productGroup: string,
): Promise<UtilisationReport> {
  const res = await apiClient.post<UtilisationReport>("/utilisation/", {
    marking_codes: markingCodes,
    product_group: productGroup,
  });
  return res.data;
}

export async function sendUtilisationDocument(reportId: string): Promise<UtilisationReport> {
  const bodyRes = await apiClient.get<{ body: string }>(`/utilisation/${reportId}/body`);
  const signature = await signBody(bodyRes.data.body);
  try {
    const sendRes = await apiClient.post<UtilisationReport>(`/utilisation/${reportId}/send`, {
      signature,
    });
    return sendRes.data;
  } catch (err) {
    throw new Error(extractErrorMessage(err));
  }
}

export async function createAggregationDraft(
  markingCodes: string[],
  productGroup: string,
  kituCode: string,
  unitsCapacity?: number | null,
): Promise<AggregationDocument> {
  const res = await apiClient.post<AggregationDocument>("/aggregation/", {
    marking_codes: markingCodes,
    product_group: productGroup,
    kitu_code: kituCode,
    units_capacity: unitsCapacity ?? null,
    aggregation_type: "AGGREGATION",
  });
  return res.data;
}

export interface SetAggregationDraftParams {
  markingCodes: string[];
  productGroup: string;
  setCode: string;
  productCardId: string;
}

export async function createSetAggregationDraft(
  params: SetAggregationDraftParams,
): Promise<AggregationDocument> {
  const res = await apiClient.post<AggregationDocument>("/aggregation/", {
    marking_codes: params.markingCodes,
    product_group: params.productGroup,
    kitu_code: params.setCode,
    aggregation_type: "SETS_AGGREGATION",
    product_card_id: params.productCardId,
  });
  return res.data;
}

export async function sendSetAggregationDocument(docId: string): Promise<AggregationDocument> {
  return sendAggregationDocument(docId);
}

export async function sendAggregationDocument(docId: string): Promise<AggregationDocument> {
  const bodyRes = await apiClient.get<{ body_b64: string }>(`/aggregation/${docId}/body`);
  const signature = await signBodyBase64(bodyRes.data.body_b64);
  try {
    const sendRes = await apiClient.post<AggregationDocument>(`/aggregation/${docId}/send`, {
      signature,
    });
    return sendRes.data;
  } catch (err) {
    throw new Error(extractErrorMessage(err));
  }
}

export interface IntroduceGoodsSendOptions {
  productionDate?: string | null;
  defaultTnvedCode?: string;
  fillTnvedFromCards?: boolean;
  fillCertificateFromCards?: boolean;
}

export interface IntroduceGoodsSendResult {
  success: boolean;
  response?: unknown;
}

export async function sendIntroduceGoodsDocument(
  markingCodes: string[],
  productGroup: string,
  options: IntroduceGoodsSendOptions = {},
): Promise<IntroduceGoodsSendResult> {
  const bodyRes = await apiClient.post<{ body: string; body_b64: string }>(
    "/emission-orders/introduce-goods-body",
    {
      marking_codes: markingCodes,
      product_group: productGroup,
      production_date: options.productionDate || null,
      default_tnved_code: options.defaultTnvedCode || null,
      fill_tnved_from_cards: options.fillTnvedFromCards ?? false,
      fill_certificate_from_cards: options.fillCertificateFromCards ?? false,
    },
  );
  const signature = await signBodyBase64(bodyRes.data.body_b64);
  try {
    const sendRes = await apiClient.post<IntroduceGoodsSendResult>(
      "/emission-orders/introduce-goods",
      {
        marking_codes: markingCodes,
        product_group: productGroup,
        production_date: options.productionDate || null,
        default_tnved_code: options.defaultTnvedCode || null,
        fill_tnved_from_cards: options.fillTnvedFromCards ?? false,
        fill_certificate_from_cards: options.fillCertificateFromCards ?? false,
        signature,
      },
    );
    return sendRes.data;
  } catch (err) {
    throw new Error(extractErrorMessage(err));
  }
}
