"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentCompany } from "@/hooks/use-current-company";
import type { ClinicHoliday } from "@/lib/types/database";

function fmt(date: string) {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

export function ClinicHolidaysManager() {
  const { companyId, loading: companyLoading } = useCurrentCompany();
  const [items, setItems] = useState<ClinicHoliday[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchAll() {
    if (!companyId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("clinic_holidays")
      .select("*")
      .eq("company_id", companyId)
      .order("date");
    if (data) setItems(data as unknown as ClinicHoliday[]);
    setLoading(false);
  }

  useEffect(() => {
    if (companyLoading) return;
    if (!companyId) {
      setItems([]);
      setLoading(false);
      return;
    }
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyLoading, companyId]);

  async function handleAdd() {
    if (!companyId || !date || !name.trim()) return;
    setError(null);
    setSaving(true);
    const supabase = createClient();
    const { error: e } = await supabase.from("clinic_holidays").insert({
      company_id: companyId,
      date,
      name: name.trim(),
    });
    setSaving(false);
    if (e) {
      setError(`Não foi possível adicionar: ${e.message}`);
      return;
    }
    setDate("");
    setName("");
    await fetchAll();
  }

  async function handleRemove(id: string) {
    setError(null);
    const supabase = createClient();
    const { error: e } = await supabase
      .from("clinic_holidays")
      .delete()
      .eq("id", id);
    if (e) {
      setError(`Não foi possível remover: ${e.message}`);
      return;
    }
    await fetchAll();
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">
          Novo feriado / folga
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Ex: Carnaval, Confraternização..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm sm:col-span-2"
          />
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={handleAdd}
            disabled={saving || !date || !name.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Adicionando..." : "Adicionar"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        {items.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">
            Nenhum feriado cadastrado.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between px-5 py-3 text-sm"
              >
                <div>
                  <span className="font-medium text-gray-900">{fmt(h.date)}</span>
                  <span className="ml-2 text-gray-600">{h.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(h.id)}
                  className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
