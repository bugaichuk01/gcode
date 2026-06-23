/** Разбор и валидация кодов маркировки (КМ) — GS1 AI 01/21/91/92. */

const GS_SEPARATOR = "\x1d";

/** Fallback, если структурный разбор не выявил криптохвост (единый порог для всего проекта). */
export const MARKING_CODE_MIN_LENGTH_WITH_CRYPTO_TAIL = 50;

export const CRYPTO_TAIL_PRINT_ERROR =
  "Короткие коды без криптохвоста печатать нельзя. Загрузите исходные файлы с длинными кодами.";

const FULL_KM_PATTERN =
  /^(01\d{14})(21.+?)(91[A-F0-9]{4})(92.+)$/i;

function findCryptoSegmentIndices(code: string): { idx91: number; idx92: number } | null {
  if (code.includes(GS_SEPARATOR)) {
    const parts = code.split(GS_SEPARATOR);
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part.toUpperCase().startsWith("91") && part.length >= 6) {
        const idx91 = code.indexOf(part);
        if (i + 1 < parts.length && parts[i + 1].toUpperCase().startsWith("92")) {
          return { idx91, idx92: code.indexOf(parts[i + 1]) };
        }
        return { idx91, idx92: -1 };
      }
    }
    return null;
  }

  const m = code.match(FULL_KM_PATTERN);
  if (m && m.index !== undefined) {
    const idx91 = m.index + m[1].length + m[2].length;
    const idx92 = idx91 + m[3].length;
    return { idx91, idx92 };
  }

  let idx91 = code.indexOf("91FFD0");
  if (idx91 === -1) {
    for (let i = 30; i < code.length - 6; i++) {
      if (code.slice(i, i + 2) === "91" && code.slice(i + 6, i + 8) === "92") {
        idx91 = i;
        break;
      }
    }
  }
  if (idx91 > 0) {
    const idx92 = code.indexOf("92", idx91 + 4);
    if (idx92 > 0) {
      return { idx91, idx92 };
    }
  }
  return null;
}

/** True, если в коде маркировки присутствует криптохвост (AI 91 / 92). */
export function hasCryptoTail(code: string): boolean {
  const trimmed = (code || "").trim();
  if (!trimmed) {
    return false;
  }
  if (findCryptoSegmentIndices(trimmed) !== null) {
    return true;
  }
  return trimmed.length >= MARKING_CODE_MIN_LENGTH_WITH_CRYPTO_TAIL;
}

export function filterPrintableCodes(codes: string[]): {
  printable: string[];
  rejected: string[];
} {
  const printable: string[] = [];
  const rejected: string[] = [];
  for (const code of codes) {
    if (hasCryptoTail(code)) {
      printable.push(code);
    } else {
      rejected.push(code);
    }
  }
  return { printable, rejected };
}

export const CRYPTO_TAIL_MISSING_LABEL = "без криптохвоста — печать недоступна";
