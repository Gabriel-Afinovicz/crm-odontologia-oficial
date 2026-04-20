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

  // Master panel route: /wosnicz/* is reserved for the super_admin
  if (domain === "wosnicz") {
    if (!user) {
      if (isProtectedRoute) {
        const url = request.nextUrl.clone();
        url.pathname = "/wosnicz";
        return NextResponse.redirect(url);
      }
      return supabaseResponse;
    }

    const { data: userRecord } = await supabase
      .from("users")
      .select("role, companies(domain)")
      .eq("auth_id", user.id)
      .single();

    const record = userRecord as {
      role: string | null;
      companies: { domain: string | null } | null;
    } | null;

    const isSuperAdmin = record?.role === "super_admin";

    if (!isSuperAdmin) {
      const userDomain = record?.companies?.domain;
      const url = request.nextUrl.clone();
      url.pathname = userDomain ? `/${userDomain}/dashboard` : "/";
      return NextResponse.redirect(url);
    }

    if (isLoginPage) {
      const url = request.nextUrl.clone();
      url.pathname = "/wosnicz/dashboard";
      return NextResponse.redirect(url);
    }

    return supabaseResponse;
  }

  if (isProtectedRoute && !user) {
    const url = request.nextUrl.clone();
    url.pathname = `/${domain}`;
    return NextResponse.redirect(url);
  }

  // Validate that authenticated user belongs to the domain in the URL.
  // Prevents cross-tenant access via direct URL manipulation.
  // Super admins are exempt and can access any domain.
  if (user && (isProtectedRoute || isLoginPage)) {
    const { data: userRecord } = await supabase
      .from("users")
      .select("role, companies(domain)")
      .eq("auth_id", user.id)
      .single();

    const record = userRecord as {
      role: string | null;
      companies: { domain: string | null } | null;
    } | null;

    const isSuperAdmin = record?.role === "super_admin";
    const userDomain = record?.companies?.domain;

    if (!isSuperAdmin && userDomain && userDomain !== domain) {
      const url = request.nextUrl.clone();
      url.pathname = `/${userDomain}/dashboard`;
      return NextResponse.redirect(url);
    }
  }

  if (isLoginPage && user) {
    const url = request.nextUrl.clone();
    url.pathname = `/${domain}/dashboard`;
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
