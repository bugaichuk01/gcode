import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import apiClient from "../api/client";

import AddBlocksModal, { type AddBlockCreateSpec } from "../labels/AddBlocksModal";

import {

  BLOCK_REGISTRY,

  type FieldCatalogItem,

  type LabelElement,

  SCALE,

  createElement,

  fieldVariablesFromCatalog,

  getBlockLabel,

  isElementOutOfBounds,

  newTemplateElements,

  previewTextFromCatalog,

  renderCanvasElement,

} from "../labels/blockRegistry";

import {
  DEFAULT_SIZE_PRESET,
  getSizeOptionsForSelect,
  sizePresetKey,
} from "../labels/sizePresets";

import { deriveCopyName } from "../utils/labelTemplate";



interface Template {

  id: string;

  name: string;

  width_mm: number;

  height_mm: number;

  layout_data: { elements: LabelElement[] };

  is_default: boolean;

  created_at: string;

}



function generateId() {

  return Math.random().toString(36).slice(2, 8);

}



export default function LabelDesignerPage() {

  const [templates, setTemplates] = useState<Template[]>([]);

  const [selected, setSelected] = useState<Template | null>(null);

  const [elements, setElements] = useState<LabelElement[]>([]);

  const [widthMm, setWidthMm] = useState(DEFAULT_SIZE_PRESET.width_mm);

  const [heightMm, setHeightMm] = useState(DEFAULT_SIZE_PRESET.height_mm);

  const [sizeKey, setSizeKey] = useState(
    sizePresetKey(DEFAULT_SIZE_PRESET.width_mm, DEFAULT_SIZE_PRESET.height_mm),
  );

  const [templateName, setTemplateName] = useState("");

  const [selectedEl, setSelectedEl] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  const [success, setSuccess] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  const [dragging, setDragging] = useState<string | null>(null);

  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const [fieldCatalog, setFieldCatalog] = useState<FieldCatalogItem[]>([]);

  const [addBlocksOpen, setAddBlocksOpen] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);



  const fieldVariables = fieldVariablesFromCatalog(fieldCatalog);

  const sizeOptions = useMemo(
    () => getSizeOptionsForSelect({ width_mm: widthMm, height_mm: heightMm }),
    [widthMm, heightMm],
  );

  const previewText = useCallback(

    (text: string) => previewTextFromCatalog(text, fieldCatalog),

    [fieldCatalog],

  );



  async function loadTemplates() {

    const res = await apiClient.get<Template[]>("/labels/templates");

    setTemplates(res.data);

  }



  async function loadFieldCatalog() {

    const res = await apiClient.get<FieldCatalogItem[]>("/labels/field-catalog");

    setFieldCatalog(res.data);

  }



  useEffect(() => {

    void loadTemplates();

    void loadFieldCatalog();

  }, []);



  function selectTemplate(t: Template) {

    setSelected(t);

    setTemplateName(t.name);

    setWidthMm(t.width_mm);

    setHeightMm(t.height_mm);

    setSizeKey(sizePresetKey(t.width_mm, t.height_mm));

    setElements(

      (t.layout_data.elements || []).map((e) => ({

        ...e,

        id: e.id || generateId(),

      })),

    );

    setSelectedEl(null);

    setSuccess(null);

    setError(null);

  }



  function newTemplate() {

    setSelected(null);

    setTemplateName("Новый шаблон");

    setWidthMm(DEFAULT_SIZE_PRESET.width_mm);

    setHeightMm(DEFAULT_SIZE_PRESET.height_mm);

    setSizeKey(
      sizePresetKey(DEFAULT_SIZE_PRESET.width_mm, DEFAULT_SIZE_PRESET.height_mm),
    );

    setElements(
      newTemplateElements(
        DEFAULT_SIZE_PRESET.width_mm,
        DEFAULT_SIZE_PRESET.height_mm,
        generateId,
      ),
    );

    setSelectedEl(null);

    setSuccess(null);

    setError(null);

  }



  function handleSizeChange(key: string) {

    const option = sizeOptions.find((item) => item.key === key);

    if (!option) return;

    setSizeKey(key);

    setWidthMm(option.width_mm);

    setHeightMm(option.height_mm);

  }



  function addElementsFromModal(specs: AddBlockCreateSpec[]) {

    const baseX = 5;

    const baseY = 5;

    const newEls = specs.map((spec, index) =>

      createElement(

        spec.type,

        baseX + index * 3,

        baseY + index * 3,

        generateId(),

        widthMm,

        heightMm,

        spec.overrides,

      ),

    );

    setElements((prev) => [...prev, ...newEls]);

    if (newEls.length > 0) {

      setSelectedEl(newEls[newEls.length - 1].id);

    }

  }



  function updateElement(id: string, changes: Partial<LabelElement>) {

    setElements((prev) => prev.map((e) => (e.id === id ? { ...e, ...changes } : e)));

  }



  function deleteElement(id: string) {

    setElements((prev) => prev.filter((e) => e.id !== id));

    if (selectedEl === id) setSelectedEl(null);

  }



  async function handleSave() {

    if (!templateName.trim()) {

      setError("Введите название шаблона");

      return;

    }

    setSaving(true);

    setError(null);

    setSuccess(null);

    try {

      const layoutPayload = {

        width_mm: widthMm,

        height_mm: heightMm,

        layout_data: { elements },

      };



      if (selected?.is_default) {

        const name =

          templateName.trim() !== selected.name.trim()

            ? templateName.trim()

            : deriveCopyName(selected.name);

        const res = await apiClient.post<Template>("/labels/templates", {

          ...layoutPayload,

          name,

          is_default: false,

        });

        setSuccess("Шаблон сохранён как копия");

        await loadTemplates();

        selectTemplate(res.data);

        return;

      }



      if (selected) {

        await apiClient.put(`/labels/templates/${selected.id}`, {

          ...layoutPayload,

          name: templateName.trim(),

        });

      } else {

        await apiClient.post("/labels/templates", {

          ...layoutPayload,

          name: templateName.trim(),

          is_default: false,

        });

      }

      setSuccess("Шаблон сохранён");

      await loadTemplates();

    } catch (err: unknown) {

      const detail =

        err &&

        typeof err === "object" &&

        "response" in err &&

        err.response &&

        typeof err.response === "object" &&

        "data" in err.response &&

        err.response.data &&

        typeof err.response.data === "object" &&

        "detail" in err.response.data

          ? String(err.response.data.detail)

          : "Ошибка сохранения";

      setError(detail);

    } finally {

      setSaving(false);

    }

  }



  async function handleDelete(id: string) {

    if (!confirm("Удалить шаблон?")) return;

    await apiClient.delete(`/labels/templates/${id}`);

    if (selected?.id === id) newTemplate();

    await loadTemplates();

  }



  function handleMouseDown(e: React.MouseEvent, id: string) {

    e.stopPropagation();

    setSelectedEl(id);

    setDragging(id);

    const el = elements.find((x) => x.id === id);

    if (!el) return;

    setDragOffset({

      x: e.clientX - el.x * SCALE,

      y: e.clientY - el.y * SCALE,

    });

  }



  function handleMouseMove(e: React.MouseEvent) {

    if (!dragging) return;

    const newX = Math.max(0, Math.round((e.clientX - dragOffset.x) / SCALE));

    const newY = Math.max(0, Math.round((e.clientY - dragOffset.y) / SCALE));

    updateElement(dragging, { x: newX, y: newY });

  }



  function handleMouseUp() {

    setDragging(null);

  }



  const selectedElement = elements.find((e) => e.id === selectedEl);

  const selectedBlockDef = selectedElement ? BLOCK_REGISTRY[selectedElement.type] : null;



  return (

    <div className="h-full flex flex-col">

      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">

        <h1 className="font-bold text-slate-800">Конструктор этикеток</h1>

        <div className="flex items-center gap-3">

          {success && <span className="text-sm text-emerald-600">{success}</span>}

          {error && <span className="text-sm text-red-600">{error}</span>}

          <button

            type="button"

            onClick={newTemplate}

            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm hover:bg-slate-50"

          >

            + Новый

          </button>

          <button

            type="button"

            onClick={() => void handleSave()}

            disabled={saving}

            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"

          >

            {saving ? "Сохранение..." : "Сохранить"}

          </button>

        </div>

      </div>



      <div className="flex-1 flex overflow-hidden">

        <div className="w-52 bg-slate-50 border-r border-slate-200 overflow-auto">

          <div className="p-3">

            <p className="text-xs font-medium text-slate-500 uppercase mb-2">Шаблоны</p>

            {templates.map((t) => (

              <div

                key={t.id}

                onClick={() => selectTemplate(t)}

                className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer mb-1 text-sm ${

                  selected?.id === t.id

                    ? "bg-blue-600 text-white"

                    : "hover:bg-slate-200 text-slate-700"

                }`}

              >

                <div className="flex-1 min-w-0">

                  <p className="truncate font-medium">{t.name}</p>

                  <p

                    className={`text-xs ${

                      selected?.id === t.id ? "text-blue-200" : "text-slate-400"

                    }`}

                  >

                    {t.width_mm}×{t.height_mm}мм

                  </p>

                </div>

                {!t.is_default && (

                  <button

                    type="button"

                    onClick={(e) => {

                      e.stopPropagation();

                      void handleDelete(t.id);

                    }}

                    className={`ml-1 text-xs ${

                      selected?.id === t.id

                        ? "text-blue-200 hover:text-white"

                        : "text-slate-300 hover:text-red-500"

                    }`}

                  >

                    ✕

                  </button>

                )}

              </div>

            ))}

          </div>

        </div>



        <div className="flex-1 flex flex-col overflow-auto bg-slate-100">

          <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-4 flex-wrap">

            <input

              value={templateName}

              onChange={(e) => setTemplateName(e.target.value)}

              placeholder="Название шаблона"

              className="px-2 py-1 border border-slate-300 rounded text-sm w-48"

            />

            <div className="flex items-center gap-2 text-sm">

              <label className="text-slate-500" htmlFor="label-size-preset">

                Размер этикетки, мм

              </label>

              <select

                id="label-size-preset"

                value={sizeKey}

                onChange={(e) => handleSizeChange(e.target.value)}

                className="px-2 py-1 border border-slate-300 rounded text-sm"

              >

                {sizeOptions.map((option) => (

                  <option key={option.key} value={option.key}>

                    {option.label}

                  </option>

                ))}

              </select>

            </div>

            <div className="h-4 w-px bg-slate-200" />

            <button

              type="button"

              onClick={() => setAddBlocksOpen(true)}

              className="flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"

            >

              + Добавить блоки на этикетку

            </button>

          </div>



          <div className="flex-1 flex items-center justify-center p-8">

            <div

              ref={canvasRef}

              className="relative bg-white shadow-lg select-none"

              style={{

                width: widthMm * SCALE,

                height: heightMm * SCALE,

                border: "2px solid #e2e8f0",

              }}

              onMouseMove={handleMouseMove}

              onMouseUp={handleMouseUp}

              onMouseLeave={handleMouseUp}

              onClick={() => setSelectedEl(null)}

            >

              <svg

                className="absolute inset-0 pointer-events-none"

                width={widthMm * SCALE}

                height={heightMm * SCALE}

              >

                <defs>

                  <pattern

                    id="grid"

                    width={SCALE * 5}

                    height={SCALE * 5}

                    patternUnits="userSpaceOnUse"

                  >

                    <path

                      d={`M ${SCALE * 5} 0 L 0 0 0 ${SCALE * 5}`}

                      fill="none"

                      stroke="#f1f5f9"

                      strokeWidth="0.5"

                    />

                  </pattern>

                </defs>

                <rect width="100%" height="100%" fill="url(#grid)" />

              </svg>



              {elements.map((el) => {

                const outOfBounds = isElementOutOfBounds(el, widthMm, heightMm);

                return (

                <div

                  key={el.id}

                  className={`absolute cursor-move ${

                    outOfBounds

                      ? "ring-2 ring-red-500 ring-offset-0"

                      : selectedEl === el.id

                      ? "ring-2 ring-blue-500 ring-offset-0"

                      : "hover:ring-1 hover:ring-blue-300"

                  }`}

                  style={{ left: el.x * SCALE, top: el.y * SCALE }}

                  onMouseDown={(e) => handleMouseDown(e, el.id)}

                  onClick={(e) => {

                    e.stopPropagation();

                    setSelectedEl(el.id);

                  }}

                >

                  {renderCanvasElement(el, SCALE, previewText, fieldCatalog)}

                </div>

                );

              })}

            </div>

          </div>

        </div>



        <div className="w-56 bg-white border-l border-slate-200 overflow-auto">

          <div className="p-4">

            {selectedElement && selectedBlockDef ? (

              <div className="space-y-3">

                <div className="flex items-center justify-between">

                  <p className="text-sm font-semibold text-slate-700">

                    {getBlockLabel(selectedElement.type, selectedElement, fieldCatalog)}

                  </p>

                  <button

                    type="button"

                    onClick={() => deleteElement(selectedElement.id)}

                    className="text-xs text-red-400 hover:text-red-600"

                  >

                    Удалить

                  </button>

                </div>



                <div>

                  <p className="text-xs text-slate-500 mb-1">Позиция (мм)</p>

                  <div className="grid grid-cols-2 gap-2">

                    <div>

                      <label className="text-xs text-slate-400">X</label>

                      <input

                        type="number"

                        value={selectedElement.x}

                        onChange={(e) =>

                          updateElement(selectedElement.id, { x: Number(e.target.value) })

                        }

                        className="w-full px-2 py-1 border border-slate-300 rounded text-sm"

                      />

                    </div>

                    <div>

                      <label className="text-xs text-slate-400">Y</label>

                      <input

                        type="number"

                        value={selectedElement.y}

                        onChange={(e) =>

                          updateElement(selectedElement.id, { y: Number(e.target.value) })

                        }

                        className="w-full px-2 py-1 border border-slate-300 rounded text-sm"

                      />

                    </div>

                  </div>

                </div>



                {selectedBlockDef.renderProperties({

                  element: selectedElement,

                  onUpdate: (changes) => updateElement(selectedElement.id, changes),

                  fieldVariables,

                })}

              </div>

            ) : (

              <div className="text-center py-8">

                <p className="text-sm text-slate-400">

                  Выберите элемент на холсте для редактирования

                </p>

                <p className="text-xs text-slate-300 mt-2">

                  Или добавьте новый элемент через «Добавить блоки на этикетку»

                </p>

              </div>

            )}

          </div>

        </div>

      </div>

      <AddBlocksModal

        open={addBlocksOpen}

        onClose={() => setAddBlocksOpen(false)}

        fieldCatalog={fieldCatalog}

        onAdd={addElementsFromModal}

      />

    </div>

  );

}


