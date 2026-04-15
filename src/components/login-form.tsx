"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface LoginFormProps {
  domain: string;
}

export function LoginForm({ domain }: LoginFormProps) {
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
          p_domain: domain,
          p_extension_number: ramal,
        }
      );

      if (resolveError) {
        throw new Error("Clínica ou ramal não encontrado.");
      }

      const results = resolveData as { auth_email: string }[] | null;

      if (!results || results.length === 0) {
        throw new Error("Ramal não encontrado para esta clínica.");
      }

      const authEmail = results[0].auth_email;

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: senha,
      });

      if (signInError) {
        if (signInError.message.includes("Invalid login credentials")) {
          throw new Error("Senha incorreta. Tente novamente.");
        }
        throw new Error("Erro ao fazer login. Tente novamente.");
      }

      router.push(`/${domain}/dashboard`);
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
        label="Ramal"
        type="text"
        placeholder="Ex: 1001"
        value={ramal}
        onChange={(e) => setRamal(e.target.value)}
        required
        autoComplete="username"
        autoFocus
      />

      <Input
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
        Entrar
      </Button>
    </form>
  );
}
