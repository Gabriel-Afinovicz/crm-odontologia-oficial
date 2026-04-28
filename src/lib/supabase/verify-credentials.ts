import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "./admin";

export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason: "MISSING_CREDENTIALS" | "INVALID_CREDENTIALS" | "MISMATCH";
    };

/**
 * Revalida ramal + senha do super admin **atualmente logado** sem afetar
 * a sessão dele (usa um cliente temporário sem persistência de sessão).
 *
 * @param expectedAuthId auth.users.id do super admin que disparou a ação
 *   (devolvido por `requireSuperAdmin()`).
 */
export async function verifySuperAdminCredentials(
  expectedAuthId: string,
  extensionNumber: string | undefined,
  password: string | undefined
): Promise<VerifyResult> {
  if (!extensionNumber || !password) {
    return { ok: false, reason: "MISSING_CREDENTIALS" };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  const supabaseAdmin = createAdminClient();

  const { data: resolveData, error: resolveErr } = await supabaseAdmin.rpc(
    "resolve_login",
    {
      p_domain: "wosnicz",
      p_extension_number: extensionNumber,
    }
  );

  if (resolveErr) {
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  let authEmail: string | null = null;
  if (Array.isArray(resolveData) && resolveData.length > 0) {
    authEmail = (resolveData[0] as { auth_email?: string }).auth_email ?? null;
  } else if (
    resolveData &&
    typeof resolveData === "object" &&
    "auth_email" in resolveData
  ) {
    authEmail =
      (resolveData as { auth_email?: string }).auth_email ?? null;
  }

  if (!authEmail) {
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  // Cliente isolado: não persiste sessão, não toca em cookies do request.
  const tempClient = createSupabaseClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: signIn, error: signInErr } =
    await tempClient.auth.signInWithPassword({
      email: authEmail,
      password,
    });

  if (signInErr || !signIn.user) {
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  if (signIn.user.id !== expectedAuthId) {
    return { ok: false, reason: "MISMATCH" };
  }

  return { ok: true };
}
