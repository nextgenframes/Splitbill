import Link from "next/link";
import {
  BellRing,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  History,
  ReceiptText,
  Send,
  TriangleAlert
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildPaymentLink, getRequestStatus, type PaymentRequestStatus } from "@/lib/payment-requests";
import { createClient } from "@/lib/supabase/server";
import { currency } from "@/lib/utils";

const statusStyles: Record<PaymentRequestStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950/40",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40",
  overdue: "border-red-200 bg-red-50 text-red-700 dark:bg-red-950/40"
};

export default async function PaymentsPage() {
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

  const { data: requests } = householdId
    ? await supabase
        .from("payment_requests")
        .select("id,member_id,utility_name,total_bill,user_share,due_date,proof_path,provider,payment_target,payment_url,zelle_instructions,status,last_reminder_at,paid_at,created_at")
        .order("created_at", { ascending: false })
        .limit(200)
    : { data: null };

  const { data: members } = householdId
    ? await supabase.from("household_members").select("id,email,display_name").eq("household_id", householdId)
    : { data: null };

  const normalized =
    (requests ?? []).map((request) => ({
      id: request.id,
      roommate: (members ?? []).find((m) => m.id === request.member_id)?.display_name || (members ?? []).find((m) => m.id === request.member_id)?.email || "Member",
      utilityName: request.utility_name,
      totalBill: Number(request.total_bill),
      userShare: Number(request.user_share),
      dueDate: request.due_date ?? "",
      proofLabel: request.proof_path ? request.proof_path.split("/").at(-1) ?? "proof" : "proof",
      proofUrl: "#",
      status: getRequestStatus({ ...request, status: request.status } as any),
      paymentRail: request.provider === "cash_app" ? ("Cash App" as const) : request.provider === "paypal" ? ("PayPal" as const) : request.provider === "venmo" ? ("Venmo" as const) : ("Zelle" as const),
      paymentTarget: request.payment_target,
      lastReminderAt: request.last_reminder_at ? new Date(request.last_reminder_at).toISOString().slice(0, 10) : undefined
    })) ?? [];

  const pendingTotal = normalized
    .filter((request) => request.status !== "paid")
    .reduce((sum, request) => sum + request.userShare, 0);
  const overdueCount = normalized.filter((request) => request.status === "overdue").length;

  const { data: reminderEvents } = householdId
    ? await supabase
        .from("reminder_events")
        .select("id,scheduled_for,sent_at,status,member_id,payment_request_id")
        .order("created_at", { ascending: false })
        .limit(50)
    : { data: null };

  const { data: history } = householdId
    ? await supabase
        .from("payment_history")
        .select("id,amount,provider,paid_at,member_id,payment_request_id")
        .order("paid_at", { ascending: false })
        .limit(50)
    : { data: null };

  return (
    <div className="space-y-5 pb-24 md:pb-0">
      <section className="grid gap-4 md:grid-cols-3">
        <Summary title="Open requests" value={String(normalized.filter((request) => request.status !== "paid").length)} icon={Send} />
        <Summary title="Pending amount" value={currency(pendingTotal)} icon={ReceiptText} />
        <Summary title="Overdue" value={String(overdueCount)} icon={TriangleAlert} />
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <Card>
          <CardHeader>
            <Badge className="w-fit border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-slate-200">
              Payment requests
            </Badge>
            <CardTitle className="text-2xl tracking-[-0.02em]">Roommate shares</CardTitle>
            <p className="text-sm text-muted-foreground">
              Each request includes bill proof, due date, user share, and payment options.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {!normalized.length ? (
              <div className="rounded-2xl border bg-muted/30 p-6 text-sm text-muted-foreground">
                No payment requests yet. Upload bill, create splits, generate requests.
              </div>
            ) : null}
            {normalized.map((request) => (
              <div
                key={request.id}
                className="rounded-2xl border bg-background/70 p-4 transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-background hover:shadow-sm dark:hover:border-white/20"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{request.roommate}</p>
                      <StatusBadge status={request.status} />
                    </div>
                    <p className="text-sm text-muted-foreground">{request.utilityName}</p>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span className="rounded-full border bg-card px-2.5 py-1">Total {currency(request.totalBill)}</span>
                      <span className="rounded-full border bg-card px-2.5 py-1">Share {currency(request.userShare)}</span>
                      <span className="rounded-full border bg-card px-2.5 py-1">Due {request.dueDate}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={request.proofUrl}>
                        <FileText className="h-4 w-4" />
                        {request.proofLabel}
                      </Link>
                    </Button>
                    {request.paymentRail === "Zelle" ? (
                      <Button variant="dark" size="sm">
                        <ExternalLink className="h-4 w-4" />
                        Zelle instructions
                      </Button>
                    ) : (
                      <Button asChild variant="dark" size="sm">
                        <Link href={buildPaymentLink(request)} target="_blank">
                          <ExternalLink className="h-4 w-4" />
                          Pay via {request.paymentRail}
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid gap-2 rounded-2xl border bg-card/70 p-3 text-sm sm:grid-cols-3">
                  <p>
                    <span className="text-muted-foreground">Payment rail</span>
                    <br />
                    {request.paymentRail}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Target</span>
                    <br />
                    {request.paymentTarget}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Reminder</span>
                    <br />
                    {request.lastReminderAt ?? "Not sent"}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BellRing className="h-5 w-5" />
                Automatic reminders
              </CardTitle>
              <p className="text-sm text-muted-foreground">Scheduled before due date and after overdue.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {(reminderEvents ?? []).map((event) => {
                const roommate =
                  (members ?? []).find((m) => m.id === event.member_id)?.display_name ||
                  (members ?? []).find((m) => m.id === event.member_id)?.email ||
                  "Member";
                return (
                  <div key={event.id} className="rounded-2xl border bg-background/70 p-3">
                    <p className="text-sm font-medium">{roommate}</p>
                    <p className="mt-2 text-xs">{new Date(event.scheduled_for).toLocaleString()}</p>
                    <Badge className="mt-2">{event.status}</Badge>
                  </div>
                );
              })}
              {!reminderEvents?.length ? (
                <p className="rounded-2xl border bg-muted/40 p-4 text-sm text-muted-foreground">No reminders scheduled.</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Payment history
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(history ?? []).map((payment) => {
                const roommate =
                  (members ?? []).find((m) => m.id === payment.member_id)?.display_name ||
                  (members ?? []).find((m) => m.id === payment.member_id)?.email ||
                  "Member";
                const method = payment.provider === "cash_app" ? "Cash App" : payment.provider === "paypal" ? "PayPal" : payment.provider === "venmo" ? "Venmo" : "Zelle";
                return (
                  <div key={payment.id} className="flex items-center justify-between rounded-2xl border bg-background/70 p-3">
                    <div>
                      <p className="text-sm font-medium">{roommate}</p>
                      <p className="text-xs text-muted-foreground">{payment.payment_request_id}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{currency(Number(payment.amount))}</p>
                      <p className="text-xs text-muted-foreground">{method} · {new Date(payment.paid_at).toISOString().slice(0, 10)}</p>
                    </div>
                  </div>
                );
              })}
              {!history?.length ? (
                <p className="rounded-2xl border bg-muted/40 p-4 text-sm text-muted-foreground">No payment history yet.</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

function Summary({ title, value, icon: Icon }: { title: string; value: string; icon: typeof Send }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
          <Icon className="h-5 w-5" />
        </span>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: PaymentRequestStatus }) {
  const icon = status === "paid" ? CheckCircle2 : status === "overdue" ? TriangleAlert : Clock3;
  const Icon = icon;

  return (
    <Badge className={statusStyles[status]}>
      <Icon className="mr-1 h-3 w-3" />
      {status}
    </Badge>
  );
}
