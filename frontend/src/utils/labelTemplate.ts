import type { LabelElement } from "../labels/blockRegistry";

/** Имя пользовательской копии при форке стандартного шаблона. */
export function deriveCopyName(originalName: string): string {
  return `${originalName} (копия)`;
}

export interface LayoutSnapshot {
  name: string;
  width_mm: number;
  height_mm: number;
  elements: LabelElement[];
}

export function createLayoutSnapshot(
  name: string,
  width_mm: number,
  height_mm: number,
  elements: LabelElement[],
): LayoutSnapshot {
  return {
    name: name.trim(),
    width_mm,
    height_mm,
    elements: elements.map((e) => ({ ...e })),
  };
}

function normalizeLayoutForCompare(snapshot: LayoutSnapshot): string {
  return JSON.stringify({
    name: snapshot.name.trim(),
    width_mm: snapshot.width_mm,
    height_mm: snapshot.height_mm,
    elements: [...snapshot.elements]
      .map((e) => ({ ...e }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

export function layoutSnapshotsEqual(a: LayoutSnapshot, b: LayoutSnapshot): boolean {
  return normalizeLayoutForCompare(a) === normalizeLayoutForCompare(b);
}
