import apiClient from "../api/client";
import { serializeSuzOrderBody, signBody } from "./signingService";

export type SuzOrderBody = {
  productGroup: string;
  products: Array<Record<string, unknown>>;
  attributes: Record<string, unknown>;
};

export type SuzCreateOrderResult = {
  emission_order?: {
    id: string;
    suz_order_id: string | null;
    status: string;
  };
  suz: {
    remote_order_id: string;
    payload: Record<string, unknown>;
  };
};

export async function createSuzOrderViaProxy(
  orderBody: SuzOrderBody,
  options: { localOrderId?: string; certIndex?: number; thumbprint?: string } = {},
): Promise<SuzCreateOrderResult> {
  const bodyString = serializeSuzOrderBody(orderBody);
  const signature = await signBody(bodyString, {
    certIndex: options.certIndex,
    thumbprint: options.thumbprint,
  });

  const response = await apiClient.post<SuzCreateOrderResult>("/emission-orders/create", {
    order_body: orderBody,
    body_string: bodyString,
    signature,
    ...(options.localOrderId ? { local_order_id: options.localOrderId } : {}),
  });

  return response.data;
}

export async function sendLocalOrderToSuz(
  localOrderId: string,
  orderBody: SuzOrderBody,
  bodyString: string,
  options: { certIndex?: number; thumbprint?: string } = {},
): Promise<SuzCreateOrderResult> {
  const signature = await signBody(bodyString, {
    certIndex: options.certIndex,
    thumbprint: options.thumbprint,
  });

  const response = await apiClient.post<SuzCreateOrderResult>(
    `/emission-orders/${localOrderId}/send`,
    {
      order_body: orderBody,
      body_string: bodyString,
      signature,
    },
  );

  return response.data;
}

export async function closeEmissionOrder(
  localOrderId: string,
  suzOrderId: string,
  options: { certIndex?: number; thumbprint?: string } = {},
): Promise<void> {
  const bodyToSign = JSON.stringify({ orderId: suzOrderId });

  const signature = await signBody(bodyToSign, {
    certIndex: options.certIndex,
    thumbprint: options.thumbprint,
  });

  await apiClient.post(`/emission-orders/${localOrderId}/close`, {
    signature,
  });
}
