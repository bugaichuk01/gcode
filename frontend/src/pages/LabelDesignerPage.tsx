import { useEffect, useRef, useState } from "react";
import apiClient from "../api/client";

interface LabelElement {
  id: string;
  type: "datamatrix" | "text" | "line" | "barcode_ean13";
  x: number;
  y: number;
  size?: number;
  text?: string;
  font_size?: number;
  bold?: boolean;
  max_width?: number;
  width?: number;
  height?: number;
  x2?: number;
  y2?: number;
}

interface Template {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
  layout_data: { elements: LabelElement[] };
  is_default: boolean;
  created_at: string;
}

const SCALE = 8;

const FIELD_VARIABLES = [
  { var: "{name}", label: "Название товара" },
  { var: "{article}", label: "Артикул" },
  { var: "{gtin}", label: "GTIN" },
  { var: "{size}", label: "Размер" },
  { var: "{brand}", label: "Бренд" },
  { var: "{color}", label: "Цвет" },
  { var: "{price}", label: "Цена" },
];

function generateId() {
  return Math.random().toString(36).slice(2, 8);
}

function previewText(text: string): string {
  return text
    .replace("{name}", "Название товара")
    .replace("{article}", "АРТ-001")
    .replace("{gtin}", "02900004064948")
    .replace("{size}", "M")
    .replace("{brand}", "Бренд")
    .replace("{color}", "Синий")
    .replace("{price}", "999₽");
}

export default function LabelDesignerPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);
  const [elements, setElements] = useState<LabelElement[]>([]);
  const [widthMm, setWidthMm] = useState(58);
  const [heightMm, setHeightMm] = useState(40);
  const [templateName, setTemplateName] = useState("");
  const [selectedEl, setSelectedEl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  async function loadTemplates() {
    const res = await apiClient.get<Template[]>("/labels/templates");
    setTemplates(res.data);
  }

  useEffect(() => {
    void loadTemplates();
  }, []);

  function selectTemplate(t: Template) {
    setSelected(t);
    setTemplateName(t.name);
    setWidthMm(t.width_mm);
    setHeightMm(t.height_mm);
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
    setWidthMm(58);
    setHeightMm(40);
    setElements([
      {
        id: generateId(),
        type: "datamatrix",
        x: Math.round(58 * 0.6),
        y: 2,
        size: Math.round(40 * 0.9),
      },
      {
        id: generateId(),
        type: "text",
        x: 2,
        y: 2,
        text: "{name}",
        font_size: 6,
        bold: true,
        max_width: Math.round(58 * 0.55),
      },
    ]);
    setSelectedEl(null);
    setSuccess(null);
    setError(null);
  }

  function addElement(type: LabelElement["type"]) {
    const newEl: LabelElement = {
      id: generateId(),
      type,
      x: 5,
      y: 5,
      ...(type === "datamatrix" ? { size: 30 } : {}),
      ...(type === "text" ? { text: "Текст", font_size: 6, bold: false } : {}),
      ...(type === "line" ? { x2: 30, y2: 5 } : {}),
      ...(type === "barcode_ean13" ? { width: 38, height: 15 } : {}),
    };
    setElements((prev) => [...prev, newEl]);
    setSelectedEl(newEl.id);
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
      const payload = {
        name: templateName,
        width_mm: widthMm,
        height_mm: heightMm,
        layout_data: { elements },
        is_default: false,
      };
      if (selected) {
        await apiClient.put(`/labels/templates/${selected.id}`, payload);
      } else {
        await apiClient.post("/labels/templates", payload);
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
              <span className="text-slate-500">Размер:</span>
              <input
                type="number"
                value={widthMm}
                onChange={(e) => setWidthMm(Number(e.target.value))}
                className="w-14 px-2 py-1 border border-slate-300 rounded text-sm text-center"
              />
              <span className="text-slate-400">×</span>
              <input
                type="number"
                value={heightMm}
                onChange={(e) => setHeightMm(Number(e.target.value))}
                className="w-14 px-2 py-1 border border-slate-300 rounded text-sm text-center"
              />
              <span className="text-slate-500">мм</span>
            </div>
            <div className="h-4 w-px bg-slate-200" />
            <span className="text-sm text-slate-500">Добавить:</span>
            {[
              { type: "datamatrix" as const, label: "DataMatrix", icon: "⬛" },
              { type: "barcode_ean13" as const, label: "EAN-13", icon: "▓" },
              { type: "text" as const, label: "Текст", icon: "T" },
              { type: "line" as const, label: "Линия", icon: "—" },
            ].map((item) => (
              <button
                key={item.type}
                type="button"
                onClick={() => addElement(item.type)}
                className="flex items-center gap-1 px-3 py-1 border border-slate-300 rounded text-sm hover:bg-slate-50"
              >
                <span>{item.icon}</span>
                {item.label}
              </button>
            ))}
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

              {elements.map((el) => (
                <div
                  key={el.id}
                  className={`absolute cursor-move ${
                    selectedEl === el.id
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
                  {el.type === "datamatrix" && (
                    <div
                      className="bg-slate-800 flex items-center justify-center text-white text-xs"
                      style={{
                        width: (el.size || 30) * SCALE,
                        height: (el.size || 30) * SCALE,
                      }}
                    >
                      <span className="text-xs opacity-60">DM</span>
                    </div>
                  )}
                  {el.type === "barcode_ean13" && (
                    <div
                      style={{
                        width: (el.width || 38) * SCALE,
                        height: (el.height || 15) * SCALE,
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
                  )}
                  {el.type === "text" && (
                    <div
                      style={{
                        fontSize: (el.font_size || 6) * SCALE * 0.4,
                        fontWeight: el.bold ? "bold" : "normal",
                        maxWidth: el.max_width ? el.max_width * SCALE : undefined,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        color: "#1e293b",
                        lineHeight: 1.2,
                      }}
                    >
                      {previewText(el.text || "")}
                    </div>
                  )}
                  {el.type === "line" && (
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
                        x2={(el.x2 || 20) * SCALE - el.x * SCALE}
                        y2={(el.y2 || el.y) * SCALE - el.y * SCALE}
                        stroke="#1e293b"
                        strokeWidth="1"
                      />
                    </svg>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="w-56 bg-white border-l border-slate-200 overflow-auto">
          <div className="p-4">
            {selectedElement ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-700">
                    {selectedElement.type === "datamatrix"
                      ? "DataMatrix"
                      : selectedElement.type === "barcode_ean13"
                        ? "EAN-13"
                        : selectedElement.type === "text"
                          ? "Текст"
                          : "Линия"}
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

                {selectedElement.type === "datamatrix" && (
                  <div>
                    <label className="text-xs text-slate-500">Размер (мм)</label>
                    <input
                      type="number"
                      value={selectedElement.size || 30}
                      onChange={(e) =>
                        updateElement(selectedElement.id, { size: Number(e.target.value) })
                      }
                      className="w-full px-2 py-1 border border-slate-300 rounded text-sm mt-1"
                    />
                  </div>
                )}

                {selectedElement.type === "barcode_ean13" && (
                  <>
                    <div>
                      <label className="text-xs text-slate-500">Ширина (мм)</label>
                      <input
                        type="number"
                        value={selectedElement.width || 38}
                        onChange={(e) =>
                          updateElement(selectedElement.id, { width: Number(e.target.value) })
                        }
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">Высота (мм)</label>
                      <input
                        type="number"
                        value={selectedElement.height || 15}
                        onChange={(e) =>
                          updateElement(selectedElement.id, { height: Number(e.target.value) })
                        }
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                    </div>
                    <div className="rounded bg-blue-50 px-2 py-2 text-xs text-blue-600">
                      GTIN берётся автоматически из кода маркировки
                    </div>
                  </>
                )}

                {selectedElement.type === "text" && (
                  <>
                    <div>
                      <label className="text-xs text-slate-500">Текст / переменная</label>
                      <input
                        value={selectedElement.text || ""}
                        onChange={(e) =>
                          updateElement(selectedElement.id, { text: e.target.value })
                        }
                        className="w-full px-2 py-1 border border-slate-300 rounded text-sm mt-1"
                        placeholder="{name}"
                      />
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Переменные:</p>
                      <div className="flex flex-wrap gap-1">
                        {FIELD_VARIABLES.map((v) => (
                          <button
                            key={v.var}
                            type="button"
                            onClick={() =>
                              updateElement(selectedElement.id, {
                                text: (selectedElement.text || "") + v.var,
                              })
                            }
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
                        value={selectedElement.font_size || 6}
                        onChange={(e) =>
                          updateElement(selectedElement.id, {
                            font_size: Number(e.target.value),
                          })
                        }
                        className="w-full px-2 py-1 border border-slate-300 rounded text-sm mt-1"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="bold"
                        checked={selectedElement.bold || false}
                        onChange={(e) =>
                          updateElement(selectedElement.id, { bold: e.target.checked })
                        }
                      />
                      <label htmlFor="bold" className="text-xs text-slate-600">
                        Жирный
                      </label>
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">Макс. ширина (мм, 0=нет)</label>
                      <input
                        type="number"
                        value={selectedElement.max_width || 0}
                        onChange={(e) =>
                          updateElement(selectedElement.id, {
                            max_width: Number(e.target.value) || undefined,
                          })
                        }
                        className="w-full px-2 py-1 border border-slate-300 rounded text-sm mt-1"
                      />
                    </div>
                  </>
                )}

                {selectedElement.type === "line" && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Конец (мм)</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-slate-400">X2</label>
                        <input
                          type="number"
                          value={selectedElement.x2 || 0}
                          onChange={(e) =>
                            updateElement(selectedElement.id, { x2: Number(e.target.value) })
                          }
                          className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400">Y2</label>
                        <input
                          type="number"
                          value={selectedElement.y2 || 0}
                          onChange={(e) =>
                            updateElement(selectedElement.id, { y2: Number(e.target.value) })
                          }
                          className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-slate-400">
                  Выберите элемент на холсте для редактирования
                </p>
                <p className="text-xs text-slate-300 mt-2">
                  Или добавьте новый элемент через тулбар
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
