"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "./session-provider";

// Atraso para nao competir com o render inicial. O sync e fire-and-forget;
// o objetivo e o usuario ver o app rapido e a sincronizacao acontecer logo
// em seguida em background (chats + ultimas mensagens dos top 20 chats).
const DISPATCH_DELAY_MS = 1500;

/**
 * Dispara um sync server-side da Evolution -> Supabase apos o login, em
 * background, sem bloquear a UI.
 *
 * Comportamento:
 *  - Roda no maximo UMA vez por aba/sessao de browser, identificada por
 *    `${companyId}:${userId}` em sessionStorage. Login -> logout -> login
 *    do mesmo user na mesma sessao tambem nao re-dispara (sessionStorage
 *    sobrevive a logout); se o usuario quiser forcar, basta abrir aba nova.
 *  - NAO roda na rota `/conversas` para nao competir com o polling proprio
 *    daquela tela. Se o usuario aterrissa direto em /conversas, a propria
 *    pagina ja faz seu pull individual; o sync global pode rodar quando ele
 *    navegar para outra aba.
 *  - NAO roda na pagina de login (`/${domain}` raiz).
 *  - O servidor tem cooldown de 60s, entao multiplos operadores logando ao
 *    mesmo tempo nao geram rajada — apenas o primeiro de fato sincroniza.
 *
 * Sem UI: o componente nao renderiza nada visivel.
 */
export function WhatsAppPostLoginSync() {
  const session = useSession();
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!session.userId || !session.companyId || !session.domain) return;

    // /${domain} sozinho e a tela de login (LoginForm); /conversas tem
    // logica propria de pull. Em qualquer um desses, nao ha por que disparar.
    if (!pathname) return;
    const loginPath = `/${session.domain}`;
    const conversasPath = `/${session.domain}/conversas`;
    if (pathname === loginPath) return;
    if (pathname.startsWith(conversasPath)) return;

    const key = `wa:postSync:${session.companyId}:${session.userId}`;
    let alreadyDone = false;
    try {
      alreadyDone = sessionStorage.getItem(key) === "1";
    } catch {
      // sessionStorage pode estar bloqueado (modo privado em alguns browsers);
      // melhor falhar fechado e nao disparar do que duplicar requests.
      return;
    }
    if (alreadyDone) return;

    try {
      sessionStorage.setItem(key, "1");
    } catch {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      void fetch("/api/whatsapp/post-login-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        // keepalive permite o request seguir mesmo se o usuario navegar/fechar
        // a aba logo em seguida; o sync e background e nao bloqueia ninguem.
        keepalive: true,
      })
        .then(async (res) => {
          if (process.env.NODE_ENV !== "development") return;
          const payload = await res.json().catch(() => null);
          console.debug("[wa:postSync] result:", payload);
        })
        .catch((err) => {
          if (process.env.NODE_ENV !== "development") return;
          console.debug("[wa:postSync] failed:", err);
          // Se a chamada falhou, libera o marcador para tentar de novo na
          // proxima navegacao; ainda dentro do mesmo "uma vez por sessao
          // por user" — o cooldown server-side cobre o resto.
          try {
            sessionStorage.removeItem(key);
          } catch {
            /* noop */
          }
        });
    }, DISPATCH_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [session.userId, session.companyId, session.domain, pathname]);

  return null;
}
