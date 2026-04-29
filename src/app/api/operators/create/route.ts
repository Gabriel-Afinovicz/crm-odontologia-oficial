import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminForDomain } from "@/lib/supabase/require-admin-for-domain";

interface CreateOperatorPayload {
  domain?: string;
  name?: string;
  extension?: string;
  password?: string;
  role?: "operator" | "admin";
  tagIds?: string[];
}

const EXTENSION_REGEX = /^[0-9]+$/;

export async function POST(req: NextRequest) {
  let body: CreateOperatorPayload;
  try {
    body = (await req.json()) as CreateOperatorPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const domain = body.domain?.trim().toLowerCase();
  const name = body.name?.trim();
  const extension = body.extension?.trim();
  const password = body.password;
  const role: "operator" | "admin" =
    body.role === "admin" ? "admin" : "operator";
  const tagIds = Array.isArray(body.tagIds)
    ? body.tagIds.filter((t): t is string => typeof t === "string")
    : [];

  if (!domain) {
    return NextResponse.json({ error: "Domínio obrigatório." }, { status: 400 });
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

  if (!name || !extension || !password) {
    return NextResponse.json(
      { error: "Nome, ramal e senha são obrigatórios." },
      { status: 400 }
    );
  }

  if (!EXTENSION_REGEX.test(extension)) {
    return NextResponse.json(
      { error: "Ramal inválido. Use apenas números." },
      { status: 400 }
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "A senha deve ter pelo menos 6 caracteres." },
      { status: 400 }
    );
  }

  const email = `${extension}@${domain}.crm`;
  const supabaseAdmin = createAdminClient();

  const { data: existing } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("company_id", ctx.companyId)
    .eq("extension_number", extension)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "Já existe um usuário com esse ramal nesta clínica." },
      { status: 409 }
    );
  }

  const { data: newUserId, error: rpcError } = await supabaseAdmin.rpc(
    "create_user",
    {
      p_company_id: ctx.companyId,
      p_name: name,
      p_email: email,
      p_extension_number: extension,
      p_password: password,
      p_role: role,
    }
  );

  if (rpcError) {
    return NextResponse.json(
      { error: `Erro ao criar usuário: ${rpcError.message}` },
      { status: 500 }
    );
  }

  if (typeof newUserId === "string" && tagIds.length > 0) {
    const { error: tagErr } = await supabaseAdmin
      .from("user_role_tag_assignments")
      .insert(tagIds.map((tagId) => ({ user_id: newUserId, tag_id: tagId })));
    if (tagErr) {
      return NextResponse.json(
        {
          id: newUserId,
          name,
          extension,
          email,
          warning: `Usuário criado, mas houve erro ao salvar funções: ${tagErr.message}`,
        },
        { status: 200 }
      );
    }
  }

  return NextResponse.json({ id: newUserId, name, extension, email });
}
