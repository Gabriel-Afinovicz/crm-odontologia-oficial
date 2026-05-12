import type { WhatsAppMessageReaction } from "@/lib/types/database";

// Os 6 emojis padrao do picker rapido de reacoes no WhatsApp. Outros podem
// ser adicionados depois (e.g. um botao "+" abrindo um picker maior), mas
// para o caso de uso de uma clinica esses cobrem 99% das reacoes naturais
// de uma conversa de atendimento.
export const QUICK_REACTION_EMOJIS = [
  "\u{1F44D}", // 👍
  "\u2764\uFE0F", // ❤️
  "\u{1F602}", // 😂
  "\u{1F62E}", // 😮
  "\u{1F622}", // 😢
  "\u{1F64F}", // 🙏
] as const;

export type QuickReactionEmoji = (typeof QUICK_REACTION_EMOJIS)[number];

// Aplica uma reacao nova ao array atual, respeitando a regra do WhatsApp:
// "cada reator tem no maximo 1 reacao ativa por mensagem".
//
// - Reator identificado por `from_me` + `reactor_jid` (em chat individual,
//   `from_me=true` ja basta — so existe um operador-lado). Casamos por
//   `from_me` primario; reactor_jid e refinamento caso o futuro suporte
//   chats multi-usuario.
// - Emoji vazio remove a reacao do reator (mesmo comportamento do app
//   oficial WhatsApp ao enviar `text=""` na reactionMessage do Baileys).
// - Emoji nao vazio SUBSTITUI a reacao anterior do reator (mesmo se for
//   o mesmo emoji — idempotencia). O toggle "clicou no proprio emoji,
//   remove" e responsabilidade da UI, que envia "" explicitamente para
//   remover. Manter a substituicao aqui evita que entregas duplicadas
//   do mesmo `reactionMessage` (via webhook + load-history a cada 15s)
//   sejam erroneamente interpretadas como remocao.
// - Sempre atualizamos o `ts` para refletir a observacao mais nova.
export function mergeReactions(
  current: WhatsAppMessageReaction[] | null | undefined,
  incoming: WhatsAppMessageReaction
): WhatsAppMessageReaction[] {
  const list = Array.isArray(current) ? current : [];
  // Filtra qualquer reacao anterior DO MESMO reator. Em chat individual e
  // `from_me` que importa (operador unico do lado da clinica), em chats
  // futuros com participantes multiplos o reactor_jid serve de tiebreak.
  const sameReactor = (r: WhatsAppMessageReaction): boolean => {
    if (r.from_me !== incoming.from_me) return false;
    if (incoming.reactor_jid && r.reactor_jid) {
      return r.reactor_jid === incoming.reactor_jid;
    }
    return true;
  };
  const filtered = list.filter((r) => !sameReactor(r));
  const trimmedEmoji = (incoming.emoji ?? "").trim();
  if (trimmedEmoji.length === 0) {
    return filtered;
  }
  return [...filtered, { ...incoming, emoji: trimmedEmoji }];
}

// Coerce defensivo do que veio do banco/cliente — JSONB pode ter virado
// `null`, ou um array de objetos com chaves estranhas se alguem mexer
// direto no SQL. Garante que sempre retornamos um array bem tipado.
export function normalizeReactions(raw: unknown): WhatsAppMessageReaction[] {
  if (!Array.isArray(raw)) return [];
  const out: WhatsAppMessageReaction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const emoji = typeof obj.emoji === "string" ? obj.emoji : null;
    if (!emoji) continue;
    out.push({
      emoji,
      from_me: Boolean(obj.from_me),
      reactor_jid:
        typeof obj.reactor_jid === "string" ? obj.reactor_jid : null,
      ts: typeof obj.ts === "string" ? obj.ts : new Date().toISOString(),
    });
  }
  return out;
}
