import apiClient from "../api/client";

export type GtinProductFields = {
  name: string;
  article: string;
  size: string;
};

export async function fetchGtinProductFields(gtin: string): Promise<GtinProductFields> {
  const fields: GtinProductFields = { name: "", article: "", size: "" };
  if (!gtin) {
    return fields;
  }

  const [extraResult, cardsResult] = await Promise.allSettled([
    apiClient.get(`/extra-fields/?gtin=${encodeURIComponent(gtin)}`),
    apiClient.get(`/product-cards/?gtin=${encodeURIComponent(gtin)}`),
  ]);

  if (extraResult.status === "fulfilled") {
    const extraItems = extraResult.value.data.items ?? [];
    if (extraItems.length > 0) {
      const extra = extraItems[0];
      if (extra.name) fields.name = extra.name;
      if (extra.article) fields.article = extra.article;
      if (extra.size) fields.size = extra.size;
    }
  }

  if (cardsResult.status === "fulfilled") {
    const cards = Array.isArray(cardsResult.value.data)
      ? cardsResult.value.data
      : (cardsResult.value.data as { items?: { name?: string }[] }).items ?? [];
    if (cards.length > 0 && cards[0].name) {
      fields.name = cards[0].name;
    }
  }

  return fields;
}

export async function fetchGtinProductFieldsMap(
  gtins: string[],
): Promise<Record<string, GtinProductFields>> {
  const unique = [...new Set(gtins.filter(Boolean))];
  const entries = await Promise.all(
    unique.map(async (gtin) => [gtin, await fetchGtinProductFields(gtin)] as const),
  );
  return Object.fromEntries(entries);
}
