import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Admin client using the service_role key.
 *
 * IMPORTANT: Only use inside route handlers or server actions that have
 * already validated the caller is a super_admin. Never expose the
 * service_role key to the browser.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in the environment. Add it to
 * .env.local (copy it from Supabase dashboard → Settings → API).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Supabase admin client missing env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."
    );
  }

  return createSupabaseClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
