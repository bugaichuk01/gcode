import type { BlockType, CreateElementOverrides, FieldCatalogItem } from "./blockRegistry";
import { SIGN_REGISTRY, signSvgUrl } from "./signRegistry";

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
  "Ещё": "Ещё",
};

/** Вкладки: примитивы из STATIC_ADD_BLOCK_ENTRIES + поля из каталога. */
export const HYBRID_CATALOG_TABS = new Set<AddBlocksTab>(["Ещё"]);

export interface StaticAddBlockEntry {
  tab: AddBlocksTab;
  id: string;
  label: string;
  icon?: string;
  blockType?: BlockType;
  overrides?: CreateElementOverrides;
  disabled?: boolean;
  placeholder?: boolean;
  hint?: string;
  /** При добавлении блока сразу открыть диалог загрузки файла. */
  promptUploadOnAdd?: boolean;
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
    tab: "Ещё",
    id: "more-text",
    label: "Произвольный текст",
    blockType: "text",
    icon: "T",
  },
  {
    tab: "Ещё",
    id: "more-image",
    label: "Изображение",
    blockType: "image",
    icon: "🖼",
    promptUploadOnAdd: true,
  },
  {
    tab: "Ещё",
    id: "more-line-h",
    label: "Горизонтальная линия",
    blockType: "line",
    overrides: { linePreset: "horizontal" },
    icon: "—",
  },
  {
    tab: "Ещё",
    id: "more-line-v",
    label: "Вертикальная линия",
    blockType: "line",
    overrides: { linePreset: "vertical" },
    icon: "|",
  },
];

export interface AddBlockSelectableItem {
  id: string;
  label: string;
  example?: string;
  icon?: string;
  previewSrc?: string;
  disabled?: boolean;
  placeholder?: boolean;
  hint?: string;
  createSpec?: { type: BlockType; overrides?: CreateElementOverrides };
  promptUploadOnAdd?: boolean;
}

function signItemsForTab(): AddBlockSelectableItem[] {
  return SIGN_REGISTRY.map((sign) => ({
    id: `sign:${sign.key}`,
    label: sign.label,
    previewSrc: signSvgUrl(sign.asset),
    createSpec: {
      type: "sign" as BlockType,
      overrides: { sign_key: sign.key },
    },
  }));
}

function staticItemsForTab(tab: AddBlocksTab): AddBlockSelectableItem[] {
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
    promptUploadOnAdd: e.promptUploadOnAdd,
  }));
}

function catalogItemsForTab(
  catalog: FieldCatalogItem[],
  catalogTab: string,
): AddBlockSelectableItem[] {
  return catalog
    .filter((f) => f.tab === catalogTab)
    .map((f) => ({
      id: `field:${f.key}`,
      label: f.label,
      example: f.example,
      createSpec: {
        type: "field" as BlockType,
        overrides: {
          field_key: f.key,
          label: { show: true, text: `${f.label}:`, inline: false },
        },
      },
    }));
}

export function getAddBlockItemsForTab(
  tab: AddBlocksTab,
  catalog: FieldCatalogItem[],
): AddBlockSelectableItem[] {
  if (tab === "Знаки") {
    return signItemsForTab();
  }
  const catalogTab = CATALOG_SOURCED_TABS[tab];
  if (catalogTab && HYBRID_CATALOG_TABS.has(tab)) {
    return [...staticItemsForTab(tab), ...catalogItemsForTab(catalog, catalogTab)];
  }
  if (catalogTab) {
    return catalogItemsForTab(catalog, catalogTab);
  }
  return staticItemsForTab(tab);
}
