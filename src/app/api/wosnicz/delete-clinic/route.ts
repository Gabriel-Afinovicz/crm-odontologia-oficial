import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/supabase/require-super-admin";

interface DeletePayload {
  clinicId?: string;
  confirmDomain?: string;
}

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin();
  } catch (err) {
    const code = err instanceof Error ? err.message : "UNAUTHORIZED";
    const status = code === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: code }, { status });
  }

  let body: DeletePayload;
  try {
    body = (await req.json()) as DeletePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { clinicId, confirmDomain } = body;

  if (!clinicId || !confirmDomain) {
    return NextResponse.json(
      { error: "clinicId e confirmDomain são obrigatórios." },
      { status: 400 }
    );
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

  const realDomain = (company as { domain: string }).domain;

  if (realDomain === "wosnicz") {
    return NextResponse.json(
      { error: "Não é permitido excluir a clínica-sistema Wosnicz." },
      { status: 400 }
    );
  }

  if (confirmDomain !== realDomain) {
    return NextResponse.json(
      { error: "Confirmação de domínio inválida." },
      { status: 400 }
    );
  }

  const { data: usersList } = await supabaseAdmin
    .from("users")
    .select("auth_id")
    .eq("company_id", clinicId);

  const authIds =
    ((usersList ?? []) as { auth_id: string | null }[])
      .map((u) => u.auth_id)
      .filter((id): id is string => !!id);

  for (const authId of authIds) {
    const { error: delAuthErr } = await supabaseAdmin.auth.admin.deleteUser(authId);
    if (delAuthErr) {
      return NextResponse.json(
        {
          error: `Erro ao remover usuário da autenticação (${authId}): ${delAuthErr.message}`,
        },
        { status: 500 }
      );
    }
  }

  const { error: deleteCompanyError } = await supabaseAdmin
    .from("companies")
    .delete()
    .eq("id", clinicId);

  if (deleteCompanyError) {
    return NextResponse.json(
      { error: `Erro ao excluir clínica: ${deleteCompanyError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
