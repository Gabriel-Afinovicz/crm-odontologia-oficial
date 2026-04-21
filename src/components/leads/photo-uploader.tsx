"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface PhotoUploaderProps {
  companyId: string | null;
  leadId: string | null;
  value: string | null;
  name?: string;
  onChange: (url: string | null) => void;
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? "")
    .join("");
}

export function PhotoUploader({
  companyId,
  leadId,
  value,
  name = "",
  onChange,
}: PhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (!companyId) {
      setError("Aguardando carregar dados da clínica...");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Imagem máxima: 5MB.");
      return;
    }
    setError(null);
    setUploading(true);
    const supabase = createClient();
    const ext = file.name.split(".").pop() || "jpg";
    const leadFolder = leadId ?? "new";
    const path = `${companyId}/${leadFolder}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("patient-photos")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) {
      setError(`Erro ao enviar: ${upErr.message}`);
      setUploading(false);
      return;
    }
    const { data: pub } = supabase.storage
      .from("patient-photos")
      .getPublicUrl(path);
    onChange(pub.publicUrl);
    setUploading(false);
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100 ring-2 ring-white shadow">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt={name || "Foto do paciente"}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-lg font-semibold text-gray-500">
            {initials(name) || "?"}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {uploading ? "Enviando..." : value ? "Trocar foto" : "Enviar foto"}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
            >
              Remover
            </button>
          )}
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <p className="text-[11px] text-gray-400">JPG, PNG ou WEBP · até 5MB</p>
      </div>
    </div>
  );
}
