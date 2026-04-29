import { NextResponse, type NextRequest } from "next/server";
import { getAuthSession } from "@/lib/supabase/cached-data";
import { getAnalyticsDashboard, type AnalyticsPeriod } from "@/lib/supabase/dashboard-data";

const VALID_PERIODS: AnalyticsPeriod[] = ["today", "7d", "30d", "month"];

export async function GET(req: NextRequest) {
  const { user } = await getAuthSession();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  const period = searchParams.get("period") as AnalyticsPeriod | null;

  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const safePeriod: AnalyticsPeriod =
    period && VALID_PERIODS.includes(period) ? period : "30d";

  const data = await getAnalyticsDashboard(companyId, safePeriod);
  return NextResponse.json(data);
}
