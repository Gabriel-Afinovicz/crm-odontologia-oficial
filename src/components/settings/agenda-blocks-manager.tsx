"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentCompany } from "@/hooks/use-current-company";
import type { AgendaBlock, Room, User } from "@/lib/types/database";

type DentistOption = Pick<User, "id" | "name" | "is_dentist">;

function toLocalIso(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AgendaBlocksManager() {
  const { companyId, loading: companyLoading } = useCurrentCompany();
  const [items, setItems] = useState<AgendaBlock[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [dentists, setDentists] = useState<DentistOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
  const [startsAt, setStartsAt] = useState(toLocalIso(now));
  const [endsAt, setEndsAt] = useState(toLocalIso(inOneHour));
  const [dentistId, setDentistId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [reason, setReason] = useState("");

  async function fetchAll() {
    if (!companyId) return;
    const supabase = createClient();
    const [blocksRes, roomsRes, usersRes] = await Promise.all([
      supabase
        .from("agenda_blocks")
        .select("*")
        .eq("company_id", companyId)
        .order("starts_at", { ascending: false })
        .limit(50),
      supabase
        .from("rooms")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("users")
        .select("id, name, is_dentist")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .neq("role", "super_admin")
        .order("name"),
    ]);
    setItems((blocksRes.data as unknown as AgendaBlock[]) ?? []);
    setRooms((roomsRes.data as unknown as Room[]) ?? []);
    setDentists(
      ((usersRes.data as DentistOption[] | null) ?? []).filter(
        (u) => u.is_dentist
      )
    );
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
    if (!companyId) return;
    if (!dentistId && !roomId) {
      setError("Escolha um dentista ou uma sala para o bloqueio.");
      return;
    }
    setError(null);
    setSaving(true);
    const supabase = createClient();
    const { error: e } = await supabase.from("agenda_blocks").insert({
      company_id: companyId,
      dentist_id: dentistId || null,
      room_id: roomId || null,
      starts_at: new Date(startsAt).toISOString(),
      ends_at: new Date(endsAt).toISOString(),
      reason: reason.trim() || null,
    });
    setSaving(false);
    if (e) {
      setError(`Não foi possível salvar: ${e.message}`);
      return;
    }
    setReason("");
    await fetchAll();
  }

  async function handleRemove(id: string) {
    setError(null);
    const supabase = createClient();
    const { error: e } = await supabase
      .from("agenda_blocks")
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

  const dentistById = new Map(dentists.map((d) => [d.id, d]));
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">
          Novo bloqueio
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Início
            </label>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Fim
            </label>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Dentista
            </label>
            <select
              value={dentistId}
              onChange={(e) => setDentistId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">—</option>
              {dentists.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Sala
            </label>
            <select
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">—</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Motivo
            </label>
            <input
              type="text"
              placeholder="Almoço, congresso..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={handleAdd}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Adicionar bloqueio"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        {items.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">
            Nenhum bloqueio cadastrado.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((b) => (
              <div
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900">
                    {fmt(b.starts_at)} → {fmt(b.ends_at)}
                  </span>
                  {b.dentist_id && (
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">
                      Dr(a). {dentistById.get(b.dentist_id)?.name ?? "—"}
                    </span>
                  )}
                  {b.room_id && (
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">
                      {roomById.get(b.room_id)?.name ?? "—"}
                    </span>
                  )}
                  {b.reason && (
                    <span className="text-xs text-gray-500">{b.reason}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(b.id)}
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
