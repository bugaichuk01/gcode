import type { ReactNode } from "react";

export type BlockType = "datamatrix" | "text" | "field" | "line" | "barcode_ean13";

export interface LabelElement {
  id: string;
  type: BlockType;
  x: number;
  y: number;
  size?: number;
  text?: string;
  field_key?: string;
  font_size?: number;
  bold?: boolean;
  max_width?: number;
  width?: number;
  height?: number;
  x2?: number;
  y2?: number;
}

export interface FieldCatalogItem {
  key: string;
  label: string;
  source: string;
  example: string;
  tab: string;
}

export interface ElementUpdateProps {
  element: LabelElement;
  onUpdate: (changes: Partial<LabelElement>) => void;
  fieldVariables: { var: string; label: string }[];
}

export interface BlockTypeDefinition {
  label: string;
  toolbarIcon: string;
  defaultGeometry: Partial<Omit<LabelElement, "id" | "type" | "x" | "y">>;
  renderCanvas: (
    el: LabelElement,
    scale: number,
    previewText: (text: string) => string,
    fieldCatalog?: FieldCatalogItem[],
  ) => ReactNode;
  renderProperties: (props: ElementUpdateProps) => ReactNode;
}

export const SCALE = 8;

const MARGIN_MM = 2;
const MIN_DATAMATRIX_MM = 4;
const DEFAULT_DATAMATRIX_MM = 30;
const DEFAULT_BARCODE_WIDTH_MM = 38;
const DEFAULT_BARCODE_HEIGHT_MM = 15;
const DEFAULT_LINE_LENGTH_MM = 30;

function clampPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  labelWidthMm: number,
  labelHeightMm: number,
): { x: number; y: number } {
  const maxX = Math.max(MARGIN_MM, labelWidthMm - width - MARGIN_MM);
  const maxY = Math.max(MARGIN_MM, labelHeightMm - height - MARGIN_MM);
  return {
    x: Math.max(MARGIN_MM, Math.min(x, maxX)),
    y: Math.max(MARGIN_MM, Math.min(y, maxY)),
  };
}

export function cappedDatamatrixSize(
  labelWidthMm: number,
  labelHeightMm: number,
  x: number,
  y: number,
  preferred = DEFAULT_DATAMATRIX_MM,
): number {
  const maxByLabel = Math.min(labelWidthMm, labelHeightMm) - MARGIN_MM * 2;
  const maxByPosition = Math.min(
    labelWidthMm - x - MARGIN_MM,
    labelHeightMm - y - MARGIN_MM,
  );
  const cap = Math.min(preferred, maxByLabel, maxByPosition);
  return Math.max(MIN_DATAMATRIX_MM, Math.floor(cap));
}

function cappedBarcodeSize(
  labelWidthMm: number,
  labelHeightMm: number,
  x: number,
  y: number,
): { width: number; height: number } {
  const maxWidth = labelWidthMm - x - MARGIN_MM;
  const maxHeight = labelHeightMm - y - MARGIN_MM;
  return {
    width: Math.max(8, Math.min(DEFAULT_BARCODE_WIDTH_MM, maxWidth)),
    height: Math.max(6, Math.min(DEFAULT_BARCODE_HEIGHT_MM, maxHeight)),
  };
}

function cappedLineEnd(
  x: number,
  y: number,
  labelWidthMm: number,
  labelHeightMm: number,
): { x2: number; y2: number } {
  return {
    x2: Math.min(x + DEFAULT_LINE_LENGTH_MM, labelWidthMm - MARGIN_MM),
    y2: Math.min(y, labelHeightMm - MARGIN_MM),
  };
}

export function isElementOutOfBounds(
  el: LabelElement,
  labelWidthMm: number,
  labelHeightMm: number,
): boolean {
  const merged = mergeElementDefaults(el);

  if (merged.x < 0 || merged.y < 0) {
    return true;
  }

  switch (merged.type) {
    case "datamatrix": {
      const size = merged.size ?? DEFAULT_DATAMATRIX_MM;
      return (
        merged.x + size > labelWidthMm || merged.y + size > labelHeightMm
      );
    }
    case "barcode_ean13": {
      const width = merged.width ?? DEFAULT_BARCODE_WIDTH_MM;
      const height = merged.height ?? DEFAULT_BARCODE_HEIGHT_MM;
      return (
        merged.x + width > labelWidthMm || merged.y + height > labelHeightMm
      );
    }
    case "line": {
      const x2 = merged.x2 ?? merged.x + DEFAULT_LINE_LENGTH_MM;
      const y2 = merged.y2 ?? merged.y;
      return (
        x2 > labelWidthMm ||
        y2 > labelHeightMm ||
        x2 < 0 ||
        y2 < 0
      );
    }
    case "text": {
      const fontSize = merged.font_size ?? 6;
      const height = Math.max(fontSize * 0.4, 2);
      const width =
        merged.max_width ??
        Math.min(labelWidthMm, (merged.text?.length ?? 4) * fontSize * 0.15);
      return (
        merged.x + width > labelWidthMm || merged.y + height > labelHeightMm
      );
    }
    case "field": {
      const fontSize = merged.font_size ?? 6;
      const height = Math.max(fontSize * 0.4, 2);
      const estLen = merged.field_key?.length ?? 8;
      const width =
        merged.max_width ?? Math.min(labelWidthMm, estLen * fontSize * 0.15);
      return (
        merged.x + width > labelWidthMm || merged.y + height > labelHeightMm
      );
    }
    default:
      return false;
  }
}

export const BLOCK_REGISTRY: Record<BlockType, BlockTypeDefinition> = {
  datamatrix: {
    label: "DataMatrix",
    toolbarIcon: "⬛",
    defaultGeometry: { size: 30 },
    renderCanvas: (el, scale) => (
      <div
        className="bg-slate-800 flex items-center justify-center text-white text-xs"
        style={{
          width: (el.size || 30) * scale,
          height: (el.size || 30) * scale,
        }}
      >
        <span className="text-xs opacity-60">DM</span>
      </div>
    ),
    renderProperties: ({ element, onUpdate }) => (
      <div>
        <label className="text-xs text-slate-500">Размер (мм)</label>
        <input
          type="number"
          value={element.size || 30}
          onChange={(e) => onUpdate({ size: Number(e.target.value) })}
          className="w-full px-2 py-1 border border-slate-300 rounded text-sm mt-1"
        />
      </div>
    ),
  },
  barcode_ean13: {
    label: "EAN-13",
    toolbarIcon: "▓",
    defaultGeometry: { width: 38, height: 15 },
    renderCanvas: (el, scale) => (
      <div
        style={{
          width: (el.width || 38) * scale,
          height: (el.height || 15) * scale,
          background:
            "repeating-linear-gradient(90deg, #000 0px, #000 2px, #fff 2px, #fff 4px)",
          border: "1px solid #000",
        }}
        className="flex items-end justify-center pb-1"
      >
        <span style={{ fontSize: 8, background: "#fff", padding: "0 2px" }}>
          0290000406494 ←EAN
        </span>
      </div>
    ),
    renderProperties: ({ element, onUpdate }) => (
      <>
        <div>
          <label className="text-xs text-slate-500">Ширина (мм)</label>
          <input
            type="number"
            value={element.width || 38}
            onChange={(e) => onUpdate({ width: Number(e.target.value) })}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">Высота (мм)</label>
          <input
            type="number"
            value={element.height || 15}
            onChange={(e) => onUpdate({ height: Number(e.target.value) })}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <div className="rounded bg-blue-50 px-2 py-2 text-xs text-blue-600">
          GTIN берётся автоматически из кода маркировки
        </div>
      </>
    ),
  },
  text: {
    label: "Текст",
    toolbarIcon: "T",
    defaultGeometry: { text: "Текст", font_size: 6, bold: false },
    renderCanvas: (el, scale, previewText) => (
      <div
        style={{
          fontSize: (el.font_size || 6) * scale * 0.4,
          fontWeight: el.bold ? "bold" : "normal",
          maxWidth: el.max_width ? el.max_width * scale : undefined,
          whiteSpace: "nowrap",
          overflow: "hidden",
          color: "#1e293b",
          lineHeight: 1.2,
        }}
      >
        {previewText(el.text || "")}
      </div>
    ),
    renderProperties: ({ element, onUpdate, fieldVariables }) => (
      <>
        <div>
          <label className="text-xs text-slate-500">Текст / переменная</label>
          <input
            value={element.text || ""}
            onChange={(e) => onUpdate({ text: e.target.value })}
            className="w-full px-2 py-1 border border-slate-300 rounded text-sm mt-1"
            placeholder="{name}"
          />
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-1">Переменные:</p>
          <div className="flex flex-wrap gap-1">
            {fieldVariables.map((v) => (
              <button
                key={v.var}
                type="button"
                onClick={() => onUpdate({ text: (element.text || "") + v.var })}
                className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-xs hover:bg-slate-200"
                title={v.label}
              >
                {v.var}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-500">Размер шрифта (пт)</label>
          <input
            type="number"
            value={element.font_size || 6}
            onChange={(e) => onUpdate({ font_size: Number(e.target.value) })}
            className="w-full px-2 py-1 border border-slate-300 rounded text-sm mt-1"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="bold"
            checked={element.bold || false}
            onChange={(e) => onUpdate({ bold: e.target.checked })}
          />
          <label htmlFor="bold" className="text-xs text-slate-600">
            Жирный
          </label>
        </div>
        <div>
          <label className="text-xs text-slate-500">Макс. ширина (мм, 0=нет)</label>
          <input
            type="number"
            value={element.max_width || 0}
            onChange={(e) =>
              onUpdate({ max_width: Number(e.target.value) || undefined })
            }
            className="w-full px-2 py-1 border border-slate-300 rounded text-sm mt-1"
          />
        </div>
      </>
    ),
  },
  field: {
    label: "Поле",
    toolbarIcon: "F",
    defaultGeometry: { field_key: "name", font_size: 6, bold: false },
    renderCanvas: (el, scale, _previewText, catalog) => {
      const field = catalog?.find((f) => f.key === el.field_key);
      const display = field?.example ?? `{${el.field_key ?? "?"}}`;
      return (
        <div
          style={{
            fontSize: (el.font_size || 6) * scale * 0.4,
            fontWeight: el.bold ? "bold" : "normal",
            maxWidth: el.max_width ? el.max_width * scale : undefined,
            whiteSpace: "nowrap",
            overflow: "hidden",
            color: "#1e293b",
            lineHeight: 1.2,
          }}
        >
          {display}
        </div>
      );
    },
    renderProperties: ({ element, onUpdate, fieldVariables }) => {
      const fieldLabel =
        fieldVariables.find((v) => v.var === `{${element.field_key}}`)?.label ??
        element.field_key ??
        "—";
      return (
        <>
          <div>
            <label className="text-xs text-slate-500">Поле</label>
            <p className="mt-1 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700">
              {fieldLabel}
            </p>
          </div>
          <div>
            <label className="text-xs text-slate-500">Размер шрифта (пт)</label>
            <input
              type="number"
              value={element.font_size || 6}
              onChange={(e) => onUpdate({ font_size: Number(e.target.value) })}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="field-bold"
              checked={element.bold || false}
              onChange={(e) => onUpdate({ bold: e.target.checked })}
            />
            <label htmlFor="field-bold" className="text-xs text-slate-600">
              Жирный
            </label>
          </div>
          <div>
            <label className="text-xs text-slate-500">Макс. ширина (мм, 0=нет)</label>
            <input
              type="number"
              value={element.max_width || 0}
              onChange={(e) =>
                onUpdate({ max_width: Number(e.target.value) || undefined })
              }
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
        </>
      );
    },
  },
  line: {
    label: "Линия",
    toolbarIcon: "—",
    defaultGeometry: { x2: 30, y2: 5 },
    renderCanvas: (el, scale) => (
      <svg
        style={{
          position: "absolute",
          overflow: "visible",
          pointerEvents: "none",
        }}
      >
        <line
          x1={0}
          y1={0}
          x2={(el.x2 || 20) * scale - el.x * scale}
          y2={(el.y2 || el.y) * scale - el.y * scale}
          stroke="#1e293b"
          strokeWidth="1"
        />
      </svg>
    ),
    renderProperties: ({ element, onUpdate }) => (
      <div>
        <p className="text-xs text-slate-500 mb-1">Конец (мм)</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-slate-400">X2</label>
            <input
              type="number"
              value={element.x2 || 0}
              onChange={(e) => onUpdate({ x2: Number(e.target.value) })}
              className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Y2</label>
            <input
              type="number"
              value={element.y2 || 0}
              onChange={(e) => onUpdate({ y2: Number(e.target.value) })}
              className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
            />
          </div>
        </div>
      </div>
    ),
  },
};

export const BLOCK_TYPES = Object.keys(BLOCK_REGISTRY) as BlockType[];

export function mergeElementDefaults(el: LabelElement): LabelElement {
  const def = BLOCK_REGISTRY[el.type];
  if (!def) return el;
  return { ...def.defaultGeometry, ...el };
}

export function createElement(
  type: BlockType,
  x: number,
  y: number,
  id: string,
  labelWidthMm: number,
  labelHeightMm: number,
  overrides?: Partial<LabelElement>,
): LabelElement {
  const def = BLOCK_REGISTRY[type];
  const base: LabelElement = { id, type, x, y };

  switch (type) {
    case "datamatrix": {
      const size = cappedDatamatrixSize(labelWidthMm, labelHeightMm, x, y);
      const pos = clampPosition(x, y, size, size, labelWidthMm, labelHeightMm);
      return { ...base, ...pos, size, ...overrides };
    }
    case "barcode_ean13": {
      const { width, height } = cappedBarcodeSize(
        labelWidthMm,
        labelHeightMm,
        x,
        y,
      );
      const pos = clampPosition(x, y, width, height, labelWidthMm, labelHeightMm);
      return { ...base, ...pos, width, height, ...overrides };
    }
    case "line": {
      const pos = clampPosition(x, y, 1, 1, labelWidthMm, labelHeightMm);
      const lineEnd = cappedLineEnd(
        pos.x,
        pos.y,
        labelWidthMm,
        labelHeightMm,
      );
      return { ...base, ...pos, ...lineEnd, ...overrides };
    }
    default:
      return { ...base, ...def.defaultGeometry, ...overrides };
  }
}

export function newTemplateElements(
  widthMm: number,
  heightMm: number,
  generateId: () => string,
): LabelElement[] {
  const dmX = Math.min(Math.round(widthMm * 0.6), widthMm - MARGIN_MM - MIN_DATAMATRIX_MM);
  return [
    createElement("datamatrix", dmX, MARGIN_MM, generateId(), widthMm, heightMm),
    createElement("text", MARGIN_MM, MARGIN_MM, generateId(), widthMm, heightMm, {
      text: "{name}",
      bold: true,
      max_width: Math.max(MARGIN_MM, Math.round(widthMm * 0.55)),
    }),
  ];
}

export function fieldVariablesFromCatalog(
  catalog: FieldCatalogItem[],
): { var: string; label: string }[] {
  return catalog.map((f) => ({ var: `{${f.key}}`, label: f.label }));
}

export function previewTextFromCatalog(text: string, catalog: FieldCatalogItem[]): string {
  let result = text;
  for (const field of catalog) {
    result = result.replace(`{${field.key}}`, field.example);
  }
  return result;
}

export function getBlockLabel(
  type: BlockType,
  element?: LabelElement,
  catalog?: FieldCatalogItem[],
): string {
  if (type === "field" && element?.field_key && catalog) {
    return catalog.find((f) => f.key === element.field_key)?.label ?? "Поле";
  }
  return BLOCK_REGISTRY[type]?.label ?? type;
}

export function renderCanvasElement(
  el: LabelElement,
  scale: number,
  previewText: (text: string) => string,
  fieldCatalog?: FieldCatalogItem[],
): ReactNode {
  const def = BLOCK_REGISTRY[el.type];
  if (!def) {
    console.warn("Неизвестный тип блока этикетки, пропуск:", el.type);
    return null;
  }
  return def.renderCanvas(mergeElementDefaults(el), scale, previewText, fieldCatalog);
}
