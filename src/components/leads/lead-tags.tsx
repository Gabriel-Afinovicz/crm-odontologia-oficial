"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentCompany } from "@/hooks/use-current-company";
import { Badge } from "@/components/ui/badge";
import type { Tag } from "@/lib/types/database";

interface LeadTagsProps {
  leadId: string;
  initialAllTags?: Tag[];
  initialAssignedTags?: Tag[];
}

const PRESET_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#6366f1", "#14b8a6",
];

export function LeadTags({
  leadId,
  initialAllTags,
  initialAssignedTags,
}: LeadTagsProps) {
  const { companyId } = useCurrentCompany();
  const [tags, setTags] = useState<Tag[]>(initialAssignedTags ?? []);
  const [allTags, setAllTags] = useState<Tag[]>(initialAllTags ?? []);
  const [loading, setLoading] = useState(
    initialAllTags === undefined || initialAssignedTags === undefined
  );
  const [showPicker, setShowPicker] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  async function fetchData() {
    if (!companyId) return;
    const supabase = createClient();

    const [leadTagsRes, allTagsRes] = await Promise.all([
      supabase.from("lead_tags").select("tag_id").eq("lead_id", leadId),
      supabase
        .from("tags")
        .select("*")
        .eq("company_id", companyId)
        .order("name"),
    ]);

    const allTagsList = (allTagsRes.data as unknown as Tag[]) || [];
    setAllTags(allTagsList);

    if (leadTagsRes.data && leadTagsRes.data.length > 0) {
      const tagIds = new Set(leadTagsRes.data.map((lt: { tag_id: string }) => lt.tag_id));
      setTags(allTagsList.filter((t) => tagIds.has(t.id)));
    } else {
      setTags([]);
    }

    setLoading(false);
  }

  useEffect(() => {
    if (initialAllTags !== undefined && initialAssignedTags !== undefined) {
      return;
    }
    if (!companyId) return;
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, companyId, initialAllTags, initialAssignedTags]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
        setShowCreate(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const assignedTagIds = new Set(tags.map((t) => t.id));
  const availableTags = allTags.filter((t) => !assignedTagIds.has(t.id));

  async function addTag(tagId: string) {
    const supabase = createClient();
    await supabase.from("lead_tags").insert({ lead_id: leadId, tag_id: tagId });
    await fetchData();
  }

  async function removeTag(tagId: string) {
    const supabase = createClient();
    await supabase.from("lead_tags").delete().eq("lead_id", leadId).eq("tag_id", tagId);
    await fetchData();
  }

  async function createAndAddTag() {
    if (!newName.trim() || !companyId) return;
    setSaving(true);
    const supabase = createClient();

    const { data: newTag } = await supabase
      .from("tags")
      .insert({ name: newName.trim(), color: newColor, company_id: companyId })
      .select("id")
      .single();

    if (newTag) {
      const tagId = (newTag as { id: string }).id;
      await supabase.from("lead_tags").insert({ lead_id: leadId, tag_id: tagId });
    }

    setNewName("");
    setNewColor(PRESET_COLORS[0]);
    setShowCreate(false);
    setSaving(false);
    await fetchData();
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">Tags</h3>
        <div className="h-6 w-24 animate-pulse rounded bg-gray-100" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Tags</h3>
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => { setShowPicker(!showPicker); setShowCreate(false); }}
            className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>

          {showPicker && (
            <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              {availableTags.length > 0 && (
                <div className="max-h-40 overflow-y-auto">
                  {availableTags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => { addTag(tag.id); setShowPicker(false); }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }} />
                      {tag.name}
                    </button>
                  ))}
                </div>
              )}
              {availableTags.length > 0 && <div className="my-1 border-t border-gray-100" />}

              {!showCreate ? (
                <button
                  onClick={() => setShowCreate(true)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Criar nova tag
                </button>
              ) : (
                <div className="space-y-2 px-3 py-2">
                  <input
                    type="text"
                    placeholder="Nome da tag"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                    autoFocus
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setNewColor(c)}
                        className={`h-5 w-5 rounded-full transition-transform ${newColor === c ? "scale-125 ring-2 ring-offset-1 ring-gray-400" : ""}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <button
                    onClick={createAndAddTag}
                    disabled={saving || !newName.trim()}
                    className="w-full rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? "Criando..." : "Criar e adicionar"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {tags.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhuma tag associada</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Badge key={tag.id} color={tag.color} className="group gap-1 pr-1.5">
              {tag.name}
              <button
                onClick={() => removeTag(tag.id)}
                className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-50 transition-opacity hover:opacity-100"
              >
                <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
