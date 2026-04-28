"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentCompany } from "@/hooks/use-current-company";
import { useAuth } from "@/hooks/use-auth";
import { AddCustomFieldForm } from "@/components/settings/add-custom-field-form";
import type { CustomField, CustomFieldValue } from "@/lib/types/database";

interface LeadCustomFieldsProps {
  leadId: string;
  initialFields?: CustomField[];
  initialValues?: CustomFieldValue[];
}

export function LeadCustomFields({
  leadId,
  initialFields,
  initialValues,
}: LeadCustomFieldsProps) {
  const { companyId } = useCurrentCompany();
  const { profile } = useAuth();
  const [fields, setFields] = useState<CustomField[]>(initialFields ?? []);
  const [values, setValues] = useState<Record<string, string>>(() => {
    if (!initialValues) return {};
    const map: Record<string, string> = {};
    initialValues.forEach((v) => {
      map[v.custom_field_id] = v.value || "";
    });
    return map;
  });
  const [loading, setLoading] = useState(
    initialFields === undefined || initialValues === undefined
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [existingValues, setExistingValues] = useState<CustomFieldValue[]>(
    initialValues ?? []
  );
  const [showAddForm, setShowAddForm] = useState(false);
  const [missingFields, setMissingFields] = useState<string[]>([]);

  const canManageFields =
    profile?.role === "admin" || profile?.role === "super_admin";

  /**
   * Considera vazio quando o campo obrigatório não recebeu valor utilizável.
   * `boolean` obrigatório significa "deve estar marcado" (i.e. o usuário
   * confirmou positivamente o aceite).
   */
  function isEmptyValue(field: CustomField, raw: string | undefined): boolean {
    const value = (raw ?? "").trim();
    switch (field.field_type) {
      case "select":
        return value === "";
      case "multi_select":
        return value.split(",").filter(Boolean).length === 0;
      case "boolean":
        return value !== "true";
      default:
        return value === "";
    }
  }

  async function fetchFields() {
    if (!companyId) return;
    const supabase = createClient();

    const [fieldsRes, valuesRes] = await Promise.all([
      supabase
        .from("custom_fields")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("display_order"),
      supabase
        .from("custom_field_values")
        .select("*")
        .eq("company_id", companyId)
        .eq("lead_id", leadId),
    ]);

    const fieldsList = (fieldsRes.data as unknown as CustomField[]) || [];
    const valuesList =
      (valuesRes.data as unknown as CustomFieldValue[]) || [];

    setFields(fieldsList);
    setExistingValues(valuesList);

    const valMap: Record<string, string> = {};
    valuesList.forEach((v) => {
      valMap[v.custom_field_id] = v.value || "";
    });
    setValues(valMap);
    setLoading(false);
  }

  useEffect(() => {
    if (initialFields !== undefined && initialValues !== undefined) return;
    if (!companyId) return;
    fetchFields();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, companyId, initialFields, initialValues]);

  function handleChange(fieldId: string, val: string) {
    setValues((prev) => ({ ...prev, [fieldId]: val }));
    setDirty(true);
    if (missingFields.includes(fieldId)) {
      setMissingFields((prev) => prev.filter((id) => id !== fieldId));
    }
  }

  async function handleDeleteField(fieldId: string, fieldName: string) {
    if (!companyId) return;
    const confirmed = window.confirm(
      `Excluir o campo "${fieldName}"? Todos os valores preenchidos para este campo serão removidos.`
    );
    if (!confirmed) return;

    const supabase = createClient();
    const { error } = await supabase
      .from("custom_fields")
      .delete()
      .eq("id", fieldId);

    if (error) {
      window.alert(`Erro ao excluir: ${error.message}`);
      return;
    }

    setValues((prev) => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
    setExistingValues((prev) =>
      prev.filter((v) => v.custom_field_id !== fieldId)
    );
    await fetchFields();
  }

  async function handleSave() {
    if (!companyId) return;

    const missing = fields
      .filter((f) => f.is_required && isEmptyValue(f, values[f.id]))
      .map((f) => f.id);
    if (missing.length > 0) {
      setMissingFields(missing);
      return;
    }

    setMissingFields([]);
    setSaving(true);
    const supabase = createClient();

    for (const field of fields) {
      const val = values[field.id] ?? "";
      const existing = existingValues.find(
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
          lead_id: leadId,
          custom_field_id: field.id,
          company_id: companyId,
          value: val,
        });
      }
    }

    const { data: refreshed } = await supabase
      .from("custom_field_values")
      .select("*")
      .eq("lead_id", leadId);
    if (refreshed)
      setExistingValues(refreshed as unknown as CustomFieldValue[]);

    setSaving(false);
    setDirty(false);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
          Campos Personalizados
        </h3>
        {canManageFields && !showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
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

      {showAddForm && companyId && (
        <div className="mb-4">
          <AddCustomFieldForm
            companyId={companyId}
            currentFieldCount={fields.length}
            onCreated={async () => {
              setShowAddForm(false);
              await fetchFields();
            }}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      ) : fields.length === 0 ? (
        <p className="text-sm text-gray-400">
          {canManageFields
            ? "Nenhum campo personalizado ainda. Clique em \"Novo campo\" para criar o primeiro."
            : "Nenhum campo personalizado ainda."}
        </p>
      ) : (
        <>
          {missingFields.length > 0 && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Preencha os campos obrigatórios:{" "}
              {fields
                .filter((f) => missingFields.includes(f.id))
                .map((f) => f.name)
                .join(", ")}
              .
            </div>
          )}
          <div className="space-y-3">
            {fields.map((field) => (
              <div key={field.id} className="group relative">
                <FieldRenderer
                  field={field}
                  value={values[field.id] || ""}
                  onChange={(val) => handleChange(field.id, val)}
                  hasError={missingFields.includes(field.id)}
                />
                {canManageFields && (
                  <button
                    type="button"
                    onClick={() => handleDeleteField(field.id, field.name)}
                    title={`Excluir campo "${field.name}"`}
                    className="absolute right-0 top-0 rounded p-1 text-gray-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
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
                        d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                      />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
          {dirty && (
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Salvando..." : "Salvar campos"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FieldRenderer({
  field,
  value,
  onChange,
  hasError = false,
}: {
  field: CustomField;
  value: string;
  onChange: (val: string) => void;
  hasError?: boolean;
}) {
  const baseInputClass =
    "w-full rounded-lg border px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2";
  const inputClass = `${baseInputClass} ${
    hasError
      ? "border-red-400 focus:border-red-500 focus:ring-red-500/20"
      : "border-gray-300 focus:border-blue-500 focus:ring-blue-500/20"
  }`;

  const options: string[] = Array.isArray(field.options) ? field.options : [];

  switch (field.field_type) {
    case "text":
    case "phone":
    case "email":
    case "url":
      return (
        <div>
          <label className="mb-1 block text-sm text-gray-600">
            {field.name}{field.is_required && <span className="text-red-500"> *</span>}
          </label>
          <input
            type={field.field_type === "email" ? "email" : field.field_type === "url" ? "url" : "text"}
            className={inputClass}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.name}
          />
        </div>
      );

    case "number":
      return (
        <div>
          <label className="mb-1 block text-sm text-gray-600">
            {field.name}{field.is_required && <span className="text-red-500"> *</span>}
          </label>
          <input
            type="number"
            className={inputClass}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.name}
          />
        </div>
      );

    case "date":
      return (
        <div>
          <label className="mb-1 block text-sm text-gray-600">
            {field.name}{field.is_required && <span className="text-red-500"> *</span>}
          </label>
          <input
            type="date"
            className={inputClass}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );

    case "boolean":
      return (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={value === "true"}
            onChange={(e) => onChange(e.target.checked ? "true" : "false")}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-600">
            {field.name}{field.is_required && <span className="text-red-500"> *</span>}
          </span>
        </label>
      );

    case "select":
      return (
        <div>
          <label className="mb-1 block text-sm text-gray-600">
            {field.name}{field.is_required && <span className="text-red-500"> *</span>}
          </label>
          <select
            className={inputClass}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">Selecione...</option>
            {options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );

    case "multi_select": {
      const selected = value ? value.split(",").filter(Boolean) : [];
      return (
        <div>
          <label className="mb-1 block text-sm text-gray-600">
            {field.name}{field.is_required && <span className="text-red-500"> *</span>}
          </label>
          <div className="flex flex-wrap gap-2">
            {options.map((opt) => {
              const isChecked = selected.includes(opt);
              return (
                <label key={opt} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {
                      const next = isChecked
                        ? selected.filter((s) => s !== opt)
                        : [...selected, opt];
                      onChange(next.join(","));
                    }}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-600">{opt}</span>
                </label>
              );
            })}
          </div>
        </div>
      );
    }

    default:
      return (
        <div>
          <label className="mb-1 block text-sm text-gray-600">{field.name}</label>
          <input
            type="text"
            className={inputClass}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
  }
}
