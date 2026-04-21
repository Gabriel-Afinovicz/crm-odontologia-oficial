import { createClient } from "@/lib/supabase/server";

/**
 * Ensures the current session user can manage the given clinic (`domain`).
 *
 * - `admin`: only their own company.
 * - `super_admin`: any domain.
 *
 * Throws "UNAUTHORIZED" when there is no session, "FORBIDDEN" when the role
 * or company does not match, and "NOT_FOUND" when the domain does not exist.
 */
export async function requireAdminForDomain(domain: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("UNAUTHORIZED");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("id, role, company_id")
    .eq("auth_id", user.id)
    .single();

  const record = profile as
    | { id: string; role: string; company_id: string }
    | null;

  if (!record) {
    throw new Error("UNAUTHORIZED");
  }

  if (record.role !== "admin" && record.role !== "super_admin") {
    throw new Error("FORBIDDEN");
  }

  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("domain", domain)
    .single();

  const companyRecord = company as { id: string } | null;

  if (!companyRecord) {
    throw new Error("NOT_FOUND");
  }

  if (record.role === "admin" && record.company_id !== companyRecord.id) {
    throw new Error("FORBIDDEN");
  }

  return {
    userId: record.id,
    authId: user.id,
    role: record.role as "admin" | "super_admin",
    companyId: companyRecord.id,
  };
}
