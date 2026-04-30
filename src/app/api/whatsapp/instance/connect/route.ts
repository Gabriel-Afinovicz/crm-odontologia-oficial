import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminForDomain } from "@/lib/supabase/require-admin-for-domain";
import { evolution, EvolutionConfigError } from "@/lib/evolution/client";

interface ConnectPayload {
  domain?: string;
}

interface InstanceRow {
  id: string;
  instance_name: string;
  status: "disconnected" | "connecting" | "connected";
  evolution_token: string | null;
}

export async function POST(req: NextRequest) {
  if (!evolution.isConfigured()) {
    return NextResponse.json(
      { error: "Evolution API nao configurada no servidor." },
      { status: 503 }
    );
  }

  let body: ConnectPayload;
  try {
    body = (await req.json()) as ConnectPayload;
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
  const instanceName = domain;

  const { data: existing } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, instance_name, status, evolution_token")
    .eq("company_id", ctx.companyId)
    .maybeSingle();
  const existingRow = (existing as InstanceRow | null) ?? null;

  let instanceId = existingRow?.id ?? null;
  let evolutionToken = existingRow?.evolution_token ?? null;

  try {
    if (!existingRow) {
      const created = await evolution.createInstance(instanceName);
      const hashApiKey =
        typeof created.hash === "string"
          ? created.hash
          : created.hash?.apikey ?? null;
      evolutionToken = hashApiKey;

      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from("whatsapp_instances")
        .insert({
          company_id: ctx.companyId,
          instance_name: instanceName,
          status: "connecting",
          evolution_token: evolutionToken,
        })
        .select("id")
        .single();
      if (insertErr || !inserted) {
        return NextResponse.json(
          { error: `Erro ao registrar instance: ${insertErr?.message}` },
          { status: 500 }
        );
      }
      instanceId = (inserted as { id: string }).id;

      const initialQr = created.qrcode?.base64 ?? null;
      if (initialQr) {
        return NextResponse.json({
          instanceId,
          status: "connecting",
          qrBase64: initialQr,
          pairingCode: null,
        });
      }
    }

    // Re-registra o webhook caso a URL tenha mudado
    const webhookUrl = process.env.EVOLUTION_WEBHOOK_BASE_URL
      ? `${process.env.EVOLUTION_WEBHOOK_BASE_URL.replace(/\/$/, "")}/api/whatsapp/webhook/${encodeURIComponent(instanceName)}`
      : null;
    if (webhookUrl) {
      await evolution.setWebhook(instanceName, webhookUrl);
    }

    const connectRes = await evolution.connect(instanceName);
    await supabaseAdmin
      .from("whatsapp_instances")
      .update({ status: "connecting" })
      .eq("company_id", ctx.companyId);

    return NextResponse.json({
      instanceId,
      status: "connecting",
      qrBase64: connectRes.base64 ?? null,
      pairingCode: connectRes.pairingCode ?? connectRes.code ?? null,
    });
  } catch (err) {
    if (err instanceof EvolutionConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json(
      { error: `Falha ao conectar Evolution: ${message}` },
      { status: 502 }
    );
  }
}
