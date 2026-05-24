import Link from "next/link";
import {
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  CreditCard,
  ReceiptText,
  ShieldCheck,
  Send,
  Upload
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { currency, initials } from "@/lib/utils";

type DashboardBill = {
  id: string;
  utility_provider?: string | null;
  amount?: number | string | null;
  due_date?: string | null;
  billing_period?: string | null;
  split_mode?: string | null;
  status?: string | null;
  proof_path?: string | null;
};

export default async function DashboardPage() {
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
  const user = auth.user;
  if (!user) return null;

  const { data: households } = await supabase.from("households").select("id,name").order("created_at", { ascending: true }).limit(1);
  const household = households?.[0] ?? null;

  const householdId = household?.id;
  const { data: members } = householdId
    ? await supabase.from("household_members").select("id,email,name,display_name,split_weight").eq("household_id", householdId)
    : { data: null };

  const { data: requests } = householdId
    ? await supabase
        .from("payment_requests")
        .select("member_id,user_share,status,due_date")
        .in("status", ["pending", "overdue"])
        .limit(500)
    : { data: null };

  const unpaid = (requests ?? []).reduce((sum, request) => sum + Number(request.user_share), 0);
  const openRequests = (requests ?? []).length;

  const bills = householdId ? await getBillsWithFallback(supabase, householdId) : null;
  const upcoming = (bills ?? []).filter((bill) => bill.status !== "paid").length;

  const { data: paymentAccounts } = householdId
    ? await supabase.from("payment_accounts").select("provider,handle,is_enabled").eq("household_id", householdId).order("provider", { ascending: true })
    : { data: null };

  return (
    <div className="space-y-5 pb-24 md:pb-0 lg:space-y-6">
      <section className="overflow-hidden rounded-[1.75rem] border bg-card/80 p-5 shadow-soft backdrop-blur sm:p-7">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <Badge className="mb-4 border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-slate-200">
            {household ? household.name : "No household"}
          </Badge>
          <h1 className="max-w-2xl text-3xl font-semibold tracking-[-0.02em] sm:text-5xl">
            Utilities, split clean.
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
            Upload bills, extract totals, split fairly, and send roommates clear payment links.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border bg-background/70 px-3 py-1">OCR proof</span>
            <span className="rounded-full border bg-background/70 px-3 py-1">Weighted splits</span>
            <span className="rounded-full border bg-background/70 px-3 py-1">Auto reminders</span>
          </div>
        </div>
        <Button asChild size="lg" variant="dark">
          <Link href="/bills/new">
            <Upload className="h-4 w-4" />
            Upload bill
          </Link>
        </Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Metric title="Unpaid balance" value={currency(unpaid)} icon={CircleDollarSign} tone="blue" />
        <Metric title="Upcoming bills" value={String(upcoming)} icon={CalendarClock} tone="amber" />
        <Metric title="Payment requests" value={String(openRequests)} icon={Send} tone="emerald" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Roommate balances</CardTitle>
              <p className="text-sm text-muted-foreground">Weighted split supported per bill.</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/households">Manage</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {(members ?? []).map((member) => {
              const label = member.display_name || member.name || member.email;
              const memberBalance = (requests ?? [])
                .filter((r) => r.member_id === member.id)
                .reduce((sum, r) => sum + Number(r.user_share), 0);
              const status = memberBalance > 0 ? "unpaid" : "paid";

              return (
                <div
                  key={member.id}
                  className="group flex items-center justify-between rounded-2xl border bg-background/70 p-3.5 transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-background hover:shadow-sm dark:hover:border-white/20"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white shadow-sm dark:bg-white dark:text-slate-950">
                      {initials(label)}
                    </div>
                    <div>
                      <p className="font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground">Split weight {Number(member.split_weight)}x</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{currency(memberBalance)}</p>
                    <p className={status === "paid" ? "text-xs text-emerald-600" : "text-xs text-amber-600"}>
                      {status}
                    </p>
                  </div>
                </div>
              );
            })}

            {!members?.length ? (
              <p className="rounded-2xl border bg-muted/40 p-4 text-sm text-muted-foreground">
                No household members yet. Go to Household to add roommates.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Cash flow</CardTitle>
                <p className="text-sm text-muted-foreground">Upcoming household spend.</p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/payments">Requests</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="h-40 rounded-2xl border bg-gradient-to-b from-slate-50 to-white p-4 dark:from-white/10 dark:to-transparent">
              <div className="flex h-full items-end gap-2">
                {[36, 62, 44, 78, 55, 92, 68].map((height, index) => (
                  <div key={index} className="flex h-full flex-1 items-end">
                    <div
                      className="w-full rounded-t-lg bg-slate-950/85 transition hover:bg-slate-700 dark:bg-white/80"
                      style={{ height: `${height}%` }}
                    />
                  </div>
                ))}
              </div>
            </div>
            {(paymentAccounts ?? []).map((account) => (
              <div key={account.provider} className="flex items-center justify-between rounded-xl border bg-background/70 p-3">
                <div>
                  <p className="text-sm font-medium">{account.provider}</p>
                  <p className="truncate text-xs text-muted-foreground">{account.handle}</p>
                </div>
                <CreditCard className="h-4 w-4 text-muted-foreground" />
              </div>
            ))}
            {!paymentAccounts?.length ? (
              <p className="rounded-2xl border bg-muted/40 p-4 text-sm text-muted-foreground">
                Add payment accounts in Household to enable fast pay links.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Bill activity</CardTitle>
          <p className="text-sm text-muted-foreground">Proof visible to all household members.</p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!bills?.length ? (
            <div className="rounded-2xl border bg-muted/30 p-6 text-sm text-muted-foreground">
              No bills yet. Upload first utility bill to start splits, requests, forecasts.
            </div>
          ) : null}
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr className="border-b">
                <th className="pb-3">Provider</th>
                <th className="pb-3">Amount</th>
                <th className="pb-3">Due</th>
                <th className="pb-3">Period</th>
                <th className="pb-3">Split</th>
                <th className="pb-3">Status</th>
                <th className="pb-3">Proof</th>
              </tr>
            </thead>
            <tbody>
              {(bills ?? []).map((bill) => (
                <tr key={bill.id} className="border-b transition hover:bg-muted/35 last:border-0">
                  <td className="py-4 font-medium">{bill.utility_provider}</td>
                  <td className="py-4">{currency(Number(bill.amount))}</td>
                  <td className="py-4">{bill.due_date ?? "-"}</td>
                  <td className="py-4">{bill.billing_period ?? "-"}</td>
                  <td className="py-4">{bill.split_mode ?? "-"}</td>
                  <td className="py-4">
                    <Badge className={bill.status === "paid" ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40" : "border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950/40"}>
                      {bill.status === "paid" ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <Clock3 className="mr-1 h-3 w-3" />}
                      {bill.status ?? "scheduled"}
                    </Badge>
                  </td>
                  <td className="py-4 text-muted-foreground">{bill.proof_path ? "attached" : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

async function getBillsWithFallback(
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  householdId: string
): Promise<DashboardBill[] | null> {
  const columns = ["id", "utility_provider", "amount", "due_date", "billing_period", "split_mode", "status", "proof_path"];

  while (columns.length) {
    const { data, error } = await supabase
      .from("bills")
      .select(columns.join(","))
      .eq("household_id", householdId)
      .order("created_at", { ascending: false })
      .limit(25);

    if (!error) return (data as unknown as DashboardBill[]) ?? [];

    const missingColumn = getMissingBillsColumn(error);
    if (!missingColumn) return null;

    const index = columns.indexOf(missingColumn);
    if (index === -1) return null;
    columns.splice(index, 1);
  }

  return null;
}

function getMissingBillsColumn(error: { message?: string; code?: string }) {
  const message = `${error.message ?? ""} ${error.code ?? ""}`;
  const match = message.match(/Could not find the '([^']+)' column of 'bills'/);
  return match?.[1] ?? null;
}

function Metric({
  title,
  value,
  icon: Icon,
  tone
}: {
  title: string;
  value: string;
  icon: typeof ReceiptText;
  tone: "blue" | "amber" | "emerald";
}) {
  const tones = {
    blue: "bg-slate-950 text-white dark:bg-white dark:text-slate-950",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200",
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
  };

  return (
    <Card className="transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="flex items-center justify-between p-5 sm:p-5">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <ShieldCheck className="hidden h-4 w-4 text-muted-foreground sm:block" />
        <ArrowUpRight className="h-4 w-4 text-muted-foreground sm:hidden" />
      </CardContent>
    </Card>
  );
}
