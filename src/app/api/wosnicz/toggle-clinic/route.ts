import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/supabase/require-super-admin";
import { verifySuperAdminCredentials } from "@/lib/supabase/verify-credentials";

interface TogglePayload {
  clinicId?: string;
  isActive?: boolean;
  extensionNumber?: string;
  password?: string;
}

export async function POST(req: NextRequest) {
  let session: { userId: string; authId: string };
  try {
    session = await requireSuperAdmin();
  } catch (err) {
    const code = err instanceof Error ? err.message : "UNAUTHORIZED";
    const status = code === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: code }, { status });
  }

  let body: TogglePayload;
  try {
    body = (await req.json()) as TogglePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { clinicId, isActive, extensionNumber, password } = body;

  if (!clinicId || typeof isActive !== "boolean") {
    return NextResponse.json(
      { error: "clinicId e isActive são obrigatórios." },
      { status: 400 }
    );
  }

  const verify = await verifySuperAdminCredentials(
    session.authId,
    extensionNumber,
    password
  );
  if (!verify.ok) {
    const message =
      verify.reason === "MISSING_CREDENTIALS"
        ? "Informe seu ramal e senha para confirmar."
        : verify.reason === "MISMATCH"
          ? "Use o ramal e a senha do super admin que está logado."
          : "Ramal ou senha incorretos.";
    return NextResponse.json({ error: message }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: company } = await supabaseAdmin
    .from("companies")
    .select("id, domain")
    .eq("id", clinicId)
    .single();

  if (!company) {
    return NextResponse.json(
      { error: "Clínica não encontrada." },
      { status: 404 }
    );
  }

  if ((company as { domain: string }).domain === "wosnicz") {
    return NextResponse.json(
      { error: "Não é permitido alterar a clínica-sistema Wosnicz." },
      { status: 400 }
    );
  }

  const { error: updateError } = await supabaseAdmin
    .from("companies")
    .update({ is_active: isActive })
    .eq("id", clinicId);

  if (updateError) {
    return NextResponse.json(
      { error: `Erro ao atualizar: ${updateError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, isActive });
}
