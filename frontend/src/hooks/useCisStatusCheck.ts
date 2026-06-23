import { useCallback, useMemo, useState } from "react";
import {
  type CisStatusRowFields,
  fetchCisStatuses,
} from "../utils/cisStatus";

export function useCisStatusCheck() {
  const [checking, setChecking] = useState(false);
  const [checkedCount, setCheckedCount] = useState(0);
  const [results, setResults] = useState<Record<string, CisStatusRowFields>>({});
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async (codes: string[]) => {
    if (codes.length === 0) {
      return null;
    }

    setChecking(true);
    setCheckedCount(0);
    setError(null);

    try {
      const allResults = await fetchCisStatuses(codes, setCheckedCount);
      setResults(allResults);
      return allResults;
    } catch {
      setError("Ошибка при проверке статусов");
      return null;
    } finally {
      setChecking(false);
    }
  }, []);

  const statusByCode = useMemo(
    () => Object.fromEntries(Object.entries(results).map(([code, fields]) => [code, fields.status])),
    [results],
  );

  return {
    checking,
    checkedCount,
    results,
    statusByCode,
    error,
    setError,
    checkStatus,
  };
}
