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
 */
export function isIndividualJid(jid: string | null | undefined): boolean {
  if (!jid) return false;
  return jid.endsWith("@s.whatsapp.net");
}
