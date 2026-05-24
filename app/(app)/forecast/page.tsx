import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BellRing,
  Check,
  Mail,
  MessageSquare,
  Moon,
  Smartphone,
  Sparkles,
  TriangleAlert,
  Zap
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildSmartNotifications, forecastUtilities, type MonthlyUtilityCost, type NotificationPreference, type UtilityForecast, type UtilityKind } from "@/lib/forecasting";
import { createClient } from "@/lib/supabase/server";
import { currency } from "@/lib/utils";

export default async function ForecastPage() {
  const supabase = await createClient();
  if (!supabase) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connect Supabase</CardTitle>
          <p className="text-sm text-muted-foreground">Set Supabase env values to use app.</p>
        </CardHeader>
      </Card>
    );
  }

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data: households } = await supabase.from("households").select("id").order("created_at", { ascending: true }).limit(1);
  const householdId = households?.[0]?.id;

  const { data: rows } = householdId
    ? await supabase
        .from("utility_forecasts")
        .select("bill_type,previous_amount,forecast_month")
        .eq("household_id", householdId)
        .order("forecast_month", { ascending: true })
        .limit(36)
    : { data: null };

  const monthMap = new Map<string, MonthlyUtilityCost>();
  (rows ?? []).forEach((row) => {
    const monthLabel = new Date(row.forecast_month).toLocaleString("en-US", { month: "short" });
    if (!monthMap.has(monthLabel)) monthMap.set(monthLabel, { month: monthLabel, electric: 0, water: 0, garbage: 0, internet: 0 });
    const target = monthMap.get(monthLabel)!;
    target[row.bill_type as UtilityKind] = Number(row.previous_amount);
  });

  const history = Array.from(monthMap.values()).slice(-6);
  const hasHistory = history.length >= 4 && history.some((h) => Object.values(h).some((v) => typeof v === "number" && v > 0));

  const forecasts = hasHistory ? forecastUtilities(history) : [];
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

  const notifications = forecasts.length ? buildSmartNotifications(forecasts, preferences) : [];
  const electric = forecasts.find((forecast) => forecast.kind === "electric");

  return (
    <div className="space-y-5 pb-28 md:pb-0">
      <section className="rounded-[2rem] border bg-slate-950 p-5 text-white shadow-soft sm:p-7 dark:bg-white dark:text-slate-950">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Badge className="border-white/15 bg-white/10 text-white dark:border-slate-200 dark:bg-slate-950/5 dark:text-slate-700">
              AI forecast
            </Badge>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.03em] sm:text-5xl">
              {electric ? `${electric.label} may increase ${electric.percentChange}% next month.` : "Forecast starts after bills."}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70 dark:text-slate-600">
              {electric ? `${electric.reason} Forecast uses bill history, seasonality, spike checks.` : "Upload bills and generate forecasts to unlock trends and suggestions."}
            </p>
          </div>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 dark:bg-slate-950/10">
            <Sparkles className="h-6 w-6" />
          </span>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_0.75fr]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Trends over time</CardTitle>
            <p className="text-sm text-muted-foreground">Monthly comparisons by utility.</p>
          </CardHeader>
          <CardContent>
            {hasHistory ? <TrendChart history={history} /> : <EmptyCard text="No utility history yet. Upload bills and store forecasts." />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Savings suggestions</CardTitle>
            <p className="text-sm text-muted-foreground">Generated from forecast variance.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {forecasts.map((forecast) => (
              <div key={forecast.kind} className="rounded-2xl border bg-background/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{forecast.label}</p>
                  <TrendBadge forecast={forecast} />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{forecast.suggestion}</p>
              </div>
            ))}
            {!forecasts.length ? <EmptyCard text="No forecasts yet. Create household, upload bills, run forecasting." /> : null}
          </CardContent>
        </Card>
      </section>

      <section className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        <div className="flex snap-x gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-4">
          {forecasts.map((forecast) => (
            <UtilityCard key={forecast.kind} forecast={forecast} />
          ))}
          {!forecasts.length ? (
            <Card className="min-w-[78vw] snap-center sm:min-w-0">
              <CardContent className="p-5">
                <p className="font-semibold">No forecast cards yet</p>
                <p className="mt-2 text-sm text-muted-foreground">Upload bills and generate forecasts.</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BellRing className="h-5 w-5" />
              Smart notifications
            </CardTitle>
            <p className="text-sm text-muted-foreground">Upcoming bills, overdue balances, paid shares, unusual spikes.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {notifications.map((notification) => (
              <div key={notification.id} className="flex gap-3 rounded-2xl border bg-background/70 p-3">
                <span className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${notification.priority === "high" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700"}`}>
                  {notification.priority === "high" ? <TriangleAlert className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{notification.title}</p>
                    <Badge>{notification.channel}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Scheduled {notification.scheduledFor}</p>
                </div>
              </div>
            ))}
            {!notifications.length ? <EmptyCard text="No notifications queued yet. Enable preferences and add bills/requests." /> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notification preferences</CardTitle>
            <p className="text-sm text-muted-foreground">Quiet hours and delivery channels.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <Channel enabled icon={Mail} label="Email" />
              <Channel icon={MessageSquare} label="SMS" />
              <Channel enabled icon={Smartphone} label="Push" />
            </div>
            <div className="rounded-2xl border bg-background/70 p-4">
              <div className="flex items-center gap-2">
                <Moon className="h-4 w-4" />
                <p className="font-medium">Quiet hours</p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {preferences.quietHours.start} - {preferences.quietHours.end}. High-priority overdue alerts wait until morning.
              </p>
            </div>
            <div className="space-y-2">
              {["Upcoming bills", "Overdue balances", "Completed payments", "Unusual bill spikes"].map((item) => (
                <div key={item} className="flex min-h-12 items-center justify-between rounded-2xl border bg-background/70 px-4">
                  <span className="text-sm">{item}</span>
                  <span className="flex h-6 w-10 items-center justify-end rounded-full bg-slate-950 p-1 dark:bg-white">
                    <span className="h-4 w-4 rounded-full bg-white dark:bg-slate-950" />
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <div className="fixed inset-x-4 bottom-24 z-30 md:hidden">
        <Button className="min-h-14 w-full rounded-2xl shadow-soft" variant="dark">
          <Zap className="h-5 w-5" />
          Fast pay highest balance
        </Button>
      </div>
    </div>
  );
}

function UtilityCard({ forecast }: { forecast: UtilityForecast }) {
  return (
    <Card className="min-w-[78vw] snap-center sm:min-w-0">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="font-semibold">{forecast.label}</p>
          <TrendBadge forecast={forecast} />
        </div>
        <p className="mt-5 text-3xl font-semibold">{currency(forecast.predictedAmount)}</p>
        <p className="mt-1 text-sm text-muted-foreground">Next month forecast</p>
        <div className="mt-4 flex items-center justify-between rounded-2xl border bg-background/70 p-3 text-sm">
          <span className="text-muted-foreground">This month</span>
          <span className="font-medium">{currency(forecast.lastAmount)}</span>
        </div>
        {forecast.spike ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-red-600">
            <TriangleAlert className="h-4 w-4" />
            Abnormal spike detected
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TrendBadge({ forecast }: { forecast: UtilityForecast }) {
  const Icon = forecast.trend === "up" ? ArrowUpRight : forecast.trend === "down" ? ArrowDownRight : ArrowRight;
  const color = forecast.trend === "up" ? "text-red-700 bg-red-50 border-red-200" : forecast.trend === "down" ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-slate-700 bg-slate-50 border-slate-200";

  return (
    <Badge className={color}>
      <Icon className="mr-1 h-3 w-3" />
      {forecast.percentChange > 0 ? "+" : ""}{forecast.percentChange}%
    </Badge>
  );
}

function Channel({ enabled, icon: Icon, label }: { enabled?: boolean; icon: typeof Mail; label: string }) {
  return (
    <div className={`rounded-2xl border p-3 text-center ${enabled ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950" : "bg-background/70 text-muted-foreground"}`}>
      <Icon className="mx-auto h-5 w-5" />
      <p className="mt-2 text-xs font-medium">{label}</p>
      {enabled ? <Check className="mx-auto mt-1 h-3 w-3" /> : null}
    </div>
  );
}

function TrendChart({ history }: { history: MonthlyUtilityCost[] }) {
  const max = Math.max(...history.flatMap((month) => [month.electric, month.water, month.garbage, month.internet]));
  const points = history.map((month, index) => {
    const x = 20 + index * 70;
    const y = 170 - (month.electric / max) * 135;
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="rounded-3xl border bg-gradient-to-b from-slate-50 to-white p-4 dark:from-white/10 dark:to-transparent">
      <svg viewBox="0 0 320 190" className="h-56 w-full">
        {[40, 80, 120, 160].map((y) => (
          <line key={y} x1="12" x2="308" y1={y} y2={y} stroke="currentColor" className="text-slate-200 dark:text-white/10" />
        ))}
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="text-slate-950 dark:text-white" />
        {history.map((month, index) => (
          <g key={month.month}>
            <circle cx={20 + index * 70} cy={170 - (month.electric / max) * 135} r="5" className="fill-white stroke-slate-950 dark:fill-slate-950 dark:stroke-white" strokeWidth="3" />
            <text x={20 + index * 70} y="186" textAnchor="middle" className="fill-slate-500 text-[10px]">{month.month}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function EmptyCard({ text }: { text: string }) {
  return <div className="rounded-2xl border bg-muted/30 p-6 text-sm text-muted-foreground">{text}</div>;
}
