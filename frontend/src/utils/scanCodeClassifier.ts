import {
  AGGR_END_CODE,
  AGGR_START_CODE,
} from "../constants/aggregationSystemCodes";
import { hasCryptoTail } from "./markingCode";

export { AGGR_END_CODE, AGGR_START_CODE };

export type ScannedCodeKind = "kitu" | "unit" | "aggr_start" | "aggr_end" | "unknown";

export function normalizeScannedCode(raw: string): string {
  return raw.trim().replace(/\r/g, "");
}

/** 18 цифр (после удаления нецифровых) → SSCC/КИТУ. */
export function isKituCode(code: string): boolean {
  const digits = code.replace(/\D/g, "");
  return digits.length === 18 && /^\d{18}$/.test(digits);
}

export function extractKituDigits(code: string): string {
  return code.replace(/\D/g, "").slice(0, 18);
}

export function classifyScannedCode(raw: string): ScannedCodeKind {
  const code = normalizeScannedCode(raw);
  if (!code) {
    return "unknown";
  }
  if (code === AGGR_START_CODE) {
    return "aggr_start";
  }
  if (code === AGGR_END_CODE) {
    return "aggr_end";
  }
  if (isKituCode(code)) {
    return "kitu";
  }
  if (hasCryptoTail(code)) {
    return "unit";
  }
  return "unknown";
}
