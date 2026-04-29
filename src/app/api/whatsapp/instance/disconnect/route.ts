import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminForDomain } from "@/lib/supabase/require-admin-for-domain";
import { evolution } from "@/lib/evolution/client";

interface DisconnectPayload {
  domain?: string;
}

interface InstanceRow {
  id: string;
  instance_name: string;
}

export async function POST(req: NextRequest) {
  let body: DisconnectPayload;
  try {
    body = (await req.json()) as DisconnectPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const domain = body.domain?.trim().toLowerCase();
  if (!domain) {
    return NextResponse.json(
      { error: "Dominio obrigatorio." },
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

  const supabaseAdmin = createAdminClient();
  const { data: instance } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, instance_name")
    .eq("company_id", ctx.companyId)
    .maybeSingle();
  const instanceRow = instance as InstanceRow | null;

  if (!instanceRow) {
    return NextResponse.json({ ok: true, alreadyDisconnected: true });
  }

  if (evolution.isConfigured()) {
    try {
      await evolution.logout(instanceRow.instance_name);
    } catch {
      // se a Evolution ja perdeu sessao, segue normal
    }
  }

  await supabaseAdmin
    .from("whatsapp_instances")
    .update({
      status: "disconnected",
      phone_number: null,
      connected_at: null,
    })
    .eq("id", instanceRow.id);

  return NextResponse.json({ ok: true });
}
