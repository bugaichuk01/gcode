import { useEffect, useMemo, useState } from "react";

import Modal from "../components/ui/Modal";

import {
  ADD_BLOCKS_TAB_ORDER,
  type AddBlockSelectableItem,
  type AddBlocksTab,
  getAddBlockItemsForTab,
} from "./addBlocksConfig";
import type { BlockType, CreateElementOverrides, FieldCatalogItem } from "./blockRegistry";

export interface AddBlockCreateSpec {
  type: BlockType;
  overrides?: CreateElementOverrides;
  promptUploadOnAdd?: boolean;
}

interface AddBlocksModalProps {
  open: boolean;
  onClose: () => void;
  fieldCatalog: FieldCatalogItem[];
  onAdd: (specs: AddBlockCreateSpec[]) => void;
}

export default function AddBlocksModal({
  open,
  onClose,
  fieldCatalog,
  onAdd,
}: AddBlocksModalProps) {
  const [activeTab, setActiveTab] = useState<AddBlocksTab>("Поля этикетки");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const tabItems = useMemo(
    () => getAddBlockItemsForTab(activeTab, fieldCatalog),
    [activeTab, fieldCatalog],
  );

  const itemById = useMemo(() => {
    const map = new Map<string, AddBlockSelectableItem>();
    for (const tab of ADD_BLOCKS_TAB_ORDER) {
      for (const item of getAddBlockItemsForTab(tab, fieldCatalog)) {
        map.set(item.id, item);
      }
    }
    return map;
  }, [fieldCatalog]);

  const selectedItems = useMemo(
    () =>
      [...selectedIds]
        .map((id) => itemById.get(id))
        .filter((item): item is AddBlockSelectableItem => Boolean(item)),
    [selectedIds, itemById],
  );

  useEffect(() => {
    if (!open) {
      setSelectedIds(new Set());
      setActiveTab("Поля этикетки");
    }
  }, [open]);

  function toggleItem(item: AddBlockSelectableItem) {
    if (item.disabled || !item.createSpec) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });
  }

  function removeSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function handleAdd() {
    const specs: AddBlockCreateSpec[] = [];
    for (const item of selectedItems) {
      if (!item.createSpec) continue;
      specs.push({
        ...item.createSpec,
        promptUploadOnAdd: item.promptUploadOnAdd,
      });
    }
    if (specs.length === 0) return;
    onAdd(specs);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Добавить блоки на этикетку"
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={selectedItems.length === 0}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Добавить
            {selectedItems.length > 0 ? ` (${selectedItems.length})` : ""}
          </button>
        </>
      }
    >
      <div className="flex h-[420px] -mx-1 overflow-hidden rounded-lg border border-slate-200">
        <nav className="w-40 shrink-0 border-r border-slate-200 bg-slate-50">
          {ADD_BLOCKS_TAB_ORDER.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`block w-full px-3 py-2.5 text-left text-sm transition ${
                activeTab === tab
                  ? "bg-white font-medium text-blue-700 border-r-2 border-blue-600"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-auto p-3">
            {tabItems.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">Нет доступных блоков</p>
            ) : (
              <ul className="space-y-1">
                {tabItems.map((item) => {
                  const isSelected = selectedIds.has(item.id);
                  const isClickable = Boolean(item.createSpec) && !item.disabled;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => toggleItem(item)}
                        disabled={!isClickable}
                        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                          item.disabled
                            ? "cursor-not-allowed text-slate-400"
                            : isSelected
                              ? "bg-blue-50 text-blue-800 ring-1 ring-blue-300"
                              : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {item.previewSrc ? (
                          <img
                            src={item.previewSrc}
                            alt=""
                            className="h-8 w-8 shrink-0 rounded border border-slate-200 bg-white object-contain p-0.5"
                          />
                        ) : item.icon ? (
                          <span className="w-5 shrink-0 text-center text-xs">{item.icon}</span>
                        ) : null}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{item.label}</span>
                          {item.example ? (
                            <span className="block truncate text-xs text-slate-400">
                              {item.example}
                            </span>
                          ) : null}
                          {item.hint ? (
                            <span className="block text-xs italic text-slate-400">{item.hint}</span>
                          ) : null}
                        </span>
                        {isClickable ? (
                          <span
                            className={`h-4 w-4 shrink-0 rounded border ${
                              isSelected
                                ? "border-blue-600 bg-blue-600"
                                : "border-slate-300 bg-white"
                            }`}
                          />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <aside className="flex w-52 shrink-0 flex-col border-l border-slate-200 bg-slate-50">
          <p className="border-b border-slate-200 px-3 py-2 text-xs font-medium uppercase text-slate-500">
            Выбранные блоки
          </p>
          <div className="flex-1 overflow-auto p-2">
            {selectedItems.length === 0 ? (
              <p className="px-1 py-4 text-center text-xs text-slate-400">
                Выберите блоки слева
              </p>
            ) : (
              <ul className="space-y-1">
                {selectedItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start gap-1 rounded bg-white px-2 py-1.5 text-xs text-slate-700 shadow-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <button
                      type="button"
                      onClick={() => removeSelected(item.id)}
                      className="shrink-0 text-slate-400 hover:text-red-500"
                      aria-label="Убрать"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </Modal>
  );
}
