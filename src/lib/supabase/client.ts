import { createBrowserClient, type CookieOptions } from "@supabase/ssr";
import { toSessionCookieOptions } from "./cookie-options";

function getAllBrowserCookies(): { name: string; value: string }[] {
  if (typeof document === "undefined") return [];
  if (!document.cookie) return [];
  const out: { name: string; value: string }[] = [];
  for (const part of document.cookie.split("; ")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) {
      out.push({ name: part, value: "" });
      continue;
    }
    const name = part.slice(0, eq);
    let raw = part.slice(eq + 1);
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
      raw = raw.slice(1, -1);
    }
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      value = raw;
    }
    out.push({ name, value });
  }
  return out;
}

function serializeBrowserCookie(
  name: string,
  value: string,
  options: CookieOptions
): string {
  let str = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
  if (options.path) str += `; Path=${options.path}`;
  if (options.domain) str += `; Domain=${options.domain}`;
  if (options.sameSite) {
    const ss =
      typeof options.sameSite === "string"
        ? options.sameSite
        : options.sameSite
          ? "Strict"
          : "Lax";
    const cap = ss.charAt(0).toUpperCase() + ss.slice(1).toLowerCase();
    str += `; SameSite=${cap}`;
  }
  if (options.secure) str += `; Secure`;
  if (typeof options.maxAge === "number") str += `; Max-Age=${options.maxAge}`;
  if (options.expires) {
    const d =
      options.expires instanceof Date
        ? options.expires
        : new Date(options.expires);
    str += `; Expires=${d.toUTCString()}`;
  }
  return str;
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return getAllBrowserCookies();
        },
        setAll(cookiesToSet) {
          if (typeof document === "undefined") return;
          for (const { name, value, options } of cookiesToSet) {
            const opts = toSessionCookieOptions(options);
            document.cookie = serializeBrowserCookie(name, value, opts);
          }
        },
      },
    }
  );
}
