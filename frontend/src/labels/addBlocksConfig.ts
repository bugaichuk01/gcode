import type { BlockType, FieldCatalogItem, LabelElement } from "./blockRegistry";

export const ADD_BLOCKS_TAB_ORDER = [
  "Поля этикетки",
  "Знаки",
  "Честный знак",
  "Ещё",
] as const;

export type AddBlocksTab = (typeof ADD_BLOCKS_TAB_ORDER)[number];

/** Вкладки, список блоков которых строится из field_catalog (filter by tab). */
export const CATALOG_SOURCED_TABS: Partial<Record<AddBlocksTab, string>> = {
  "Поля этикетки": "Поля этикетки",
};

export interface StaticAddBlockEntry {
  tab: AddBlocksTab;
  id: string;
  label: string;
  icon?: string;
  blockType?: BlockType;
  overrides?: Partial<LabelElement>;
  disabled?: boolean;
  placeholder?: boolean;
  hint?: string;
}

/** Примитивы и заглушки модала — единый конфиг (поля этикетки приходят из каталога). */
export const STATIC_ADD_BLOCK_ENTRIES: StaticAddBlockEntry[] = [
  {
    tab: "Честный знак",
    id: "cz-datamatrix",
    label: "Изображение кода честного знака",
    blockType: "datamatrix",
    icon: "⬛",
  },
  {
    tab: "Честный знак",
    id: "cz-text",
    label: "Текстовый код честного знака",
    blockType: "field",
    overrides: { field_key: "cis_human" },
    icon: "T",
  },
  {
    tab: "Честный знак",
    id: "cz-icon-1",
    label: "Значок честного знака (вариант 1)",
    disabled: true,
    placeholder: true,
    hint: "скоро",
  },
  {
    tab: "Честный знак",
    id: "cz-icon-2",
    label: "Значок честного знака (вариант 2)",
    disabled: true,
    placeholder: true,
    hint: "скоро",
  },
  {
    tab: "Честный знак",
    id: "cz-icon-3",
    label: "Значок честного знака (вариант 3)",
    disabled: true,
    placeholder: true,
    hint: "скоро",
  },
  {
    tab: "Знаки",
    id: "signs-placeholder",
    label: "Знаки сертификации (РСТ, ЕАС, CE)",
    disabled: true,
    placeholder: true,
    hint: "скоро",
  },
  {
    tab: "Ещё",
    id: "more-text",
    label: "Произвольный текст",
    blockType: "text",
    icon: "T",
  },
  {
    tab: "Ещё",
    id: "more-line",
    label: "Линия",
    blockType: "line",
    icon: "—",
  },
  {
    tab: "Ещё",
    id: "more-barcode",
    label: "EAN-13",
    blockType: "barcode_ean13",
    icon: "▓",
  },
  {
    tab: "Ещё",
    id: "more-image",
    label: "Изображение",
    disabled: true,
    placeholder: true,
    hint: "скоро",
  },
  {
    tab: "Ещё",
    id: "more-label-num",
    label: "Номер этикетки",
    disabled: true,
    placeholder: true,
    hint: "скоро",
  },
  {
    tab: "Ещё",
    id: "more-line-h",
    label: "Горизонтальная линия",
    disabled: true,
    placeholder: true,
    hint: "скоро",
  },
  {
    tab: "Ещё",
    id: "more-line-v",
    label: "Вертикальная линия",
    disabled: true,
    placeholder: true,
    hint: "скоро",
  },
];

export interface AddBlockSelectableItem {
  id: string;
  label: string;
  example?: string;
  icon?: string;
  disabled?: boolean;
  placeholder?: boolean;
  hint?: string;
  createSpec?: { type: BlockType; overrides?: Partial<LabelElement> };
}

export function getAddBlockItemsForTab(
  tab: AddBlocksTab,
  catalog: FieldCatalogItem[],
): AddBlockSelectableItem[] {
  const catalogTab = CATALOG_SOURCED_TABS[tab];
  if (catalogTab) {
    return catalog
      .filter((f) => f.tab === catalogTab)
      .map((f) => ({
        id: `field:${f.key}`,
        label: f.label,
        example: f.example,
        createSpec: { type: "field" as BlockType, overrides: { field_key: f.key } },
      }));
  }

  return STATIC_ADD_BLOCK_ENTRIES.filter((e) => e.tab === tab).map((e) => ({
    id: e.id,
    label: e.label,
    icon: e.icon,
    disabled: e.disabled,
    placeholder: e.placeholder,
    hint: e.hint,
    createSpec: e.blockType
      ? { type: e.blockType, overrides: e.overrides }
      : undefined,
  }));
}
