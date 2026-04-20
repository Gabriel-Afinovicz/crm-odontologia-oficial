import { createClient } from "@/lib/supabase/server";

/**
 * Verifies that the current session user is a super_admin.
 * Returns the user record on success, or throws.
 */
export async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("UNAUTHORIZED");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("id, role")
    .eq("auth_id", user.id)
    .single();

  const record = profile as { id: string; role: string } | null;

  if (!record || record.role !== "super_admin") {
    throw new Error("FORBIDDEN");
  }

  return { userId: record.id, authId: user.id };
}
