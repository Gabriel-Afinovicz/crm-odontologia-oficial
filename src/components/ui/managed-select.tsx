"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

export interface ManagedSelectItem {
  id: string;
  name: string;
  color?: string | null;
}

interface ManagedSelectProps<T extends ManagedSelectItem> {
  label?: string;
  placeholder?: string;
  value: string;
  onChange: (id: string) => void;
  items: T[];
  withColor?: boolean;
  colorPalette?: readonly string[];
  createLabel?: string;
  emptyLabel?: string;
  disabled?: boolean;
  /**
   * Cria um novo item. Deve persistir e devolver o item criado já com `id`.
   */
  onCreate: (input: { name: string; color?: string }) => Promise<T>;
  /**
   * Atualiza um item existente. Deve persistir e devolver o item atualizado.
   */
  onUpdate: (
    id: string,
    input: { name: string; color?: string }
  ) => Promise<T>;
}

const DEFAULT_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#6366f1",
  "#ef4444",
  "#14b8a6",
] as const;

export function ManagedSelect<T extends ManagedSelectItem>({
  label,
  placeholder = "Selecione",
  value,
  onChange,
  items,
  withColor = false,
  colorPalette,
  createLabel = "Criar novo",
  emptyLabel = "Nenhum item",
  disabled = false,
  onCreate,
  onUpdate,
}: ManagedSelectProps<T>) {
  const palette = colorPalette ?? DEFAULT_COLORS;
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState<string>(palette[0] as string);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selected = useMemo(
    () => items.find((it) => it.id === value) ?? null,
    [items, value]
  );

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        closeAll();
      }
    }
    function onEsc(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") closeAll();
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEsc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (mode !== "list") {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [mode]);

  function closeAll() {
    setOpen(false);
    setMode("list");
    setEditingId(null);
    setFormError(null);
  }

  function startCreate() {
    setMode("create");
    setEditingId(null);
    setFormName("");
    setFormColor(palette[0] as string);
    setFormError(null);
  }

  function startEdit(item: T) {
    setMode("edit");
    setEditingId(item.id);
    setFormName(item.name);
    setFormColor((item.color as string) || (palette[0] as string));
    setFormError(null);
  }

  async function submitForm() {
    const name = formName.trim();
    if (!name) {
      setFormError("Informe um nome.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      if (mode === "create") {
        const created = await onCreate({
          name,
          ...(withColor ? { color: formColor } : {}),
        });
        onChange(created.id);
        closeAll();
      } else if (mode === "edit" && editingId) {
        await onUpdate(editingId, {
          name,
          ...(withColor ? { color: formColor } : {}),
        });
        setMode("list");
        setEditingId(null);
      }
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Erro ao salvar."
      );
    } finally {
      setBusy(false);
    }
  }

  function handleFormKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitForm();
    }
  }

  function selectItem(id: string) {
    onChange(id);
    closeAll();
  }

  return (
    <div className="space-y-1" ref={containerRef}>
      {label && (
        <label className="block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className={`flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-gray-50 disabled:text-gray-500 ${
            open ? "ring-2 ring-blue-500/20 border-blue-500" : ""
          }`}
        >
          <span className="flex min-w-0 items-center gap-2">
            {withColor && selected?.color && (
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: selected.color }}
              />
            )}
            <span
              className={`truncate ${
                selected ? "text-gray-900" : "text-gray-400"
              }`}
            >
              {selected?.name || placeholder}
            </span>
          </span>
          <svg
            className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${
              open ? "rotate-180" : ""
            }`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.24 4.38a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {open && (
          <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
            {mode === "list" && (
              <>
                <ul className="max-h-56 overflow-y-auto py-1">
                  {items.length === 0 && (
                    <li className="px-3 py-2 text-sm text-gray-400">
                      {emptyLabel}
                    </li>
                  )}
                  {items.map((item) => {
                    const isSelected = item.id === value;
                    return (
                      <li
                        key={item.id}
                        className={`group flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-gray-50 ${
                          isSelected ? "bg-blue-50/60" : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => selectItem(item.id)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          {withColor && (
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{
                                backgroundColor:
                                  (item.color as string) || "#cbd5e1",
                              }}
                            />
                          )}
                          <span
                            className={`truncate ${
                              isSelected
                                ? "font-medium text-blue-700"
                                : "text-gray-800"
                            }`}
                          >
                            {item.name}
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Editar ${item.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(item);
                          }}
                          className="rounded p-1 text-gray-400 opacity-0 transition group-hover:opacity-100 hover:bg-gray-100 hover:text-gray-700"
                        >
                          <svg
                            className="h-3.5 w-3.5"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            aria-hidden
                          >
                            <path d="M13.586 3.586a2 2 0 1 1 2.828 2.828l-.793.793-2.828-2.828.793-.793Z" />
                            <path d="M11.379 5.793 3 14.172V17h2.828l8.379-8.379-2.828-2.828Z" />
                          </svg>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="border-t border-gray-100">
                  <button
                    type="button"
                    onClick={startCreate}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-blue-600 hover:bg-blue-50"
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 4a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 10 4Z"
                        clipRule="evenodd"
                      />
                    </svg>
                    {createLabel}
                  </button>
                </div>
              </>
            )}

            {mode !== "list" && (
              <div className="space-y-2 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {mode === "create" ? "Criar novo" : "Editar"}
                </div>
                <input
                  ref={inputRef}
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  onKeyDown={handleFormKeyDown}
                  placeholder="Nome"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                {withColor && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {palette.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setFormColor(c)}
                        className={`h-5 w-5 rounded-full transition-transform ${
                          formColor === c
                            ? "scale-110 ring-2 ring-offset-1 ring-gray-400"
                            : ""
                        }`}
                        style={{ backgroundColor: c }}
                        aria-label={`Cor ${c}`}
                      />
                    ))}
                  </div>
                )}
                {formError && (
                  <p className="text-xs text-red-600">{formError}</p>
                )}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("list");
                      setEditingId(null);
                      setFormError(null);
                    }}
                    disabled={busy}
                    className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={submitForm}
                    disabled={busy || !formName.trim()}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
                  >
                    {busy ? "Salvando..." : "Salvar"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
