import { useCallback, useEffect, useRef } from "react";

const DEFAULT_INTER_CHAR_MS = 100;

export type UseWedgeScannerOptions = {
  onScan: (code: string) => void;
  enabled?: boolean;
  interCharTimeoutMs?: number;
  autoFocus?: boolean;
};

/**
 * Обработчик ввода для keyboard-wedge сканера и ручной эмуляции (ввод + Enter).
 * Enter завершает код; таймаут между символами — для сканеров без суффикса Enter.
 */
export function useWedgeScanner({
  onScan,
  enabled = true,
  interCharTimeoutMs = DEFAULT_INTER_CHAR_MS,
  autoFocus = true,
}: UseWedgeScannerOptions) {
  const inputRef = useRef<HTMLInputElement>(null);
  const timeoutRef = useRef<number | null>(null);
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const clearPendingTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const completeScan = useCallback(
    (raw: string) => {
      clearPendingTimeout();
      const code = raw.trim();
      if (inputRef.current) {
        inputRef.current.value = "";
      }
      if (code) {
        onScanRef.current(code);
      }
    },
    [clearPendingTimeout],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (!enabled) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        completeScan(event.currentTarget.value);
      }
    },
    [completeScan, enabled],
  );

  const handleInput = useCallback(
    (event: React.FormEvent<HTMLInputElement>) => {
      if (!enabled) {
        return;
      }
      const value = event.currentTarget.value;
      clearPendingTimeout();
      timeoutRef.current = window.setTimeout(() => {
        if (value.trim()) {
          completeScan(value);
        }
      }, interCharTimeoutMs);
    },
    [clearPendingTimeout, completeScan, enabled, interCharTimeoutMs],
  );

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!enabled || !autoFocus) {
      return;
    }
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoFocus, enabled]);

  useEffect(() => () => clearPendingTimeout(), [clearPendingTimeout]);

  return {
    inputRef,
    handleKeyDown,
    handleInput,
    focusInput,
  };
}
