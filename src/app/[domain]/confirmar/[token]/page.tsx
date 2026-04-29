import { createClient } from "@/lib/supabase/server";
import { ConfirmationView } from "./confirmation-view";

interface ConfirmationPageProps {
  params: Promise<{ domain: string; token: string }>;
}

interface ConfirmationLookup {
  appointment_id: string;
  status: "pending" | "confirmed" | "reschedule_requested" | "expired";
  starts_at: string;
  ends_at: string;
  patient_name: string;
  dentist_name: string | null;
  clinic_name: string;
}

export default async function ConfirmationPage({
  params,
}: ConfirmationPageProps) {
  const { domain, token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("confirmation_lookup", {
    p_domain: domain,
    p_token: token,
  });

  const row = (data as ConfirmationLookup[] | null)?.[0] ?? null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-white to-emerald-50 px-4 py-10">
      <ConfirmationView domain={domain} token={token} initial={row} />
    </div>
  );
}
