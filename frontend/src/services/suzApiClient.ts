import axios, { type AxiosInstance } from "axios";

export type SuzClientConfig = {
  baseUrl: string;
  omsId: string;
  clientToken: string;
};

export type CreateSuzOrderBody = {
  productGroup: string;
  products: Array<Record<string, unknown>>;
  attributes: Record<string, unknown>;
};

export type CreateSuzOrderResponse = {
  omsId?: string;
  orderId: string;
  expectedCompleteTimestamp?: number;
};

function normalizeSignature(sig: string): string {
  return sig.replace(/\r\n/g, "").replace(/\n/g, "").trim();
}

export class SuzApiClient {
  private readonly http: AxiosInstance;
  private readonly omsId: string;

  constructor(config: SuzClientConfig) {
    const base = config.baseUrl.replace(/\/+$/, "");
    this.omsId = config.omsId.trim();
    this.http = axios.create({
      baseURL: base,
      timeout: 60_000,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        clientToken: config.clientToken.trim(),
      },
    });
  }

  async createOrder(body: CreateSuzOrderBody, xSignature: string): Promise<CreateSuzOrderResponse> {
    const bodyString = JSON.stringify(body);
    const response = await this.http.post<CreateSuzOrderResponse>(
      "/api/v3/order",
      bodyString,
      {
        params: { omsId: this.omsId },
        headers: { "X-Signature": normalizeSignature(xSignature) },
        transformRequest: [(data) => data],
      },
    );
    const orderId = response.data.orderId;
    if (!orderId) {
      throw new Error("Ответ СУЗ не содержит orderId.");
    }
    return response.data;
  }

  async getOrderStatus(orderId: string): Promise<Record<string, unknown>> {
    const response = await this.http.get<Record<string, unknown>>(
      `/api/v3/order/${encodeURIComponent(orderId)}/status`,
      { params: { omsId: this.omsId } },
    );
    return response.data;
  }

  async getCodes(
    orderId: string,
    gtin: string,
    quantity: number,
    lastBlockId = 0,
  ): Promise<string[]> {
    const response = await this.http.get<string[] | Record<string, unknown>>(
      `/api/v3/order/${encodeURIComponent(orderId)}/codes`,
      {
        params: {
          omsId: this.omsId,
          gtin,
          quantity,
          lastBlockId,
        },
      },
    );
    if (Array.isArray(response.data)) {
      return response.data.map(String);
    }
    const data = response.data;
    for (const key of ["codes", "cisList", "cises", "items"]) {
      const inner = data[key];
      if (Array.isArray(inner)) {
        return inner.map(String);
      }
    }
    return [];
  }
}
