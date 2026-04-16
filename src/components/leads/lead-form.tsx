"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import type { Lead, LeadSource, User } from "@/lib/types/database";

interface LeadFormProps {
  domain: string;
  lead?: Lead | null;
}

export function LeadForm({ domain, lead }: LeadFormProps) {
  const router = useRouter();
  const { profile } = useAuth();
  const isEditing = !!lead;

  const [name, setName] = useState(lead?.name || "");
  const [phone, setPhone] = useState(lead?.phone || "");
  const [email, setEmail] = useState(lead?.email || "");
  const [sourceId, setSourceId] = useState(lead?.source_id || "");
  const [assignedTo, setAssignedTo] = useState(lead?.assigned_to || "");
  const [notes, setNotes] = useState(lead?.notes || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sources, setSources] = useState<LeadSource[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    async function loadOptions() {
      const supabase = createClient();

      const [sourcesRes, usersRes] = await Promise.all([
        supabase.from("lead_sources").select("*").eq("is_active", true).order("name"),
        supabase.from("users").select("*").eq("is_active", true).order("name"),
      ]);

      if (sourcesRes.data) setSources(sourcesRes.data as unknown as LeadSource[]);
      if (usersRes.data) setUsers(usersRes.data as unknown as User[]);
    }

    loadOptions();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("O nome é obrigatório.");
      return;
    }

    if (!isEditing && !profile?.company_id) {
      setError("Não foi possível identificar a empresa. Tente recarregar a página.");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const payload = {
      name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      source_id: sourceId || null,
      assigned_to: assignedTo || null,
      notes: notes.trim() || null,
    };

    if (isEditing && lead) {
      const { error: updateError } = await supabase
        .from("leads")
        .update(payload)
        .eq("id", lead.id);

      if (updateError) {
        setError(`Erro ao atualizar: ${updateError.message}`);
        setSaving(false);
        return;
      }

      router.push(`/${domain}/leads/${lead.id}`);
      router.refresh();
    } else {
      const { data: newLead, error: insertError } = await supabase
        .from("leads")
        .insert({ ...payload, company_id: profile!.company_id })
        .select("id")
        .single();

      if (insertError) {
        setError(`Erro ao criar: ${insertError.message}`);
        setSaving(false);
        return;
      }

      const newId = (newLead as { id: string } | null)?.id;
      router.push(newId ? `/${domain}/leads/${newId}` : `/${domain}/leads`);
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Input
        label="Nome *"
        placeholder="Nome do lead"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Input
          label="Telefone"
          placeholder="(00) 00000-0000"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Input
          label="E-mail"
          type="email"
          placeholder="email@exemplo.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Select
          label="Fonte"
          placeholder="Selecione a fonte"
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
          options={sources.map((s) => ({ value: s.id, label: s.name }))}
        />
        <Select
          label="Responsável"
          placeholder="Selecione o responsável"
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
          options={users.map((u) => ({ value: u.id, label: u.name }))}
        />
      </div>

      <Textarea
        label="Observações"
        placeholder="Anotações sobre o lead..."
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={4}
      />

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Salvando..." : isEditing ? "Salvar Alterações" : "Criar Lead"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
