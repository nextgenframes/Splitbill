import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const providerPriority = ["venmo", "cash_app", "paypal", "zelle"] as const;
type InsertBillResult = { id: string };
type InsertSplitResult = { id: string; member_id: string; amount: number | string };

export async function POST(request: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase env missing" }, { status: 500 });

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Login required" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  const utilityProvider = String(form.get("provider") ?? "").trim();
  const billType = String(form.get("billType") ?? "").trim();
  const amount = Number(form.get("amount") ?? 0);
  const dueDate = String(form.get("dueDate") ?? "").trim();
  const billingPeriod = String(form.get("billingPeriod") ?? "").trim();
  const serviceAddress = String(form.get("serviceAddress") ?? "").trim();
  const splitMode = form.get("splitMode") === "weighted" ? "weighted" : "equal";
  const ocrMetaRaw = String(form.get("ocrMeta") ?? "{}");

  if (!(file instanceof File)) return NextResponse.json({ error: "Bill proof file required" }, { status: 400 });
  if (!utilityProvider) return NextResponse.json({ error: "Utility provider required" }, { status: 400 });
  if (!["electric", "water", "garbage", "internet"].includes(billType)) {
    return NextResponse.json({ error: "Bill type must be electric, water, garbage, or internet" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Bill amount must be greater than 0" }, { status: 400 });

  const { data: households, error: householdError } = await supabase
    .from("households")
    .select("id,owner_id")
    .order("created_at", { ascending: true })
    .limit(1);
  if (householdError) return NextResponse.json({ error: householdError.message }, { status: 400 });

  const household = households?.[0] ?? null;
  const householdId = household?.id;
  if (!householdId) return NextResponse.json({ error: "Create household first" }, { status: 400 });

  let { data: members, error: membersError } = await supabase
    .from("household_members")
    .select("id,email,name,display_name,split_weight,user_id,role")
    .eq("household_id", householdId)
    .order("created_at", { ascending: true });
  if (membersError) return NextResponse.json({ error: membersError.message }, { status: 400 });

  const signedInMember = (members ?? []).find((member) => member.user_id === auth.user.id);
  if (!signedInMember && household?.owner_id === auth.user.id) {
    const ownerName = auth.user.user_metadata?.full_name ?? auth.user.email ?? "Owner";
    const { error: repairError } = await supabase.from("household_members").insert({
      household_id: householdId,
      user_id: auth.user.id,
      email: auth.user.email ?? "unknown",
      name: ownerName,
      display_name: ownerName,
      role: "owner",
      split_weight: 1,
      joined_at: new Date().toISOString()
    });

    if (repairError && repairError.code !== "23505") {
      return NextResponse.json(
        {
          error:
            "Household owner is missing member access. Run supabase/migrations/2026-05-24_sync_household_schema.sql, then retry."
        },
        { status: 400 }
      );
    }

    const refresh = await supabase
      .from("household_members")
      .select("id,email,name,display_name,split_weight,user_id,role")
      .eq("household_id", householdId)
      .order("created_at", { ascending: true });
    members = refresh.data;
    membersError = refresh.error;
    if (membersError) return NextResponse.json({ error: membersError.message }, { status: 400 });
  }

  if (!members?.length) return NextResponse.json({ error: "Add household members first" }, { status: 400 });

  const warnings: string[] = [];
  const proofPath = `${householdId}/${randomUUID()}-${sanitizeFilename(file.name)}`;
  let savedProofPath: string | null = proofPath;
  const { error: uploadError } = await supabase.storage.from("bill-proofs").upload(proofPath, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "application/octet-stream"
  });
  if (uploadError) {
    if (isMissingBucket(uploadError)) {
      savedProofPath = null;
      warnings.push("Bill proof bucket missing. Bill saved without file attachment.");
    } else {
      return NextResponse.json({ error: uploadError.message }, { status: 400 });
    }
  }

  let parsedMeta: {
    confidence?: { overall?: number };
    needsManualReview?: boolean;
    validationIssues?: string[];
    source?: string;
  } = {};
  try {
    parsedMeta = JSON.parse(ocrMetaRaw || "{}");
  } catch {
    parsedMeta = {};
  }

  const billInsert = {
    household_id: householdId,
    uploaded_by: auth.user.id,
    utility_provider: utilityProvider,
    bill_type: billType,
    amount,
    due_date: dueDate || null,
    billing_period: billingPeriod || null,
    service_address: serviceAddress || null,
    split_mode: splitMode,
    status: "scheduled",
    proof_path: savedProofPath,
    ocr_confidence: parsedMeta.confidence?.overall ?? 0,
    needs_manual_review: parsedMeta.needsManualReview ?? true,
    ocr_payload: parsedMeta
  };

  const billResult = await insertWithSchemaFallback(supabase, "bills", billInsert, ["id"]);
  if (billResult.error) {
    if (isBillsRlsError(billResult.error)) {
      return NextResponse.json(
        {
          error:
            "Supabase RLS blocked bill save. Run supabase/migrations/2026-05-24_sync_household_schema.sql and supabase/migrations/2026-05-24_sync_billing_schema.sql, then retry."
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: billResult.error.message }, { status: 400 });
  }
  const bill = billResult.data as unknown as InsertBillResult;
  if (billResult.removedColumns.length) {
    warnings.push(`Bills table missing columns: ${billResult.removedColumns.join(", ")}. Saved with reduced schema.`);
  }

  const totalWeight =
    splitMode === "equal" ? members.length : members.reduce((sum, member) => sum + Number(member.split_weight || 1), 0);

  const splitRows = members.map((member, index) => {
    const weight = splitMode === "equal" ? 1 : Number(member.split_weight || 1);
    const rawAmount = totalWeight ? (amount * weight) / totalWeight : 0;
    const roundedAmount =
      index === members.length - 1
        ? roundMoney(amount - members.slice(0, index).reduce((sum, prev) => sum + roundMoney(totalWeight ? (amount * (splitMode === "equal" ? 1 : Number(prev.split_weight || 1))) / totalWeight : 0), 0))
        : roundMoney(rawAmount);
    return {
      bill_id: bill.id,
      member_id: member.id,
      amount: roundedAmount,
      status: "unpaid" as const
    };
  });

  const splitsResult = await insertManyWithSchemaFallback(supabase, "bill_splits", splitRows, ["id", "member_id", "amount"]);
  if (splitsResult.error) return NextResponse.json({ error: splitsResult.error.message }, { status: 400 });
  const splits = (splitsResult.data as unknown as InsertSplitResult[] | null) ?? [];
  if (splitsResult.removedColumns.length) {
    warnings.push(`Bill splits table missing columns: ${splitsResult.removedColumns.join(", ")}. Saved with reduced schema.`);
  }

  let accounts:
    | {
        provider: (typeof providerPriority)[number];
        handle: string;
        is_enabled: boolean;
      }[]
    | null = null;

  const { data: paymentAccounts, error: accountsError } = await supabase
    .from("payment_accounts")
    .select("provider,handle,is_enabled")
    .eq("household_id", householdId)
    .eq("is_enabled", true)
    .order("created_at", { ascending: true });

  if (accountsError) {
    if (isMissingSchemaTable(accountsError, "payment_accounts")) {
      warnings.push("Payment accounts table missing. Bill saved without payment requests.");
      accounts = [];
    } else {
      return NextResponse.json({ error: accountsError.message }, { status: 400 });
    }
  } else {
    accounts = paymentAccounts;
  }

  const defaultAccount =
    providerPriority
      .map((provider) => accounts?.find((account) => account.provider === provider))
      .find(Boolean) ?? null;

  let createdRequests = 0;
  if (defaultAccount) {
    const requestRows = splits.map((split) => ({
      bill_id: bill.id,
      split_id: split.id,
      member_id: split.member_id,
      utility_name: utilityProvider,
      total_bill: amount,
      user_share: Number(split.amount),
      due_date: dueDate || null,
      proof_path: savedProofPath,
      provider: defaultAccount.provider,
      payment_target: defaultAccount.handle,
      payment_url: null,
      zelle_instructions:
        defaultAccount.provider === "zelle" ? `Send to ${defaultAccount.handle} with note ${utilityProvider} ${dueDate || ""}`.trim() : null,
      status: "pending" as const
    }));

    const { data: requests, error: requestError } = await supabase
      .from("payment_requests")
      .insert(requestRows)
      .select("id,member_id");
    if (requestError) {
      if (isMissingSchemaTable(requestError, "payment_requests")) {
        warnings.push("Payment requests table missing. Bill saved without roommate payment requests.");
      } else {
        return NextResponse.json({ error: requestError.message }, { status: 400 });
      }
    }

    createdRequests = requests?.length ?? 0;

    if (dueDate && requests?.length) {
      const reminderRows = requests.flatMap((paymentRequest) =>
        [-3, 0, 2].map((offset) => ({
          payment_request_id: paymentRequest.id,
          member_id: paymentRequest.member_id,
          scheduled_for: shiftDueDate(dueDate, offset),
          status: "scheduled"
        }))
      );
      const { error: reminderError } = await supabase.from("reminder_events").insert(reminderRows);
      if (reminderError && !isMissingSchemaTable(reminderError, "reminder_events")) {
        return NextResponse.json({ error: reminderError.message }, { status: 400 });
      }
      if (reminderError) warnings.push("Reminder events table missing. Bill saved without reminders.");
    }
  }

  return NextResponse.json({
    ok: true,
    billId: bill.id,
    proofPath: savedProofPath,
    createdRequests,
    warnings,
    message: createdRequests
      ? "Bill saved and payment requests created."
      : "Bill saved. Add payment accounts to create payment requests."
  });
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function shiftDueDate(isoDate: string, offsetDays: number) {
  const base = new Date(`${isoDate}T09:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString();
}

function isMissingSchemaTable(error: { message?: string; code?: string }, table: string) {
  const message = `${error.message ?? ""} ${error.code ?? ""}`;
  return message.includes("schema cache") && message.includes(table);
}

function isMissingBucket(error: { message?: string; code?: string }) {
  const message = `${error.message ?? ""} ${error.code ?? ""}`.toLowerCase();
  return message.includes("bucket not found") || message.includes("bucket") && message.includes("not found");
}

function isBillsRlsError(error: { message?: string; code?: string }) {
  const message = `${error.message ?? ""} ${error.code ?? ""}`.toLowerCase();
  return message.includes("row-level security") && message.includes("bills");
}

function getMissingColumn(error: { message?: string; code?: string }, relation: string) {
  const message = `${error.message ?? ""} ${error.code ?? ""}`;
  const match = message.match(new RegExp(`Could not find the '([^']+)' column of '${relation}'`));
  return match?.[1] ?? null;
}

async function insertWithSchemaFallback(
  supabase: Awaited<ReturnType<typeof createClient>>,
  relation: string,
  payload: Record<string, unknown>,
  selectColumns: string[]
) {
  if (!supabase) return { data: null, error: new Error("Supabase env missing"), removedColumns: [] as string[] };

  const workingPayload = { ...payload };
  const removedColumns: string[] = [];

  while (true) {
    const result = await supabase.from(relation).insert(workingPayload).select(selectColumns.join(",")).single();
    if (!result.error) return { data: result.data, error: null, removedColumns };

    const missingColumn = getMissingColumn(result.error, relation);
    if (!missingColumn || !(missingColumn in workingPayload)) {
      return { data: null, error: result.error, removedColumns };
    }

    delete workingPayload[missingColumn];
    removedColumns.push(missingColumn);
  }
}

async function insertManyWithSchemaFallback(
  supabase: Awaited<ReturnType<typeof createClient>>,
  relation: string,
  rows: Record<string, unknown>[],
  selectColumns: string[]
) {
  if (!supabase) return { data: null, error: new Error("Supabase env missing"), removedColumns: [] as string[] };

  let workingRows = rows.map((row) => ({ ...row }));
  const removedColumns: string[] = [];

  while (true) {
    const result = await supabase.from(relation).insert(workingRows).select(selectColumns.join(","));
    if (!result.error) return { data: result.data, error: null, removedColumns };

    const missingColumn = getMissingColumn(result.error, relation);
    if (!missingColumn) return { data: null, error: result.error, removedColumns };

    const anyRowHasColumn = workingRows.some((row) => missingColumn in row);
    if (!anyRowHasColumn) return { data: null, error: result.error, removedColumns };

    workingRows = workingRows.map((row) => {
      const next = { ...row };
      delete next[missingColumn];
      return next;
    });
    removedColumns.push(missingColumn);
  }
}
