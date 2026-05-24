import { NextResponse } from "next/server";
import { buildSmartNotifications, forecastUtilities, type NotificationPreference, type MonthlyUtilityCost, type UtilityKind } from "@/lib/forecasting";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase env missing" }, { status: 400 });

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: households } = await supabase.from("households").select("id").order("created_at", { ascending: true }).limit(1);
  const householdId = households?.[0]?.id;
  if (!householdId) return NextResponse.json({ error: "No household" }, { status: 400 });

  const { data: forecastRows } = await supabase
    .from("utility_forecasts")
    .select("bill_type,predicted_amount,previous_amount,percent_change,is_spike,reason,suggestion,forecast_month")
    .eq("household_id", householdId)
    .order("forecast_month", { ascending: true })
    .limit(24);

  // If no stored forecasts, require bill history before computing.
  if (!forecastRows?.length) {
    return NextResponse.json({ error: "No forecast data yet. Upload bills first." }, { status: 404 });
  }

  // Convert to simple monthly history for electric/water/garbage/internet where available.
  const monthMap = new Map<string, MonthlyUtilityCost>();
  forecastRows.forEach((row) => {
    const monthLabel = new Date(row.forecast_month).toLocaleString("en-US", { month: "short" });
    if (!monthMap.has(monthLabel)) {
      monthMap.set(monthLabel, { month: monthLabel, electric: 0, water: 0, garbage: 0, internet: 0 });
    }
    const target = monthMap.get(monthLabel)!;
    target[row.bill_type as UtilityKind] = Number(row.previous_amount);
  });

  const history = Array.from(monthMap.values()).slice(-6);
  const forecasts = forecastUtilities(history.length ? history : [{ month: "Now", electric: 0, water: 0, garbage: 0, internet: 0 }]);

  const preferences: NotificationPreference = {
    channels: { email: true, sms: false, push: true },
    quietHours: { start: "21:00", end: "08:00" },
    reminders: {
      upcomingBills: true,
      overdueBalances: true,
      completedPayments: true,
      unusualSpikes: true
    }
  };

  return NextResponse.json({
    forecasts,
    notifications: buildSmartNotifications(forecasts, preferences)
  });
}
