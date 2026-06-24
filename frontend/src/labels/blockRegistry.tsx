import type { ReactNode } from "react";

import { AuthenticatedLabelImage, pickImageFile, uploadLabelImage } from "./labelImageApi";
import { resolveSignByKey, signSvgUrl } from "./signRegistry";

export type BlockType = "datamatrix" | "text" | "field" | "line" | "barcode_ean13" | "sign" | "image";

export type TextAlign = "left" | "center" | "right";

/** Стили части текста (подпись или значение). */
export interface TextPartStyle {
  font_size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  line_height?: number;
}

/** Настройки подписи поля. */
export interface LabelPartConfig extends TextPartStyle {
  /** Показывать подпись на этикетке (default false при отсутствии label). */
  show?: boolean;
  /** Текст подписи, напр. «Состав:». */
  text?: string;
  /** true = подпись отдельной строкой сверху; false = в одну строку со значением. */
  inline?: boolean;
}

/** Настройки значения поля. */
export interface ValuePartConfig extends TextPartStyle {
  /** Принудительный перенос строки значения. */
  force_wrap?: boolean;
}

export interface LabelElement {
  id: string;
  type: BlockType;
  x: number;
  y: number;
  size?: number;
  text?: string;
  field_key?: string;
  sign_key?: string;
  /** @deprecated Корневые стили — для обратной совместимости; новые блоки используют label/value. */
  font_size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  max_width?: number;
  width?: number;
  height?: number;
  x2?: number;
  y2?: number;
  image_id?: string;
  /** Горизонтальное выравнивание строк (default left). */
  text_align?: TextAlign;
  /** Внутренние отступы блока, мм (default 0). */
  padding_top?: number;
  padding_right?: number;
  padding_bottom?: number;
  padding_left?: number;
  /** Межстрочный интервал в pt (default font_size * 1.2 при переносе). */
  line_height?: number;
  /** Перенос по словам; false = одна строка с обрезкой (default). Legacy. */
  wrap?: boolean;
  label?: LabelPartConfig;
  value?: ValuePartConfig;
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

const DEFAULT_FONT_SIZE = 6;

function usesLabelValueModel(el: LabelElement): boolean {
  return el.label !== undefined || el.value !== undefined;
}

function rootTextStyle(el: LabelElement): Required<Pick<TextPartStyle, "font_size">> &
  TextPartStyle {
  return {
    font_size: el.font_size ?? DEFAULT_FONT_SIZE,
    bold: el.bold,
    italic: el.italic,
    underline: el.underline,
    line_height: el.line_height,
  };
}

export function effectiveLabelStyle(el: LabelElement): TextPartStyle {
  const root = rootTextStyle(el);
  const part = el.label ?? {};
  return {
    font_size: part.font_size ?? root.font_size,
    bold: part.bold ?? root.bold,
    italic: part.italic ?? root.italic,
    underline: part.underline ?? root.underline,
    line_height: part.line_height ?? root.line_height,
  };
}

export function effectiveValueStyle(el: LabelElement): TextPartStyle {
  const root = rootTextStyle(el);
  const part = el.value ?? {};
  return {
    font_size: part.font_size ?? root.font_size,
    bold: part.bold ?? root.bold,
    italic: part.italic ?? root.italic,
    underline: part.underline ?? root.underline,
    line_height: part.line_height ?? root.line_height,
  };
}

export function shouldShowLabel(el: LabelElement): boolean {
  return el.label?.show === true;
}

export function isLabelOnSeparateLine(el: LabelElement): boolean {
  return el.label?.inline === true;
}

export function valueForceWrap(el: LabelElement): boolean {
  if (usesLabelValueModel(el)) {
    return Boolean(el.value?.force_wrap);
  }
  return Boolean(el.wrap);
}

export function fieldBlockLabelDefaults(
  fieldKey: string,
  catalog?: FieldCatalogItem[],
): Pick<LabelElement, "label"> {
  const item = catalog?.find((f) => f.key === fieldKey);
  const labelText = `${item?.label ?? fieldKey}:`;
  return {
    label: { show: true, text: labelText, inline: false },
  };
}

function ptToCanvasPx(pt: number, scale: number): number {
  return pt * scale * 0.4;
}

function partCanvasStyle(
  style: TextPartStyle,
  scale: number,
  boxWidthMm: number | undefined,
  padTop: number,
  padRight: number,
  padBottom: number,
  padLeft: number,
  textAlign: TextAlign,
  wrap: boolean,
): React.CSSProperties {
  const fontSizePt = style.font_size ?? DEFAULT_FONT_SIZE;
  const lineHeightPt = style.line_height ?? fontSizePt * 1.2;

  return {
    fontSize: ptToCanvasPx(fontSizePt, scale),
    fontWeight: style.bold ? "bold" : "normal",
    fontStyle: style.italic ? "italic" : "normal",
    textDecoration: style.underline ? "underline" : "none",
    width: boxWidthMm ? boxWidthMm * scale : undefined,
    maxWidth: boxWidthMm ? boxWidthMm * scale : undefined,
    boxSizing: "border-box",
    padding: `${padTop}px ${padRight}px ${padBottom}px ${padLeft}px`,
    textAlign,
    whiteSpace: wrap ? "normal" : "nowrap",
    overflow: wrap ? "visible" : "hidden",
    overflowWrap: wrap ? "break-word" : undefined,
    wordBreak: wrap ? "break-word" : undefined,
    lineHeight: `${ptToCanvasPx(lineHeightPt, scale)}px`,
    color: "#1e293b",
  };
}

function textCanvasStyle(
  el: LabelElement,
  scale: number,
): React.CSSProperties {
  const boxWidthMm = el.max_width || el.width;
  const padTop = (el.padding_top ?? 0) * scale;
  const padRight = (el.padding_right ?? 0) * scale;
  const padBottom = (el.padding_bottom ?? 0) * scale;
  const padLeft = (el.padding_left ?? 0) * scale;
  const wrap = valueForceWrap(el);

  return partCanvasStyle(
    effectiveValueStyle(el),
    scale,
    boxWidthMm,
    padTop,
    padRight,
    padBottom,
    padLeft,
    el.text_align ?? "left",
    wrap,
  );
}

function renderLabelValueCanvas(
  el: LabelElement,
  scale: number,
  labelText: string | null,
  valueText: string,
): ReactNode {
  const boxWidthMm = el.max_width || el.width;
  const padTop = (el.padding_top ?? 0) * scale;
  const padRight = (el.padding_right ?? 0) * scale;
  const padBottom = (el.padding_bottom ?? 0) * scale;
  const padLeft = (el.padding_left ?? 0) * scale;
  const textAlign = el.text_align ?? "left";
  const wrap = valueForceWrap(el);
  const labelStyle = effectiveLabelStyle(el);
  const valueStyle = effectiveValueStyle(el);

  if (!labelText) {
    return (
      <div style={partCanvasStyle(valueStyle, scale, boxWidthMm, padTop, padRight, padBottom, padLeft, textAlign, wrap)}>
        {valueText}
      </div>
    );
  }

  if (isLabelOnSeparateLine(el)) {
    return (
      <div
        style={{
          width: boxWidthMm ? boxWidthMm * scale : undefined,
          maxWidth: boxWidthMm ? boxWidthMm * scale : undefined,
          boxSizing: "border-box",
          padding: `${padTop}px ${padRight}px ${padBottom}px ${padLeft}px`,
          textAlign,
        }}
      >
        <div
          style={{
            fontSize: ptToCanvasPx(labelStyle.font_size ?? DEFAULT_FONT_SIZE, scale),
            fontWeight: labelStyle.bold ? "bold" : "normal",
            fontStyle: labelStyle.italic ? "italic" : "normal",
            textDecoration: labelStyle.underline ? "underline" : "none",
            lineHeight: `${ptToCanvasPx((labelStyle.line_height ?? (labelStyle.font_size ?? DEFAULT_FONT_SIZE) * 1.2), scale)}px`,
            color: "#1e293b",
          }}
        >
          {labelText}
        </div>
        <div
          style={{
            fontSize: ptToCanvasPx(valueStyle.font_size ?? DEFAULT_FONT_SIZE, scale),
            fontWeight: valueStyle.bold ? "bold" : "normal",
            fontStyle: valueStyle.italic ? "italic" : "normal",
            textDecoration: valueStyle.underline ? "underline" : "none",
            whiteSpace: wrap ? "normal" : "nowrap",
            overflow: wrap ? "visible" : "hidden",
            overflowWrap: wrap ? "break-word" : undefined,
            wordBreak: wrap ? "break-word" : undefined,
            lineHeight: `${ptToCanvasPx((valueStyle.line_height ?? (valueStyle.font_size ?? DEFAULT_FONT_SIZE) * 1.2), scale)}px`,
            color: "#1e293b",
          }}
        >
          {valueText}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: boxWidthMm ? boxWidthMm * scale : undefined,
        maxWidth: boxWidthMm ? boxWidthMm * scale : undefined,
        boxSizing: "border-box",
        padding: `${padTop}px ${padRight}px ${padBottom}px ${padLeft}px`,
        textAlign,
        whiteSpace: wrap ? "normal" : "nowrap",
        overflow: wrap ? "visible" : "hidden",
        overflowWrap: wrap ? "break-word" : undefined,
        wordBreak: wrap ? "break-word" : undefined,
        color: "#1e293b",
        lineHeight: `${ptToCanvasPx((valueStyle.line_height ?? (valueStyle.font_size ?? DEFAULT_FONT_SIZE) * 1.2), scale)}px`,
      }}
    >
      <span
        style={{
          fontSize: ptToCanvasPx(labelStyle.font_size ?? DEFAULT_FONT_SIZE, scale),
          fontWeight: labelStyle.bold ? "bold" : "normal",
          fontStyle: labelStyle.italic ? "italic" : "normal",
          textDecoration: labelStyle.underline ? "underline" : "none",
        }}
      >
        {labelText}{" "}
      </span>
      <span
        style={{
          fontSize: ptToCanvasPx(valueStyle.font_size ?? DEFAULT_FONT_SIZE, scale),
          fontWeight: valueStyle.bold ? "bold" : "normal",
          fontStyle: valueStyle.italic ? "italic" : "normal",
          textDecoration: valueStyle.underline ? "underline" : "none",
        }}
      >
        {valueText}
      </span>
    </div>
  );
}

function TextPlacementProperties({
  element,
  onUpdate,
}: {
  element: LabelElement;
  onUpdate: (changes: Partial<LabelElement>) => void;
}) {
  const align = element.text_align ?? "left";

  return (
    <>
      <div>
        <label className="text-xs text-slate-500">Выравнивание</label>
        <div className="mt-1 flex gap-1">
          {(
            [
              ["left", "Лево"],
              ["center", "Центр"],
              ["right", "Право"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() =>
                onUpdate({ text_align: value === "left" ? undefined : value })
              }
              className={`flex-1 rounded border px-2 py-1 text-xs ${
                align === value
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs text-slate-500">Отступы (мм)</label>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-slate-400">Сверху</label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={element.padding_top ?? 0}
              onChange={(e) =>
                onUpdate({
                  padding_top: Number(e.target.value) || undefined,
                })
              }
              className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Справа</label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={element.padding_right ?? 0}
              onChange={(e) =>
                onUpdate({
                  padding_right: Number(e.target.value) || undefined,
                })
              }
              className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Снизу</label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={element.padding_bottom ?? 0}
              onChange={(e) =>
                onUpdate({
                  padding_bottom: Number(e.target.value) || undefined,
                })
              }
              className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Слева</label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={element.padding_left ?? 0}
              onChange={(e) =>
                onUpdate({
                  padding_left: Number(e.target.value) || undefined,
                })
              }
              className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
        </div>
      </div>
    </>
  );
}

function TextPartStyleControls({
  style,
  onStyleChange,
}: {
  style: TextPartStyle;
  onStyleChange: (changes: Partial<TextPartStyle>) => void;
}) {
  const fontSize = style.font_size ?? DEFAULT_FONT_SIZE;

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-slate-500">Размер текста (пт)</label>
          <input
            type="number"
            min={1}
            step={0.5}
            value={fontSize}
            onChange={(e) =>
              onStyleChange({ font_size: Number(e.target.value) || undefined })
            }
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">
            Межстрочный интервал (пт, 0 = авто)
          </label>
          <input
            type="number"
            min={0}
            step={0.5}
            value={style.line_height ?? 0}
            onChange={(e) => {
              const v = Number(e.target.value);
              onStyleChange({ line_height: v > 0 ? v : undefined });
            }}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            placeholder={`${(fontSize * 1.2).toFixed(1)}`}
          />
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs text-slate-500">Стиль</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {(
            [
              ["bold", "B", "Жирный"],
              ["italic", "I", "Курсив"],
              ["underline", "U", "Подчёркнутый"],
            ] as const
          ).map(([key, letter, title]) => (
            <button
              key={key}
              type="button"
              title={title}
              onClick={() =>
                onStyleChange({ [key]: !style[key] } as Partial<TextPartStyle>)
              }
              className={`min-w-[2rem] rounded border px-2 py-1 text-xs font-semibold ${
                style[key]
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {letter}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function updateLabelPart(
  element: LabelElement,
  changes: Partial<LabelPartConfig>,
): Partial<LabelElement> {
  return { label: { ...element.label, ...changes } };
}

function updateValuePart(
  element: LabelElement,
  changes: Partial<ValuePartConfig>,
): Partial<LabelElement> {
  if (usesLabelValueModel(element)) {
    return { value: { ...element.value, ...changes } };
  }
  const rootMap: Partial<LabelElement> = {};
  if ("font_size" in changes) rootMap.font_size = changes.font_size;
  if ("bold" in changes) rootMap.bold = changes.bold;
  if ("italic" in changes) rootMap.italic = changes.italic;
  if ("underline" in changes) rootMap.underline = changes.underline;
  if ("line_height" in changes) rootMap.line_height = changes.line_height;
  if ("force_wrap" in changes) rootMap.wrap = changes.force_wrap || undefined;
  return rootMap;
}

function LabelSectionProperties({
  element,
  onUpdate,
  idPrefix,
  defaultLabelText = "",
}: {
  element: LabelElement;
  onUpdate: (changes: Partial<LabelElement>) => void;
  idPrefix: string;
  defaultLabelText?: string;
}) {
  const label = element.label ?? {};
  const show = label.show === true;
  const separateLine = label.inline === true;
  const labelStyle = effectiveLabelStyle(element);

  return (
    <div className="space-y-3 rounded border border-slate-200 bg-slate-50/50 p-3">
      <p className="text-xs font-medium text-slate-600">Название поля</p>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`${idPrefix}-label-show`}
          checked={show}
          onChange={(e) => {
            const nextShow = e.target.checked;
            if (nextShow && !element.label) {
              onUpdate({
                label: {
                  show: true,
                  text: defaultLabelText,
                  inline: false,
                },
              });
            } else {
              onUpdate(updateLabelPart(element, { show: nextShow }));
            }
          }}
        />
        <label htmlFor={`${idPrefix}-label-show`} className="text-xs text-slate-600">
          Показывать на этикетке
        </label>
      </div>
      {show && (
        <>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id={`${idPrefix}-label-inline`}
              checked={separateLine}
              onChange={(e) =>
                onUpdate(updateLabelPart(element, { inline: e.target.checked }))
              }
            />
            <label htmlFor={`${idPrefix}-label-inline`} className="text-xs text-slate-600">
              Отдельной строкой
            </label>
          </div>
          <div>
            <label className="text-xs text-slate-500">Текст подписи</label>
            <input
              value={label.text ?? defaultLabelText}
              onChange={(e) =>
                onUpdate(updateLabelPart(element, { text: e.target.value }))
              }
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
          <TextPartStyleControls
            style={labelStyle}
            onStyleChange={(changes) =>
              onUpdate(updateLabelPart(element, changes))
            }
          />
        </>
      )}
    </div>
  );
}

function ValueSectionProperties({
  element,
  onUpdate,
  idPrefix,
}: {
  element: LabelElement;
  onUpdate: (changes: Partial<LabelElement>) => void;
  idPrefix: string;
}) {
  const valueStyle = effectiveValueStyle(element);
  const forceWrap = valueForceWrap(element);

  return (
    <div className="space-y-3 rounded border border-slate-200 bg-slate-50/50 p-3">
      <p className="text-xs font-medium text-slate-600">Значение поля</p>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`${idPrefix}-value-wrap`}
          checked={forceWrap}
          onChange={(e) =>
            onUpdate(updateValuePart(element, { force_wrap: e.target.checked }))
          }
        />
        <label htmlFor={`${idPrefix}-value-wrap`} className="text-xs text-slate-600">
          Принудительный перенос строки
        </label>
      </div>
      <TextPartStyleControls
        style={valueStyle}
        onStyleChange={(changes) => onUpdate(updateValuePart(element, changes))}
      />
    </div>
  );
}

function LabelValuePropertiesPanel({
  element,
  onUpdate,
  idPrefix,
  defaultLabelText = "",
  headerExtra,
}: {
  element: LabelElement;
  onUpdate: (changes: Partial<LabelElement>) => void;
  idPrefix: string;
  defaultLabelText?: string;
  headerExtra?: ReactNode;
}) {
  return (
    <>
      {headerExtra}
      <div>
        <p className="mb-2 text-xs font-medium text-slate-600">Размещение</p>
        <div className="space-y-3">
          <TextPlacementProperties element={element} onUpdate={onUpdate} />
        </div>
      </div>
      <LabelSectionProperties
        element={element}
        onUpdate={onUpdate}
        idPrefix={idPrefix}
        defaultLabelText={defaultLabelText}
      />
      <ValueSectionProperties
        element={element}
        onUpdate={onUpdate}
        idPrefix={idPrefix}
      />
      <div>
        <label className="text-xs text-slate-500">Макс. ширина (мм, 0 = нет)</label>
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
}

const MARGIN_MM = 2;
const MIN_DATAMATRIX_MM = 4;
const DEFAULT_DATAMATRIX_MM = 30;
const DEFAULT_BARCODE_WIDTH_MM = 38;
const DEFAULT_BARCODE_HEIGHT_MM = 15;
const DEFAULT_LINE_LENGTH_MM = 30;
const DEFAULT_SIGN_WIDTH_MM = 10;
const DEFAULT_SIGN_HEIGHT_MM = 10;
const DEFAULT_IMAGE_WIDTH_MM = 15;
const DEFAULT_IMAGE_HEIGHT_MM = 15;
const MIN_IMAGE_MM = 3;
const MIN_SIGN_MM = 3;

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

function cappedSignSize(
  labelWidthMm: number,
  labelHeightMm: number,
  x: number,
  y: number,
): { width: number; height: number } {
  const maxWidth = labelWidthMm - x - MARGIN_MM;
  const maxHeight = labelHeightMm - y - MARGIN_MM;
  return {
    width: Math.max(MIN_SIGN_MM, Math.min(DEFAULT_SIGN_WIDTH_MM, maxWidth)),
    height: Math.max(MIN_SIGN_MM, Math.min(DEFAULT_SIGN_HEIGHT_MM, maxHeight)),
  };
}

function cappedImageSize(
  labelWidthMm: number,
  labelHeightMm: number,
  x: number,
  y: number,
): { width: number; height: number } {
  const maxWidth = labelWidthMm - x - MARGIN_MM;
  const maxHeight = labelHeightMm - y - MARGIN_MM;
  return {
    width: Math.max(MIN_IMAGE_MM, Math.min(DEFAULT_IMAGE_WIDTH_MM, maxWidth)),
    height: Math.max(MIN_IMAGE_MM, Math.min(DEFAULT_IMAGE_HEIGHT_MM, maxHeight)),
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

function cappedVerticalLineEnd(
  x: number,
  y: number,
  labelHeightMm: number,
): { x2: number; y2: number } {
  return {
    x2: x,
    y2: Math.min(y + DEFAULT_LINE_LENGTH_MM, labelHeightMm - MARGIN_MM),
  };
}

export type CreateElementOverrides = Partial<LabelElement> & {
  linePreset?: "horizontal" | "vertical";
};

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
    case "sign": {
      const width = merged.width ?? DEFAULT_SIGN_WIDTH_MM;
      const height = merged.height ?? DEFAULT_SIGN_HEIGHT_MM;
      return (
        merged.x + width > labelWidthMm || merged.y + height > labelHeightMm
      );
    }
    case "image": {
      const width = merged.width ?? DEFAULT_IMAGE_WIDTH_MM;
      const height = merged.height ?? DEFAULT_IMAGE_HEIGHT_MM;
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
    defaultGeometry: {
      text: "Текст",
      font_size: 6,
      bold: false,
      italic: false,
      underline: false,
    },
    renderCanvas: (el, scale, previewText) => {
      const valueText = previewText(el.text || "");
      if (shouldShowLabel(el)) {
        return renderLabelValueCanvas(el, scale, el.label?.text ?? "", valueText);
      }
      return <div style={textCanvasStyle(el, scale)}>{valueText}</div>;
    },
    renderProperties: ({ element, onUpdate, fieldVariables }) => (
      <LabelValuePropertiesPanel
        element={element}
        onUpdate={onUpdate}
        idPrefix="text"
        headerExtra={
          <>
            <div>
              <label className="text-xs text-slate-500">Текст / переменная</label>
              <input
                value={element.text || ""}
                onChange={(e) => onUpdate({ text: e.target.value })}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                placeholder="{name}"
              />
            </div>
            <div>
              <p className="mb-1 text-xs text-slate-400">Переменные:</p>
              <div className="flex flex-wrap gap-1">
                {fieldVariables.map((v) => (
                  <button
                    key={v.var}
                    type="button"
                    onClick={() =>
                      onUpdate({ text: (element.text || "") + v.var })
                    }
                    className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-200"
                    title={v.label}
                  >
                    {v.var}
                  </button>
                ))}
              </div>
            </div>
          </>
        }
      />
    ),
  },
  field: {
    label: "Поле",
    toolbarIcon: "F",
    defaultGeometry: {
      field_key: "name",
      font_size: 6,
      bold: false,
      italic: false,
      underline: false,
    },
    renderCanvas: (el, scale, _previewText, catalog) => {
      const field = catalog?.find((f) => f.key === el.field_key);
      const valueText =
        el.field_key === "label_number"
          ? "1"
          : (field?.example ?? `{${el.field_key ?? "?"}}`);
      if (shouldShowLabel(el)) {
        const labelText = el.label?.text ?? `${field?.label ?? el.field_key ?? "?"}:`;
        return renderLabelValueCanvas(el, scale, labelText, valueText);
      }
      return <div style={textCanvasStyle(el, scale)}>{valueText}</div>;
    },
    renderProperties: ({ element, onUpdate, fieldVariables }) => {
      const fieldLabel =
        fieldVariables.find((v) => v.var === `{${element.field_key}}`)?.label ??
        element.field_key ??
        "—";
      return (
        <LabelValuePropertiesPanel
          element={element}
          onUpdate={onUpdate}
          idPrefix="field"
          defaultLabelText={`${fieldLabel}:`}
          headerExtra={
            <div>
              <label className="text-xs text-slate-500">Поле</label>
              <p className="mt-1 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700">
                {fieldLabel}
              </p>
            </div>
          }
        />
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
  sign: {
    label: "Знак",
    toolbarIcon: "◎",
    defaultGeometry: { width: DEFAULT_SIGN_WIDTH_MM, height: DEFAULT_SIGN_HEIGHT_MM, sign_key: "eac" },
    renderCanvas: (el, scale) => {
      const sign = resolveSignByKey(el.sign_key ?? "");
      if (!sign) {
        console.warn("Неизвестный sign_key, пропуск:", el.sign_key);
        return null;
      }
      return (
        <img
          src={signSvgUrl(sign.asset)}
          alt={sign.label}
          draggable={false}
          style={{
            width: (el.width || DEFAULT_SIGN_WIDTH_MM) * scale,
            height: (el.height || DEFAULT_SIGN_HEIGHT_MM) * scale,
            objectFit: "contain",
            display: "block",
          }}
        />
      );
    },
    renderProperties: ({ element, onUpdate }) => (
      <>
        <div>
          <label className="text-xs text-slate-500">Ширина (мм)</label>
          <input
            type="number"
            value={element.width || DEFAULT_SIGN_WIDTH_MM}
            onChange={(e) => onUpdate({ width: Number(e.target.value) })}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">Высота (мм)</label>
          <input
            type="number"
            value={element.height || DEFAULT_SIGN_HEIGHT_MM}
            onChange={(e) => onUpdate({ height: Number(e.target.value) })}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">Знак</label>
          <p className="mt-1 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700">
            {resolveSignByKey(element.sign_key ?? "")?.label ?? element.sign_key ?? "—"}
          </p>
        </div>
      </>
    ),
  },
  image: {
    label: "Изображение",
    toolbarIcon: "🖼",
    defaultGeometry: { width: DEFAULT_IMAGE_WIDTH_MM, height: DEFAULT_IMAGE_HEIGHT_MM },
    renderCanvas: (el, scale) => {
      const w = (el.width || DEFAULT_IMAGE_WIDTH_MM) * scale;
      const h = (el.height || DEFAULT_IMAGE_HEIGHT_MM) * scale;
      if (!el.image_id) {
        return (
          <div
            style={{
              width: w,
              height: h,
              background: "#f1f5f9",
              border: "1px dashed #cbd5e1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              color: "#94a3b8",
            }}
          >
            Изображение
          </div>
        );
      }
      return (
        <AuthenticatedLabelImage
          imageId={el.image_id}
          alt="Изображение"
          style={{ width: w, height: h }}
        />
      );
    },
    renderProperties: ({ element, onUpdate }) => (
      <>
        <div>
          <label className="text-xs text-slate-500">Изображение</label>
          {element.image_id ? (
            <div className="mt-1 rounded border border-slate-200 bg-slate-50 p-2">
              <AuthenticatedLabelImage
                imageId={element.image_id}
                alt="Превью"
                style={{ width: "100%", maxHeight: 120 }}
              />
            </div>
          ) : (
            <p className="mt-1 text-xs text-slate-400">Файл не загружен</p>
          )}
          <button
            type="button"
            onClick={async () => {
              const file = await pickImageFile();
              if (!file) return;
              try {
                const result = await uploadLabelImage(file);
                onUpdate({ image_id: result.id });
              } catch {
                window.alert("Не удалось загрузить изображение");
              }
            }}
            className="mt-2 w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            {element.image_id ? "Заменить изображение" : "Загрузить изображение"}
          </button>
        </div>
        <div>
          <label className="text-xs text-slate-500">Ширина (мм)</label>
          <input
            type="number"
            value={element.width || DEFAULT_IMAGE_WIDTH_MM}
            onChange={(e) => onUpdate({ width: Number(e.target.value) })}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">Высота (мм)</label>
          <input
            type="number"
            value={element.height || DEFAULT_IMAGE_HEIGHT_MM}
            onChange={(e) => onUpdate({ height: Number(e.target.value) })}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
      </>
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
  overrides?: CreateElementOverrides,
): LabelElement {
  const def = BLOCK_REGISTRY[type];
  const base: LabelElement = { id, type, x, y };
  const { linePreset, ...cleanOverrides } = overrides ?? {};

  switch (type) {
    case "datamatrix": {
      const size = cappedDatamatrixSize(labelWidthMm, labelHeightMm, x, y);
      const pos = clampPosition(x, y, size, size, labelWidthMm, labelHeightMm);
      return { ...base, ...pos, size, ...cleanOverrides };
    }
    case "barcode_ean13": {
      const { width, height } = cappedBarcodeSize(
        labelWidthMm,
        labelHeightMm,
        x,
        y,
      );
      const pos = clampPosition(x, y, width, height, labelWidthMm, labelHeightMm);
      return { ...base, ...pos, width, height, ...cleanOverrides };
    }
    case "line": {
      const pos = clampPosition(x, y, 1, 1, labelWidthMm, labelHeightMm);
      let lineEnd;
      if (linePreset === "vertical") {
        lineEnd = cappedVerticalLineEnd(pos.x, pos.y, labelHeightMm);
      } else if (linePreset === "horizontal") {
        lineEnd = cappedLineEnd(pos.x, pos.y, labelWidthMm, labelHeightMm);
      } else {
        lineEnd = cappedLineEnd(pos.x, pos.y, labelWidthMm, labelHeightMm);
      }
      return { ...base, ...pos, ...lineEnd, ...cleanOverrides };
    }
    case "sign": {
      const { width, height } = cappedSignSize(
        labelWidthMm,
        labelHeightMm,
        x,
        y,
      );
      const pos = clampPosition(x, y, width, height, labelWidthMm, labelHeightMm);
      return { ...base, ...pos, width, height, ...cleanOverrides };
    }
    case "image": {
      const { width, height } = cappedImageSize(
        labelWidthMm,
        labelHeightMm,
        x,
        y,
      );
      const pos = clampPosition(x, y, width, height, labelWidthMm, labelHeightMm);
      return { ...base, ...pos, width, height, ...cleanOverrides };
    }
    default:
      return { ...base, ...def.defaultGeometry, ...cleanOverrides };
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
  if (type === "sign" && element?.sign_key) {
    return resolveSignByKey(element.sign_key)?.label ?? "Знак";
  }
  if (type === "image") {
    return "Изображение";
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
