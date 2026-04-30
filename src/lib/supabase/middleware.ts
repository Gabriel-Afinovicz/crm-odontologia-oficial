import { createServerClient } from "@supabase/ssr";
import { AuthApiError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { toSessionCookieOptions } from "./cookie-options";

function isExpectedAuthError(err: unknown): boolean {
  if (err instanceof AuthApiError) {
    if (err.code === "refresh_token_not_found") return true;
    if (err.status >= 400 && err.status < 500) return true;
  }
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: string }).code === "refresh_token_not_found"
  ) {
    return true;
  }
  return false;
}

function clearSupabaseAuthCookies(
  request: NextRequest,
  response: NextResponse
) {
  for (const cookie of request.cookies.getAll()) {
    if (!cookie.name.startsWith("sb-")) continue;
    response.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
  }
}

/**
 * Middleware leve: só valida sessão (uma ida ao auth server) e resolve redirects
 * de login/logout. A checagem de "usuário pertence a este tenant" fica nos
 * layouts de `[domain]` e `/wosnicz`, que já leem o perfil uma vez por request
 * via `getAuthSession()` (deduplicado com `React.cache`).
 *
 * Isso elimina uma query adicional por navegação no edge.
 */
export async function updateSession(request: NextRequest) {
  // Rotas de API nunca devem passar pela logica de tenant/redirect — elas
  // sao chamadas por clientes (webhooks, fetch interno) sem cookies de sessao.
  // Sem este early return, o middleware tratava "api" como nome de tenant
  // e redirecionava webhooks publicos (ex: /api/whatsapp/webhook/...) para
  // /api, fazendo a requisicao nunca chegar no route handler.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(
              name,
              value,
              toSessionCookieOptions(options)
            )
          );
        },
      },
    }
  );

  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] =
    null;
  try {
    const result = await supabase.auth.getUser();
    if (result.error) {
      if (isExpectedAuthError(result.error)) {
        clearSupabaseAuthCookies(request, supabaseResponse);
      } else {
        console.error("[proxy] supabase.auth.getUser:", result.error);
      }
    } else {
      user = result.data.user;
    }
  } catch (err) {
    if (isExpectedAuthError(err)) {
      clearSupabaseAuthCookies(request, supabaseResponse);
    } else {
      console.error("[proxy] supabase.auth.getUser threw:", err);
    }
  }

  const { pathname } = request.nextUrl;
  const segments = pathname.split("/").filter(Boolean);
  const domain = segments[0];

  if (!domain) {
    return supabaseResponse;
  }

  const isLoginPage = segments.length === 1;
  const isPublicConfirmation = segments[1] === "confirmar";
  const isProtectedRoute = segments.length > 1 && !isPublicConfirmation;

  // /wosnicz/* → login se não autenticado; cross-tenant é validado no layout.
  if (domain === "wosnicz") {
    if (!user && isProtectedRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/wosnicz";
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  if (isProtectedRoute && !user) {
    const url = request.nextUrl.clone();
    url.pathname = `/${domain}`;
    return NextResponse.redirect(url);
  }

  if (isLoginPage && user) {
    const url = request.nextUrl.clone();
    url.pathname = `/${domain}/dashboard`;
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
