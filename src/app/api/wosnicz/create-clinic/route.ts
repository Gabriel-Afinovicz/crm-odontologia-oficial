import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/supabase/require-super-admin";

interface CreateClinicPayload {
  name?: string;
  domain?: string;
  admin?: {
    name?: string;
    extension?: string;
    password?: string;
  };
}

const DOMAIN_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin();
  } catch (err) {
    const code = err instanceof Error ? err.message : "UNAUTHORIZED";
    const status = code === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: code }, { status });
  }

  let body: CreateClinicPayload;
  try {
    body = (await req.json()) as CreateClinicPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = body.name?.trim();
  const domain = body.domain?.trim().toLowerCase();

  if (!name || !domain) {
    return NextResponse.json(
      { error: "Nome e domínio são obrigatórios." },
      { status: 400 }
    );
  }

  if (!DOMAIN_REGEX.test(domain)) {
    return NextResponse.json(
      { error: "Domínio inválido. Use apenas letras minúsculas, números e hífens." },
      { status: 400 }
    );
  }

  const admin = body.admin;
  const hasAdminData =
    !!(admin?.name?.trim() || admin?.extension?.trim() || admin?.password);

  if (hasAdminData) {
    if (!admin?.name?.trim() || !admin?.extension?.trim() || !admin?.password) {
      return NextResponse.json(
        {
          error:
            "Para criar o admin, preencha nome, ramal e senha — ou deixe os três vazios.",
        },
        { status: 400 }
      );
    }
    if (admin.password.length < 6) {
      return NextResponse.json(
        { error: "A senha do admin deve ter pelo menos 6 caracteres." },
        { status: 400 }
      );
    }
  }

  const supabaseAdmin = createAdminClient();

  const { data: existing } = await supabaseAdmin
    .from("companies")
    .select("id")
    .eq("domain", domain)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "Já existe uma clínica com esse domínio." },
      { status: 409 }
    );
  }

  const { data: created, error: insertError } = await supabaseAdmin
    .from("companies")
    .insert({ name, domain, is_active: true })
    .select("id, name, domain")
    .single();

  if (insertError || !created) {
    return NextResponse.json(
      { error: `Erro ao criar clínica: ${insertError?.message ?? "desconhecido"}` },
      { status: 500 }
    );
  }

  const companyId = (created as { id: string }).id;

  if (hasAdminData && admin) {
    const adminName = admin.name!.trim();
    const extension = admin.extension!.trim();
    const password = admin.password!;
    const email = `${extension}@${domain}.crm`;

    const { data: authUser, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (authError || !authUser?.user) {
      await supabaseAdmin.from("companies").delete().eq("id", companyId);
      return NextResponse.json(
        {
          error: `Erro ao criar usuário admin: ${authError?.message ?? "desconhecido"}`,
        },
        { status: 500 }
      );
    }

    const { error: profileError } = await supabaseAdmin.from("users").insert({
      company_id: companyId,
      auth_id: authUser.user.id,
      name: adminName,
      email,
      extension_number: extension,
      role: "admin",
      is_active: true,
    });

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      await supabaseAdmin.from("companies").delete().eq("id", companyId);
      return NextResponse.json(
        { error: `Erro ao registrar admin: ${profileError.message}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    id: companyId,
    name: (created as { name: string }).name,
    domain: (created as { domain: string }).domain,
  });
}
