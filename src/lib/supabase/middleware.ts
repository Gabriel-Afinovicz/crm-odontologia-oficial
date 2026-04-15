import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
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
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Extract domain from the path: /[domain]/...
  const segments = pathname.split("/").filter(Boolean);
  const domain = segments[0];

  if (!domain) {
    return supabaseResponse;
  }

  const isLoginPage = segments.length === 1; // /[domain]
  const isProtectedRoute = segments.length > 1; // /[domain]/dashboard, etc.

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
