// Janela de visibilidade da lista de Conversas. Chats sem atividade nos
// ultimos N dias nao aparecem por padrao na lista lateral; reaparecem
// sozinhos quando recebem (webhook/load-history) ou enviam (messages/send)
// — ambos atualizam last_message_at para now() e o realtime/poll do client
// reapresenta o chat. A busca por nome/telefone (server-side) ignora esse
// filtro para permitir localizar contatos antigos quando preciso.
//
// Tambem usado por /api/whatsapp/instance/sync como criterio para pular
// chamadas de whatsappNumbers (servidor WA, sensivel a banimento) em
// chats que nao vao aparecer na UI mesmo apos resolverem o nome.
export const CHAT_VISIBILITY_DAYS = 30;

export function chatVisibilityCutoffIso(): string {
  return new Date(
    Date.now() - CHAT_VISIBILITY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
}
