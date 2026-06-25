/** Канонический набор размеров этикеток (единый источник правды для UI). */
export interface LabelSizePreset {
  width_mm: number;
  height_mm: number;
  label: string;
}

export const LABEL_SIZE_PRESETS: LabelSizePreset[] = [
  { width_mm: 10, height_mm: 10, label: "10×10" },
  { width_mm: 13, height_mm: 13, label: "13×13" },
  { width_mm: 15, height_mm: 15, label: "15×15" },
  { width_mm: 16, height_mm: 16, label: "16×16" },
  { width_mm: 20, height_mm: 20, label: "20×20" },
  { width_mm: 20, height_mm: 22, label: "20×22" },
  { width_mm: 40, height_mm: 20, label: "40×20" },
  { width_mm: 43, height_mm: 25, label: "43×25" },
  { width_mm: 58, height_mm: 40, label: "58×40" },
  { width_mm: 60, height_mm: 40, label: "60×40" },
  { width_mm: 80, height_mm: 50, label: "80×50" },
];

export const DEFAULT_SIZE_PRESET: LabelSizePreset =
  LABEL_SIZE_PRESETS.find((p) => p.width_mm === 58 && p.height_mm === 40) ??
  LABEL_SIZE_PRESETS[0];

export function sizePresetKey(width_mm: number, height_mm: number): string {
  return `${width_mm}x${height_mm}`;
}

export function findSizePreset(
  width_mm: number,
  height_mm: number,
): LabelSizePreset | undefined {
  return LABEL_SIZE_PRESETS.find(
    (p) => p.width_mm === width_mm && p.height_mm === height_mm,
  );
}

export interface LabelSizeOption {
  key: string;
  label: string;
  width_mm: number;
  height_mm: number;
}

/** Опции для select; при не-пресетном размере шаблона добавляет кастомный пункт. */
export function getSizeOptionsForSelect(
  customSize?: { width_mm: number; height_mm: number } | null,
): LabelSizeOption[] {
  const options: LabelSizeOption[] = LABEL_SIZE_PRESETS.map((p) => ({
    key: sizePresetKey(p.width_mm, p.height_mm),
    label: p.label,
    width_mm: p.width_mm,
    height_mm: p.height_mm,
  }));

  if (
    customSize &&
    !findSizePreset(customSize.width_mm, customSize.height_mm)
  ) {
    options.push({
      key: sizePresetKey(customSize.width_mm, customSize.height_mm),
      label: `${customSize.width_mm}×${customSize.height_mm} (кастом)`,
      width_mm: customSize.width_mm,
      height_mm: customSize.height_mm,
    });
  }

  return options;
}
