"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function WosniczLoginForm() {
  const router = useRouter();
  const [ramal, setRamal] = useState("");
  const [senha, setSenha] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();

      const { data: resolveData, error: resolveError } = await supabase.rpc(
        "resolve_login",
        {
          p_domain: "wosnicz",
          p_extension_number: ramal,
        }
      );

      if (resolveError) {
        throw new Error("Ramal não encontrado.");
      }

      let authEmail: string;
      if (Array.isArray(resolveData) && resolveData.length > 0) {
        authEmail = (resolveData[0] as { auth_email: string }).auth_email;
      } else if (
        resolveData &&
        typeof resolveData === "object" &&
        "auth_email" in resolveData
      ) {
        authEmail = (resolveData as { auth_email: string }).auth_email;
      } else {
        throw new Error("Ramal não encontrado.");
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: senha,
      });

      if (signInError) {
        if (signInError.message.includes("Invalid login credentials")) {
          throw new Error("Ramal ou senha incorretos.");
        }
        throw new Error(`Erro no login: ${signInError.message}`);
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error("Sessão não iniciada.");
      }

      const { data: profile } = await supabase
        .from("users")
        .select("role")
        .eq("auth_id", user.id)
        .single();

      const role = (profile as { role: string } | null)?.role;
      if (role !== "super_admin") {
        await supabase.auth.signOut();
        throw new Error("Acesso restrito ao Super Admin.");
      }

      router.push("/wosnicz/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Input
        variant="dark"
        label="Ramal"
        type="text"
        placeholder="Ramal do Super Admin"
        value={ramal}
        onChange={(e) => setRamal(e.target.value)}
        required
        autoComplete="username"
        autoFocus
      />

      <Input
        variant="dark"
        label="Senha"
        type="password"
        placeholder="••••••"
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        required
        autoComplete="current-password"
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Button type="submit" loading={loading} className="w-full" size="lg">
        Entrar no Painel
      </Button>
    </form>
  );
}
