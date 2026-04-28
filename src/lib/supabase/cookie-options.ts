import type { CookieOptions } from "@supabase/ssr";

/**
 * Converte as opções de cookie do `@supabase/ssr` em opções de "session
 * cookie": sem `maxAge`/`expires`. Assim o navegador descarta a sessão
 * quando o usuário fecha a aba/navegador, e o login volta a ser exigido.
 *
 * Mantemos `maxAge: 0` quando ele já vem assim, pois esse valor é usado
 * pelo supabase-ssr para *remover* o cookie (logout, rotação de chunks).
 */
export function toSessionCookieOptions(
  options: CookieOptions | undefined
): CookieOptions {
  if (!options) return {};
  if (options.maxAge === 0) return options;
  const { maxAge: _maxAge, expires: _expires, ...rest } = options;
  void _maxAge;
  void _expires;
  return rest;
}
