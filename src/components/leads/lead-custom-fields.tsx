"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { CustomField, CustomFieldValue } from "@/lib/types/database";

interface LeadCustomFieldsProps {
  leadId: string;
}

export function LeadCustomFields({ leadId }: LeadCustomFieldsProps) {
  const { profile } = useAuth();
  const [fields, setFields] = useState<CustomField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [existingValues, setExistingValues] = useState<CustomFieldValue[]>([]);

  useEffect(() => {
    async function fetchData() {
      const supabase = createClient();

      const [fieldsRes, valuesRes] = await Promise.all([
        supabase.from("custom_fields").select("*").eq("is_active", true).order("display_order"),
        supabase.from("custom_field_values").select("*").eq("lead_id", leadId),
      ]);

      const fieldsList = (fieldsRes.data as unknown as CustomField[]) || [];
      const valuesList = (valuesRes.data as unknown as CustomFieldValue[]) || [];

      setFields(fieldsList);
      setExistingValues(valuesList);

      const valMap: Record<string, string> = {};
      valuesList.forEach((v) => {
        valMap[v.custom_field_id] = v.value || "";
      });
      setValues(valMap);
      setLoading(false);
    }

    fetchData();
  }, [leadId]);

  function handleChange(fieldId: string, val: string) {
    setValues((prev) => ({ ...prev, [fieldId]: val }));
    setDirty(true);
  }

  async function handleSave() {
    if (!profile?.company_id) return;
    setSaving(true);
    const supabase = createClient();

    for (const field of fields) {
      const val = values[field.id] ?? "";
      const existing = existingValues.find((v) => v.custom_field_id === field.id);

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
          company_id: profile.company_id,
          value: val,
        });
      }
    }

    const { data: refreshed } = await supabase
      .from("custom_field_values")
      .select("*")
      .eq("lead_id", leadId);
    if (refreshed) setExistingValues(refreshed as unknown as CustomFieldValue[]);

    setSaving(false);
    setDirty(false);
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
          Campos Personalizados
        </h3>
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  if (fields.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
        Campos Personalizados
      </h3>
      <div className="space-y-3">
        {fields.map((field) => (
          <FieldRenderer
            key={field.id}
            field={field}
            value={values[field.id] || ""}
            onChange={(val) => handleChange(field.id, val)}
          />
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
    </div>
  );
}

function FieldRenderer({
  field,
  value,
  onChange,
}: {
  field: CustomField;
  value: string;
  onChange: (val: string) => void;
}) {
  const inputClass =
    "w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20";

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
