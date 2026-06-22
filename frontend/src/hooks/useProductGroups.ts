import { useEffect, useState } from "react";
import apiClient from "../api/client";

export interface ProductGroup {
  value: string;
  label: string;
}

// Дефолтный список на случай если API недоступен
const DEFAULT_GROUPS: ProductGroup[] = [
  { value: "perfumery", label: "Духи и туалетная вода" },
  { value: "lp", label: "Лёгкая промышленность" },
  { value: "shoes", label: "Обувь" },
  { value: "linen", label: "Постельное бельё" },
  { value: "tires", label: "Шины и покрышки" },
  { value: "milk", label: "Молочная продукция" },
  { value: "water", label: "Питьевая вода" },
  { value: "tobacco", label: "Табак" },
  { value: "automotive", label: "Автозапчасти и комплектующие" },
  { value: "bicycle", label: "Велосипеды" },
  { value: "photo", label: "Фотоаппараты" },
  { value: "antiseptic", label: "Антисептики" },
  { value: "medicines", label: "Лекарственные препараты" },
];

export function useProductGroups() {
  const [groups, setGroups] = useState<ProductGroup[]>(DEFAULT_GROUPS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.get<ProductGroup[]>("/product-cards/available-product-groups")
      .then(res => {
        if (res.data && res.data.length > 0) {
          setGroups(res.data);
        }
      })
      .catch(() => {
        // При ошибке оставить дефолтный список
      })
      .finally(() => setLoading(false));
  }, []);

  return { groups, loading };
}
