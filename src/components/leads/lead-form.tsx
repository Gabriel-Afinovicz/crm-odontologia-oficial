"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentCompany } from "@/hooks/use-current-company";
import type { Lead, LeadSource, Specialty, User } from "@/lib/types/database";
import { PhotoUploader } from "./photo-uploader";

interface LeadFormProps {
  domain: string;
  lead?: Lead | null;
}

function Section({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3 text-left"
      >
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {description && (
            <p className="mt-0.5 text-xs text-gray-500">{description}</p>
          )}
        </div>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.24 4.38a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4">
          {children}
        </div>
      )}
    </section>
  );
}

export function LeadForm({ domain, lead }: LeadFormProps) {
  const router = useRouter();
  const { companyId } = useCurrentCompany();
  const isEditing = !!lead;

  const [name, setName] = useState(lead?.name || "");
  const [phone, setPhone] = useState(lead?.phone || "");
  const [email, setEmail] = useState(lead?.email || "");
  const [sourceId, setSourceId] = useState(lead?.source_id || "");
  const [assignedTo, setAssignedTo] = useState(lead?.assigned_to || "");
  const [specialtyId, setSpecialtyId] = useState(lead?.specialty_id || "");
  const [notes, setNotes] = useState(lead?.notes || "");

  const [photoUrl, setPhotoUrl] = useState(lead?.photo_url || null);
  const [birthdate, setBirthdate] = useState(lead?.birthdate || "");
  const [gender, setGender] = useState(lead?.gender || "");
  const [guardianName, setGuardianName] = useState(lead?.guardian_name || "");
  const [guardianPhone, setGuardianPhone] = useState(
    lead?.guardian_phone || ""
  );
  const [allergies, setAllergies] = useState(lead?.allergies || "");
  const [clinicalNotes, setClinicalNotes] = useState(lead?.clinical_notes || "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sources, setSources] = useState<LeadSource[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);

  useEffect(() => {
    if (!companyId) return;

    async function loadOptions() {
      const supabase = createClient();

      const [sourcesRes, usersRes, specialtiesRes] = await Promise.all([
        supabase
          .from("lead_sources")
          .select("*")
          .eq("company_id", companyId!)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("users")
          .select("*")
          .eq("company_id", companyId!)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("specialties")
          .select("*")
          .eq("company_id", companyId!)
          .eq("is_active", true)
          .order("name"),
      ]);

      if (sourcesRes.data)
        setSources(sourcesRes.data as unknown as LeadSource[]);
      if (usersRes.data) setUsers(usersRes.data as unknown as User[]);
      if (specialtiesRes.data)
        setSpecialties(specialtiesRes.data as unknown as Specialty[]);
    }

    loadOptions();
  }, [companyId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("O nome é obrigatório.");
      return;
    }

    if (!isEditing && !companyId) {
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
      specialty_id: specialtyId || null,
      notes: notes.trim() || null,
      photo_url: photoUrl,
      birthdate: birthdate || null,
      gender: gender || null,
      guardian_name: guardianName.trim() || null,
      guardian_phone: guardianPhone.trim() || null,
      allergies: allergies.trim() || null,
      clinical_notes: clinicalNotes.trim() || null,
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
    } else {
      const { data: newLead, error: insertError } = await supabase
        .from("leads")
        .insert({ ...payload, company_id: companyId! })
        .select("id")
        .single();

      if (insertError) {
        setError(`Erro ao criar: ${insertError.message}`);
        setSaving(false);
        return;
      }

      const newId = (newLead as { id: string } | null)?.id;
      router.push(newId ? `/${domain}/leads/${newId}` : `/${domain}/leads`);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
        <PhotoUploader
          companyId={companyId}
          leadId={lead?.id ?? null}
          value={photoUrl}
          name={name}
          onChange={setPhotoUrl}
        />

        <Input
          label="Nome *"
          placeholder="Nome do paciente"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
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

        <div className="grid gap-4 sm:grid-cols-3">
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
            options={users.map((u) => ({
              value: u.id,
              label: u.is_dentist ? `Dr(a). ${u.name}` : u.name,
            }))}
          />
          <Select
            label="Especialidade"
            placeholder="Selecione"
            value={specialtyId}
            onChange={(e) => setSpecialtyId(e.target.value)}
            options={specialties.map((s) => ({ value: s.id, label: s.name }))}
          />
        </div>
      </div>

      <Section
        title="Dados pessoais"
        description="Data de nascimento, gênero"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Data de nascimento"
            type="date"
            value={birthdate}
            onChange={(e) => setBirthdate(e.target.value)}
          />
          <Select
            label="Gênero"
            placeholder="Selecione"
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            options={[
              { value: "feminino", label: "Feminino" },
              { value: "masculino", label: "Masculino" },
              { value: "outro", label: "Outro" },
              { value: "nao_informar", label: "Prefiro não informar" },
            ]}
          />
        </div>
      </Section>

      <Section
        title="Responsável (para menores)"
        description="Caso o paciente seja menor de idade"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Nome do responsável"
            placeholder="Nome completo"
            value={guardianName}
            onChange={(e) => setGuardianName(e.target.value)}
          />
          <Input
            label="Telefone do responsável"
            placeholder="(00) 00000-0000"
            value={guardianPhone}
            onChange={(e) => setGuardianPhone(e.target.value)}
          />
        </div>
      </Section>

      <Section title="Clínico" description="Alergias e observações clínicas">
        <Textarea
          label="Alergias"
          placeholder="Ex: Látex, penicilina, anestésicos..."
          value={allergies}
          onChange={(e) => setAllergies(e.target.value)}
          rows={2}
        />
        <Textarea
          label="Observações clínicas"
          placeholder="Histórico, medicações em uso, cuidados especiais..."
          value={clinicalNotes}
          onChange={(e) => setClinicalNotes(e.target.value)}
          rows={3}
        />
      </Section>

      <Section title="Observações gerais" defaultOpen>
        <Textarea
          label=""
          placeholder="Anotações sobre o lead..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
        />
      </Section>

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
