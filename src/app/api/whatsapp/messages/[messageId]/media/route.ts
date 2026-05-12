import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evolution, EvolutionConfigError } from "@/lib/evolution/client";

interface MessageRow {
  id: string;
  company_id: string;
  chat_id: string;
  evolution_message_id: string | null;
  media_type: string;
  media_mime_type: string | null;
}

interface ChatRow {
  id: string;
  company_id: string;
  instance_id: string;
}

interface InstanceRow {
  id: string;
  company_id: string;
  instance_name: string;
  status: "disconnected" | "connecting" | "connected";
}

/**
 * GET /api/whatsapp/messages/[messageId]/media
 *
 * Devolve o binario decodificado da midia (sticker / imagem / video / audio /
 * documento) gravada na linha de `whatsapp_messages` correspondente.
 *
 * A `media_url` que vem do Baileys nos eventos da Evolution e uma URL
 * criptografada do WhatsApp e nao serve para `<img src>` direto: precisa de
 * `mediaKey` + decrypt. Esta rota delega isso para o endpoint
 * `/chat/getBase64FromMediaMessage/{instance}` da Evolution (cache local
 * Baileys, sem trafego para servidores Meta/WhatsApp), recebe o base64 e
 * devolve como bytes com cache curto no navegador.
 *
 * Auth: usuario logado da mesma `company_id` da mensagem. O `messageId` na
 * URL e o uuid local de `whatsapp_messages.id`, nao o `evolution_message_id`,
 * para nao expor identificadores externos diretamente.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ messageId: string }> }
) {
  try {
    const { messageId } = await ctx.params;
    const id = messageId?.trim();
    if (!id) {
      return NextResponse.json(
        { error: "messageId obrigatorio." },
        { status: 400 }
      );
    }

    const downloadParam = req.nextUrl.searchParams.get("download");
    const isDownload = downloadParam === "1" || downloadParam === "true";

    if (!evolution.isConfigured()) {
      return NextResponse.json(
        { error: "Evolution API nao configurada no servidor." },
        { status: 503 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("users")
      .select("id, company_id")
      .eq("auth_id", user.id)
      .single();
    const profileRow = profile as
      | { id: string; company_id: string }
      | null;
    if (!profileRow) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    const supabaseAdmin = createAdminClient();
    const { data: messageData } = await supabaseAdmin
      .from("whatsapp_messages")
      .select(
        "id, company_id, chat_id, evolution_message_id, media_type, media_mime_type"
      )
      .eq("id", id)
      .maybeSingle();
    const messageRow = messageData as MessageRow | null;
    if (!messageRow || messageRow.company_id !== profileRow.company_id) {
      return NextResponse.json(
        { error: "Mensagem nao encontrada." },
        { status: 404 }
      );
    }
    if (messageRow.media_type === "text") {
      return NextResponse.json(
        { error: "Mensagem sem midia." },
        { status: 422 }
      );
    }
    if (!messageRow.evolution_message_id) {
      return NextResponse.json(
        { error: "Mensagem sem identificador Evolution." },
        { status: 422 }
      );
    }

    const { data: chatData } = await supabaseAdmin
      .from("whatsapp_chats")
      .select("id, company_id, instance_id")
      .eq("id", messageRow.chat_id)
      .single();
    const chatRow = chatData as ChatRow | null;
    if (!chatRow || chatRow.company_id !== profileRow.company_id) {
      return NextResponse.json(
        { error: "Chat nao encontrado." },
        { status: 404 }
      );
    }

    const { data: instanceData } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("id, company_id, instance_name, status")
      .eq("id", chatRow.instance_id)
      .single();
    const instanceRow = instanceData as InstanceRow | null;
    if (!instanceRow || instanceRow.company_id !== profileRow.company_id) {
      return NextResponse.json(
        { error: "Instancia nao encontrada." },
        { status: 404 }
      );
    }
    if (instanceRow.status !== "connected") {
      return NextResponse.json(
        {
          error: "WhatsApp desconectado. Reconecte em Configuracoes.",
          code: "NOT_CONNECTED",
        },
        { status: 409 }
      );
    }

    let evoPayload: {
      base64?: string;
      mimetype?: string | null;
      fileName?: string | null;
      mediaType?: string | null;
    };
    try {
      evoPayload = await evolution.getBase64FromMediaMessage(
        instanceRow.instance_name,
        messageRow.evolution_message_id,
        // Para video, pedir conversao para mp4 garante codec tocavel pelo
        // <video> nativo do browser (Chrome/Firefox/Edge). O WhatsApp pode
        // entregar formatos proprietarios; sem mp4 o player nao roda.
        { convertToMp4: messageRow.media_type === "video" }
      );
    } catch (err) {
      if (err instanceof EvolutionConfigError) {
        return NextResponse.json({ error: err.message }, { status: 503 });
      }
      console.error("[messages/media] evolution failed:", {
        messageId: id,
        evoId: messageRow.evolution_message_id,
        error: err instanceof Error ? err.message : err,
      });
      return NextResponse.json(
        { error: "Falha ao buscar midia." },
        { status: 502 }
      );
    }

    const rawBase64 = evoPayload.base64 ?? "";
    if (!rawBase64) {
      return NextResponse.json(
        { error: "Midia indisponivel." },
        { status: 404 }
      );
    }

    // Algumas versoes da Evolution devolvem `data:<mime>;base64,<payload>`,
    // outras devolvem so a parte payload. Aceitamos ambos.
    const dataUriMatch = rawBase64.match(/^data:([^;]+);base64,(.+)$/);
    const base64 = dataUriMatch ? dataUriMatch[2] : rawBase64;
    const dataUriMime = dataUriMatch ? dataUriMatch[1] : null;

    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64, "base64");
    } catch {
      return NextResponse.json(
        { error: "Midia invalida." },
        { status: 502 }
      );
    }

    // Prioriza o mimetype que a Evolution retornou; cai para o salvo no
    // banco; fallback final e octet-stream (browsers tentam adivinhar).
    // Para video, ja pedimos convertToMp4=true acima; corrige o mime
    // se a Evolution retornou outro tipo (algumas versoes mantem
    // application/octet-stream apos conversao).
    let mimetype =
      evoPayload.mimetype ||
      dataUriMime ||
      messageRow.media_mime_type ||
      "application/octet-stream";
    if (messageRow.media_type === "video") {
      mimetype = "video/mp4";
    }

    const filename =
      evoPayload.fileName ||
      buildFallbackFilename(messageRow.media_type, mimetype, id);

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": mimetype,
        "Content-Disposition": `${
          isDownload ? "attachment" : "inline"
        }; filename="${escapeContentDispositionFilename(filename)}"`,
        // Sticker/imagem identificadas pelo evolution_message_id sao
        // imutaveis no cache Baileys. 1h de cache no navegador evita
        // refetches durante a navegacao normal do operador no chat.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error("[messages/media] uncaught:", err);
    return NextResponse.json(
      { error: "Erro interno." },
      { status: 500 }
    );
  }
}

// Sugestao de nome de arquivo quando a Evolution nao retorna `fileName`.
// E so um hint para o usuario na hora de salvar (ou para o atributo
// `download` do `<a>` quando vier `?download=1`); o conteudo e o que vale.
function buildFallbackFilename(
  mediaType: string,
  mimetype: string,
  messageId: string
): string {
  const sub =
    mimetype.split("/")[1]?.split(";")[0]?.split("+")[0]?.toLowerCase() ?? "";
  const fallbackByType: Record<string, string> = {
    image: "jpg",
    video: "mp4",
    audio: "ogg",
    sticker: "webp",
    document: "bin",
  };
  const ext = sub || fallbackByType[mediaType] || "bin";
  return `whatsapp-${mediaType}-${messageId.slice(0, 8)}.${ext}`;
}

// O header Content-Disposition rejeita `"` cru no filename. Para casos em
// que o nome veio da Evolution e contem caracteres problematicos, fazemos
// um escape minimo (aspas e quebras de linha).
function escapeContentDispositionFilename(name: string): string {
  return name.replace(/[\r\n"]/g, "_");
}
