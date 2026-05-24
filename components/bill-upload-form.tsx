"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileText, Loader2, Send, Sparkles, UploadCloud } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currency } from "@/lib/utils";

type ExtractedBill = {
  provider: string;
  billType: string;
  amount: string;
  dueDate: string;
  billingPeriod: string;
  serviceAddress: string;
};

const emptyBill: ExtractedBill = {
  provider: "",
  billType: "",
  amount: "",
  dueDate: "",
  billingPeriod: "",
  serviceAddress: ""
};

type ExtractionMeta = {
  confidence: number;
  needsManualReview: boolean;
  validationIssues: string[];
  source: string;
};

type MessageTone = "neutral" | "warning" | "error" | "success";

export function BillUploadForm({ members }: { members: { name: string; weight: number }[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [bill, setBill] = useState<ExtractedBill>(emptyBill);
  const [splitMode, setSplitMode] = useState<"equal" | "weighted">("equal");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<MessageTone>("neutral");
  const [meta, setMeta] = useState<ExtractionMeta | null>(null);

  const amount = Number(bill.amount || 0);
  const splits = useMemo(() => {
    if (!members.length) return [];
    const totalWeight = splitMode === "equal" ? members.length : members.reduce((sum, mate) => sum + mate.weight, 0);
    return members.map((mate) => {
      const weight = splitMode === "equal" ? 1 : mate.weight;
      return { name: mate.name, amount: totalWeight ? (amount * weight) / totalWeight : 0 };
    });
  }, [amount, splitMode, members]);

  async function runOcr() {
    if (!file) return;
    setLoading(true);
    setMessage("");
    setMessageTone("neutral");
    setMeta(null);

    const body = new FormData();
    body.append("file", file);

    const response = await fetch("/api/ocr", { method: "POST", body });
    const result = await response.json();

    if (response.ok) {
      setBill({
        provider: result.provider ?? "",
        billType: result.billType ?? "",
        amount: String(result.amount ?? ""),
        dueDate: result.dueDate ?? "",
        billingPeriod: result.billingPeriod ?? "",
        serviceAddress: result.serviceAddress ?? ""
      });
      setMeta({
        confidence: result.confidence?.overall ?? 0,
        needsManualReview: Boolean(result.needsManualReview),
        validationIssues: result.validationIssues ?? [],
        source: result.source ?? "vision"
      });
      setMessage(result.needsManualReview ? "Low confidence. Confirm fields manually before saving." : "Bill details extracted. Review before saving.");
      setMessageTone(result.needsManualReview ? "warning" : "success");
    } else {
      setMessage(result.error ?? "OCR failed. Enter details manually.");
      setMessageTone(result.fallback ? "warning" : "error");
    }

    setLoading(false);
  }

  async function saveBill() {
    if (!file) {
      setMessage("Choose bill proof first.");
      setMessageTone("error");
      return;
    }

    setSaving(true);
    setMessage("");
    setMessageTone("neutral");

    const body = new FormData();
    body.append("file", file);
    body.append("provider", bill.provider);
    body.append("billType", bill.billType);
    body.append("amount", bill.amount);
    body.append("dueDate", bill.dueDate);
    body.append("billingPeriod", bill.billingPeriod);
    body.append("serviceAddress", bill.serviceAddress);
    body.append("splitMode", splitMode);
    body.append("ocrMeta", JSON.stringify(meta ?? {}));

    try {
      const response = await fetch("/api/bills", { method: "POST", body });
      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error ?? "Bill save failed.");
        setMessageTone("error");
        return;
      }

      const warningMessage = Array.isArray(result.warnings) && result.warnings.length ? ` ${result.warnings.join(" ")}` : "";
      setMessage(`${result.message ?? "Bill saved."}${warningMessage}`);
      setMessageTone(Array.isArray(result.warnings) && result.warnings.length ? "warning" : "success");
      router.push(result.createdRequests ? "/payments" : "/dashboard");
      router.refresh();
    } catch {
      setMessage("Bill save failed.");
      setMessageTone("error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_0.78fr]">
      <Card>
        <CardHeader>
          <Badge className="w-fit border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-slate-200">
            New utility bill
          </Badge>
          <CardTitle className="text-2xl tracking-[-0.02em]">Upload proof and extract details</CardTitle>
          <p className="text-sm text-muted-foreground">
            PDF or image proof stays visible to every roommate.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <label className="group flex cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed bg-gradient-to-b from-slate-50 to-white p-8 text-center transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm dark:from-white/10 dark:to-transparent dark:hover:border-white/20">
            <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border bg-background shadow-sm transition group-hover:scale-105">
              <UploadCloud className="h-7 w-7 text-muted-foreground" />
            </span>
            <span className="font-medium">{file ? file.name : "Drop or choose utility bill"}</span>
            <span className="mt-1 text-sm text-muted-foreground">PDF, PNG, JPG up to 8MB</span>
            <Input
              type="file"
              className="hidden"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>

          <Button onClick={runOcr} disabled={!file || loading} variant="dark">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Extract with AI
          </Button>
          {message ? <ExtractionStatus message={message} meta={meta} tone={messageTone} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Utility provider" value={bill.provider} onChange={(provider) => setBill({ ...bill, provider })} />
            <Field label="Bill type" value={bill.billType} onChange={(billType) => setBill({ ...bill, billType })} placeholder="electric, water, garbage, internet" />
            <Field label="Amount" type="number" value={bill.amount} onChange={(amountValue) => setBill({ ...bill, amount: amountValue })} />
            <Field label="Due date" type="date" value={bill.dueDate} onChange={(dueDate) => setBill({ ...bill, dueDate })} />
            <Field label="Billing period" value={bill.billingPeriod} onChange={(billingPeriod) => setBill({ ...bill, billingPeriod })} />
            <Field label="Service address" value={bill.serviceAddress} onChange={(serviceAddress) => setBill({ ...bill, serviceAddress })} />
          </div>

          <div className="space-y-2">
            <Label>Split mode</Label>
            <div className="grid grid-cols-2 rounded-2xl border bg-muted p-1">
              {(["equal", "weighted"] as const).map((mode) => (
                <button
                  key={mode}
                  className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                    splitMode === mode ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setSplitMode(mode)}
                  type="button"
                >
                  {mode === "equal" ? "Equal split" : "Weighted split"}
                </button>
              ))}
            </div>
          </div>

          <Button className="w-full" size="lg" onClick={saveBill} disabled={!file || saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {saving ? "Saving bill..." : meta?.needsManualReview ? "Confirm and save bill" : "Save bill and send requests"}
          </Button>
        </CardContent>
      </Card>

      <Card className="lg:sticky lg:top-24 lg:self-start">
        <CardHeader>
          <CardTitle>Split preview</CardTitle>
          <p className="text-sm text-muted-foreground">Payment links attach after save.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-3xl bg-slate-950 p-5 text-white shadow-soft dark:bg-white dark:text-slate-950">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 dark:bg-slate-950/10">
                <FileText className="h-5 w-5" />
              </span>
              <p className="font-medium">{bill.provider || "Provider pending"}</p>
            </div>
            <p className="mt-5 text-3xl font-semibold">{currency(amount)}</p>
            <p className="mt-1 text-sm opacity-70">Due {bill.dueDate || "not set"}</p>
            <p className="mt-3 text-xs opacity-70">{bill.serviceAddress || "Service address pending"}</p>
          </div>

          {splits.map((split) => (
            <div key={split.name} className="flex items-center justify-between rounded-2xl border bg-background/70 p-3.5 transition hover:bg-background">
              <span className="text-sm font-medium">{split.name}</span>
              <span className="font-semibold">{currency(split.amount)}</span>
            </div>
          ))}
          {!members.length ? (
            <p className="rounded-2xl border bg-muted/40 p-4 text-sm text-muted-foreground">
              No household members loaded yet. Create household and add members to preview split.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function ExtractionStatus({ message, meta, tone }: { message: string; meta: ExtractionMeta | null; tone: MessageTone }) {
  const low = tone === "warning" || (!tone || tone === "neutral") && meta?.needsManualReview;
  const isError = tone === "error";
  const isSuccess = tone === "success";
  const wrapperClass = isError
    ? "border-red-200 bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-100"
    : low
      ? "border-amber-200 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
      : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100";
  const badgeClass = isError
    ? "border-red-200 bg-white/70 text-red-800"
    : low
      ? "border-amber-200 bg-white/70 text-amber-800"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return (
    <div className={`space-y-2 rounded-2xl border px-3 py-3 text-sm ${wrapperClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2">
          {isError || low ? <AlertTriangle className={`h-4 w-4 ${isError ? "text-red-600" : "text-amber-600"}`} /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
          {message}
        </p>
        {meta ? (
          <Badge className={badgeClass}>
            {Math.round(meta.confidence * 100)}% confidence
          </Badge>
        ) : null}
      </div>
      {meta?.source ? <p className="text-xs opacity-70">Source: {meta.source.replaceAll("_", " ")}</p> : null}
      {meta?.validationIssues.length ? (
        <ul className="space-y-1 text-xs opacity-80">
          {meta.validationIssues.map((issue) => (
            <li key={issue}>Confirm: {issue}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
