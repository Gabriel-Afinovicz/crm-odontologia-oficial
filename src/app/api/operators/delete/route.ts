import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminForDomain } from "@/lib/supabase/require-admin-for-domain";

interface DeleteOperatorPayload {
  domain?: string;
  userId?: string;
}

export async function POST(req: NextRequest) {
  let body: DeleteOperatorPayload;
  try {
    body = (await req.json()) as DeleteOperatorPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const domain = body.domain?.trim().toLowerCase();
  const userId = body.userId?.trim();

  if (!domain || !userId) {
    return NextResponse.json(
      { error: "domain e userId são obrigatórios." },
      { status: 400 }
    );
  }

  let ctx;
  try {
    ctx = await requireAdminForDomain(domain);
  } catch (err) {
    const code = err instanceof Error ? err.message : "UNAUTHORIZED";
    const status =
      code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" ? 404 : 401;
    return NextResponse.json({ error: code }, { status });
  }

  if (userId === ctx.userId) {
    return NextResponse.json(
      { error: "Você não pode excluir seu próprio usuário." },
      { status: 400 }
    );
  }

  const supabaseAdmin = createAdminClient();

  const { data: target } = await supabaseAdmin
    .from("users")
    .select("id, role, company_id, auth_id")
    .eq("id", userId)
    .single();

  const targetRecord = target as
    | { id: string; role: string; company_id: string; auth_id: string | null }
    | null;

  if (!targetRecord) {
    return NextResponse.json(
      { error: "Usuário não encontrado." },
      { status: 404 }
    );
  }

  if (targetRecord.company_id !== ctx.companyId) {
    return NextResponse.json(
      { error: "Usuário não pertence a esta clínica." },
      { status: 403 }
    );
  }

  if (targetRecord.role !== "operator") {
    return NextResponse.json(
      { error: "Apenas operadores podem ser excluídos por aqui." },
      { status: 400 }
    );
  }

  if (targetRecord.auth_id) {
    const { error: delAuthErr } = await supabaseAdmin.auth.admin.deleteUser(
      targetRecord.auth_id
    );
    if (delAuthErr) {
      return NextResponse.json(
        {
          error: `Erro ao remover usuário da autenticação: ${delAuthErr.message}`,
        },
        { status: 500 }
      );
    }
  }

  const { error: deleteError } = await supabaseAdmin
    .from("users")
    .delete()
    .eq("id", targetRecord.id);

  if (deleteError) {
    return NextResponse.json(
      { error: `Erro ao excluir operador: ${deleteError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
