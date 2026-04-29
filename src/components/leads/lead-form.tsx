"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ManagedSelect } from "@/components/ui/managed-select";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentCompany } from "@/hooks/use-current-company";
import { useAuth } from "@/hooks/use-auth";
import {
  CustomFieldRenderer,
  isCustomFieldEmpty,
} from "@/components/leads/lead-custom-fields";
import { AddCustomFieldForm } from "@/components/settings/add-custom-field-form";
import type {
  CustomField,
  CustomFieldValue,
  Lead,
  LeadSource,
  Specialty,
  User,
} from "@/lib/types/database";

interface LeadFormProps {
  domain: string;
  lead?: Lead | null;
  submitMode?: "navigate" | "stay";
  onSaved?: (lead: Lead) => void;
  onCancelAction?: () => void;
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

export function LeadForm({
  domain,
  lead,
  submitMode = "navigate",
  onSaved,
  onCancelAction,
}: LeadFormProps) {
  const router = useRouter();
  const { companyId } = useCurrentCompany();
  const { profile } = useAuth();
  const isEditing = !!lead;
  const canManageFields =
    profile?.role === "admin" || profile?.role === "super_admin";
  const [showAddFieldForm, setShowAddFieldForm] = useState(false);

  const [name, setName] = useState(lead?.name || "");
  const [phone, setPhone] = useState(lead?.phone || "");
  const [email, setEmail] = useState(lead?.email || "");
  const [sourceId, setSourceId] = useState(lead?.source_id || "");
  const [assignedTo, setAssignedTo] = useState(lead?.assigned_to || "");
  const [specialtyId, setSpecialtyId] = useState(lead?.specialty_id || "");
  const [notes, setNotes] = useState(lead?.notes || "");

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

  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [existingCustomValues, setExistingCustomValues] = useState<
    CustomFieldValue[]
  >([]);
  const [missingCustomFields, setMissingCustomFields] = useState<string[]>([]);

  useEffect(() => {
    if (!companyId) return;
    const leadId = lead?.id ?? null;

    async function loadOptions() {
      const supabase = createClient();

      const [
        sourcesRes,
        usersRes,
        specialtiesRes,
        customFieldsRes,
        customValuesRes,
      ] = await Promise.all([
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
          .neq("role", "super_admin")
          .order("name"),
        supabase
          .from("specialties")
          .select("*")
          .eq("company_id", companyId!)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("custom_fields")
          .select("*")
          .eq("company_id", companyId!)
          .eq("is_active", true)
          .order("display_order"),
        leadId
          ? supabase
              .from("custom_field_values")
              .select("*")
              .eq("company_id", companyId!)
              .eq("lead_id", leadId)
          : Promise.resolve({ data: [] as CustomFieldValue[] }),
      ]);

      if (sourcesRes.data)
        setSources(sourcesRes.data as unknown as LeadSource[]);
      if (usersRes.data) setUsers(usersRes.data as unknown as User[]);
      if (specialtiesRes.data)
        setSpecialties(specialtiesRes.data as unknown as Specialty[]);

      const fieldsList =
        (customFieldsRes.data as unknown as CustomField[]) || [];
      const valuesList =
        (customValuesRes.data as unknown as CustomFieldValue[]) || [];

      setCustomFields(fieldsList);
      setExistingCustomValues(valuesList);

      const valuesMap: Record<string, string> = {};
      valuesList.forEach((v) => {
        valuesMap[v.custom_field_id] = v.value || "";
      });
      setCustomValues(valuesMap);
    }

    loadOptions();
  }, [companyId, lead?.id]);

  function handleCustomFieldChange(fieldId: string, val: string) {
    setCustomValues((prev) => ({ ...prev, [fieldId]: val }));
    if (missingCustomFields.includes(fieldId)) {
      setMissingCustomFields((prev) => prev.filter((id) => id !== fieldId));
    }
  }

  async function persistCustomFieldValues(targetLeadId: string) {
    if (customFields.length === 0 || !companyId) return;
    const supabase = createClient();

    for (const field of customFields) {
      const val = customValues[field.id] ?? "";
      const existing = existingCustomValues.find(
        (v) => v.custom_field_id === field.id
      );

      if (existing) {
        if (existing.value !== val) {
          await supabase
            .from("custom_field_values")
            .update({ value: val || null })
            .eq("id", existing.id);
        }
      } else if (val) {
        await supabase.from("custom_field_values").insert({
          lead_id: targetLeadId,
          custom_field_id: field.id,
          company_id: companyId,
          value: val,
        });
      }
    }

    const { data: refreshed } = await supabase
      .from("custom_field_values")
      .select("*")
      .eq("lead_id", targetLeadId);
    if (refreshed) {
      setExistingCustomValues(refreshed as unknown as CustomFieldValue[]);
    }
  }

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

    const missing = customFields
      .filter((f) => f.is_required && isCustomFieldEmpty(f, customValues[f.id]))
      .map((f) => f.id);
    if (missing.length > 0) {
      setMissingCustomFields(missing);
      const labels = customFields
        .filter((f) => missing.includes(f.id))
        .map((f) => f.name)
        .join(", ");
      setError(`Preencha os campos obrigatórios: ${labels}.`);
      return;
    }
    setMissingCustomFields([]);

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
      birthdate: birthdate || null,
      gender: gender || null,
      guardian_name: guardianName.trim() || null,
      guardian_phone: guardianPhone.trim() || null,
      allergies: allergies.trim() || null,
      clinical_notes: clinicalNotes.trim() || null,
    };

    if (isEditing && lead) {
      const { data: updated, error: updateError } = await supabase
        .from("leads")
        .update(payload)
        .eq("id", lead.id)
        .select("*")
        .single();

      if (updateError) {
        setError(`Erro ao atualizar: ${updateError.message}`);
        setSaving(false);
        return;
      }

      await persistCustomFieldValues(lead.id);

      if (submitMode === "stay") {
        setSaving(false);
        onSaved?.((updated as unknown as Lead) ?? { ...lead, ...payload });
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
      if (newId) {
        await persistCustomFieldValues(newId);
      }
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
          <ManagedSelect<LeadSource>
            label="Fonte"
            placeholder="Selecione a fonte"
            value={sourceId}
            onChange={setSourceId}
            items={sources}
            createLabel="Criar nova fonte"
            emptyLabel="Nenhuma fonte cadastrada"
            onCreate={async ({ name }) => {
              if (!companyId) throw new Error("Empresa não identificada.");
              const supabase = createClient();
              const { data, error: insertError } = await supabase
                .from("lead_sources")
                .insert({ name, company_id: companyId })
                .select("*")
                .single();
              if (insertError || !data) {
                throw new Error(insertError?.message || "Erro ao criar fonte.");
              }
              const created = data as unknown as LeadSource;
              setSources((prev) =>
                [...prev, created].sort((a, b) =>
                  a.name.localeCompare(b.name)
                )
              );
              return created;
            }}
            onUpdate={async (id, { name }) => {
              const supabase = createClient();
              const { data, error: updateError } = await supabase
                .from("lead_sources")
                .update({ name })
                .eq("id", id)
                .select("*")
                .single();
              if (updateError || !data) {
                throw new Error(
                  updateError?.message || "Erro ao atualizar fonte."
                );
              }
              const updated = data as unknown as LeadSource;
              setSources((prev) =>
                prev
                  .map((s) => (s.id === id ? updated : s))
                  .sort((a, b) => a.name.localeCompare(b.name))
              );
              return updated;
            }}
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
          <ManagedSelect<Specialty>
            label="Especialidade"
            placeholder="Selecione"
            value={specialtyId}
            onChange={setSpecialtyId}
            items={specialties}
            withColor
            createLabel="Criar nova especialidade"
            emptyLabel="Nenhuma especialidade cadastrada"
            onCreate={async ({ name, color }) => {
              if (!companyId) throw new Error("Empresa não identificada.");
              const supabase = createClient();
              const { data, error: insertError } = await supabase
                .from("specialties")
                .insert({
                  name,
                  color: color || "#3b82f6",
                  company_id: companyId,
                })
                .select("*")
                .single();
              if (insertError || !data) {
                throw new Error(
                  insertError?.message || "Erro ao criar especialidade."
                );
              }
              const created = data as unknown as Specialty;
              setSpecialties((prev) =>
                [...prev, created].sort((a, b) =>
                  a.name.localeCompare(b.name)
                )
              );
              return created;
            }}
            onUpdate={async (id, { name, color }) => {
              const supabase = createClient();
              const { data, error: updateError } = await supabase
                .from("specialties")
                .update({ name, ...(color ? { color } : {}) })
                .eq("id", id)
                .select("*")
                .single();
              if (updateError || !data) {
                throw new Error(
                  updateError?.message || "Erro ao atualizar especialidade."
                );
              }
              const updated = data as unknown as Specialty;
              setSpecialties((prev) =>
                prev
                  .map((s) => (s.id === id ? updated : s))
                  .sort((a, b) => a.name.localeCompare(b.name))
              );
              return updated;
            }}
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

      {(customFields.length > 0 || canManageFields) && (
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-start justify-between px-5 py-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                Campos adicionais
              </h3>
              <p className="mt-0.5 text-xs text-blue-600">
                Campos extras criados pela clínica
              </p>
            </div>
            {canManageFields && !showAddFieldForm && (
              <button
                type="button"
                onClick={() => setShowAddFieldForm(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4.5v15m7.5-7.5h-15"
                  />
                </svg>
                Novo campo
              </button>
            )}
          </div>

          <div className="border-t border-gray-100 px-5 py-4 space-y-4">
            {showAddFieldForm && companyId && (
              <AddCustomFieldForm
                companyId={companyId}
                currentFieldCount={customFields.length}
                onCreated={async () => {
                  setShowAddFieldForm(false);
                  const supabase = createClient();
                  const { data } = await supabase
                    .from("custom_fields")
                    .select("*")
                    .eq("company_id", companyId)
                    .eq("is_active", true)
                    .order("display_order");
                  if (data) setCustomFields(data as unknown as CustomField[]);
                }}
                onCancel={() => setShowAddFieldForm(false)}
              />
            )}

            {missingCustomFields.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                Preencha os campos obrigatórios:{" "}
                {customFields
                  .filter((f) => missingCustomFields.includes(f.id))
                  .map((f) => f.name)
                  .join(", ")}
                .
              </div>
            )}

            {customFields.length === 0 && !showAddFieldForm && (
              <p className="text-sm text-gray-400">
                Nenhum campo adicional criado ainda.{" "}
                {canManageFields && (
                  <button
                    type="button"
                    onClick={() => setShowAddFieldForm(true)}
                    className="text-blue-600 underline hover:text-blue-700"
                  >
                    Criar primeiro campo
                  </button>
                )}
              </p>
            )}

            <div className="space-y-3">
              {customFields.map((field) => (
                <CustomFieldRenderer
                  key={field.id}
                  field={field}
                  value={customValues[field.id] || ""}
                  onChange={(val) => handleCustomFieldChange(field.id, val)}
                  hasError={missingCustomFields.includes(field.id)}
                />
              ))}
            </div>
          </div>
        </section>
      )}

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
          onClick={() => (onCancelAction ? onCancelAction() : router.back())}
          className="rounded-lg border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
