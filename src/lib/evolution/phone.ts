/**
 * Helpers para normalizacao de telefone <-> JID do WhatsApp.
 *
 * JID padrao individual: 5511999999999@s.whatsapp.net
 * JID de grupo: 1234567890-99999@g.us (nao tratamos aqui).
 */

const DEFAULT_COUNTRY_CODE = "55";

export function onlyDigits(input: string | null | undefined): string {
  if (!input) return "";
  return input.replace(/\D+/g, "");
}

/**
 * Normaliza um telefone (com ou sem mascara, com ou sem +55) para JID.
 * Se o numero ja vier com 12-13 digitos comecando com 55, mantem.
 * Caso contrario, prefixa com 55.
 */
export function phoneToJid(phone: string | null | undefined): string | null {
  const digits = onlyDigits(phone);
  if (digits.length < 8) return null;
  let normalized = digits;
  if (normalized.length <= 11) {
    normalized = `${DEFAULT_COUNTRY_CODE}${normalized}`;
  }
  return `${normalized}@s.whatsapp.net`;
}

export function jidToPhone(jid: string | null | undefined): string {
  if (!jid) return "";
  const at = jid.indexOf("@");
  return at === -1 ? jid : jid.slice(0, at);
}

/**
 * Identifica se um JID corresponde a chat individual (nao grupo).
 *
 * Aceita os 3 formatos individuais que a Evolution/Baileys entrega:
 *   - `@s.whatsapp.net` formato classico, telefone visivel.
 *   - `@c.us`           formato legado equivalente.
 *   - `@lid`            "Linked ID", introduzido pelo WhatsApp para
 *                       esconder o telefone do remetente em casos de
 *                       privacidade. Quando o cache da Evolution tem
 *                       o `remoteJidAlt`, deve-se preferi-lo via
 *                       `canonicalRemoteJid` antes de chegar aqui.
 */
export function isIndividualJid(jid: string | null | undefined): boolean {
  if (!jid) return false;
  return (
    jid.endsWith("@s.whatsapp.net") ||
    jid.endsWith("@c.us") ||
    jid.endsWith("@lid")
  );
}

/**
 * Mapeia um `remoteJid` para a forma canonica que o CRM usa em
 * `whatsapp_chats.remote_jid`. Quando o JID veio em `@lid` (privacidade
 * do WhatsApp) e o Baileys/Evolution entregou `remoteJidAlt` apontando
 * para o telefone real, preferimos o alt para manter o historico
 * unificado com o que o CRM ja tinha em `@s.whatsapp.net`/`@c.us`.
 *
 * Sem alt, devolvemos o proprio JID — o chat sera criado/usado em
 * `@lid` mesmo (caso de contatos que nunca tiveram `@s.whatsapp.net`
 * conhecido pelo dispositivo).
 */
export function canonicalRemoteJid(
  remoteJid: string | null | undefined,
  remoteJidAlt: string | null | undefined
): string | null {
  if (!remoteJid) return null;
  if (
    remoteJid.endsWith("@lid") &&
    remoteJidAlt &&
    (remoteJidAlt.endsWith("@s.whatsapp.net") ||
      remoteJidAlt.endsWith("@c.us"))
  ) {
    return remoteJidAlt;
  }
  return remoteJid;
}

/**
 * Para JIDs individuais brasileiros (DDI 55, celular), retorna o JID
 * "irmao" alternando o nono digito que foi adicionado a celulares fora
 * de SP/RJ. WhatsApp pode entregar a mesma conversa em qualquer das duas
 * formas; precisamos tratar como mesmo contato.
 *
 * So se aplica a `@s.whatsapp.net`/`@c.us` — `@lid` nao usa o telefone
 * como identidade entao nao tem o conceito de irmao.
 *
 * Formato esperado:
 *   - sem 9: 55 + DDD(2) + numero(8) = 12 digitos -> adiciona "9" entre DDD e numero
 *   - com 9: 55 + DDD(2) + 9 + numero(8) = 13 digitos com posicao[4]==='9'
 *            -> remove o "9"
 *
 * Numeros que nao se encaixam (fixos com 8 digitos sem celular, outros DDIs,
 * grupos, `@lid`, etc) retornam null.
 */
export function siblingJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  if (!jid.endsWith("@s.whatsapp.net") && !jid.endsWith("@c.us")) return null;
  const digits = jidToPhone(jid);
  if (!/^\d+$/.test(digits)) return null;
  if (!digits.startsWith("55")) return null;

  if (digits.length === 12) {
    // 55 DD NNNNNNNN  -> 55 DD 9 NNNNNNNN
    const ddd = digits.slice(2, 4);
    const local = digits.slice(4);
    const expanded = `55${ddd}9${local}`;
    return `${expanded}@s.whatsapp.net`;
  }
  if (digits.length === 13 && digits[4] === "9") {
    // 55 DD 9 NNNNNNNN -> 55 DD NNNNNNNN
    const ddd = digits.slice(2, 4);
    const local = digits.slice(5);
    const reduced = `55${ddd}${local}`;
    return `${reduced}@s.whatsapp.net`;
  }
  return null;
}
