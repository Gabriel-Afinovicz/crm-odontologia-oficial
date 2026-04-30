import type { Metadata, Viewport } from "next";
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

export const metadata: Metadata = {
  title: "Confirmação de consulta",
  description: "Confirme sua consulta de forma rápida e segura.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#2563eb",
};

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
    <div className="flex min-h-[100dvh] flex-col items-center justify-start bg-gradient-to-br from-blue-50 via-white to-emerald-50 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:items-center sm:justify-center sm:py-10">
      <ConfirmationView domain={domain} token={token} initial={row} />
    </div>
  );
}
