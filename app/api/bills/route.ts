import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getActiveHousehold } from "@/lib/active-household";
import { createSupabaseAdminClient, getSupabaseServiceRoleStatus } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const providerPriority = ["venmo", "cash_app", "paypal", "zelle"] as const;
type InsertBillResult = { id: string };

export async function POST(request: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase env missing" }, { status: 500 });
  const serviceRole = getSupabaseServiceRoleStatus();
  const writeClient = createSupabaseAdminClient() ?? supabase;

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Login required" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  const utilityProvider = String(form.get("provider") ?? "").trim();
  const billType = String(form.get("billType") ?? "").trim();
  const amount = Number(form.get("amount") ?? 0);
  const dueDate = normalizeDateInput(String(form.get("dueDate") ?? "").trim());
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

  const household = await getActiveHousehold(supabase as never, auth.user.id);
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
    const { error: repairError } = await writeClient.from("household_members").insert({
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
  const { error: uploadError } = await writeClient.storage.from("bill-proofs").upload(proofPath, file, {
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
    provider: utilityProvider,
    utility_provider: utilityProvider,
    category: billType,
    type: billType,
    bill_type: billType,
    amount,
    total: amount,
    due_date: dueDate || null,
    due: dueDate || null,
    billing_period: billingPeriod || null,
    period: billingPeriod || null,
    address: serviceAddress || null,
    service_address: serviceAddress || null,
    split_mode: splitMode,
    status: "scheduled",
    proof_path: savedProofPath,
    ocr_confidence: parsedMeta.confidence?.overall ?? 0,
    needs_manual_review: parsedMeta.needsManualReview ?? true,
    ocr_payload: parsedMeta
  };

  const billResult = await insertWithSchemaFallback(writeClient, "bills", billInsert, ["id"]);
  if (billResult.error) {
    if (isBillsRlsError(billResult.error)) {
      const envHint = !serviceRole.present
        ? "SUPABASE_SERVICE_ROLE_KEY is not available at runtime. Add it to Vercel and redeploy."
        : !serviceRole.isPrivileged
          ? `SUPABASE_SERVICE_ROLE_KEY is loaded but not privileged (kind=${serviceRole.keyKind}${serviceRole.jwtRole ? `, role=${serviceRole.jwtRole}` : ""}). Use actual service role or secret key.`
          : "Privileged key is loaded. Remaining blocker is live Supabase schema/policies.";
      return NextResponse.json(
        {
          error: `Supabase blocked bill save. ${envHint}`
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

  return NextResponse.json({
    ok: true,
    billId: bill.id,
    proofPath: savedProofPath,
    warnings,
    message: "Bill saved to dashboard."
  });
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function normalizeDateInput(value: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, month, day, year] = slash;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const time = Date.parse(value);
  if (!Number.isNaN(time)) return new Date(time).toISOString().slice(0, 10);
  return "";
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

function getNullConstraintColumn(error: { message?: string; code?: string }, relation: string) {
  const message = `${error.message ?? ""} ${error.code ?? ""}`;
  const match = message.match(new RegExp(`null value in column "([^"]+)" of relation "${relation}" violates not-null constraint`, "i"));
  return match?.[1] ?? null;
}

function getLegacyBillsValue(column: string, payload: Record<string, unknown>) {
  const utilityProvider = payload.utility_provider ?? payload.provider;
  const billType = payload.bill_type ?? payload.category ?? payload.type;
  const amount = payload.amount ?? payload.total;
  const dueDate = payload.due_date ?? payload.due;
  const billingPeriod = payload.billing_period ?? payload.period;
  const serviceAddress = payload.service_address ?? payload.address;

  const fallbacks: Record<string, unknown> = {
    provider: utilityProvider,
    utility_provider: utilityProvider,
    category: billType,
    type: billType,
    name: utilityProvider,
    title: utilityProvider,
    label: utilityProvider,
    bill_type: billType,
    total: amount,
    amount,
    due: dueDate,
    due_date: dueDate,
    period: billingPeriod,
    billing_period: billingPeriod,
    address: serviceAddress,
    service_address: serviceAddress,
    description: [utilityProvider, billingPeriod].filter(Boolean).join(" ").trim() || utilityProvider,
    note: [utilityProvider, billingPeriod].filter(Boolean).join(" ").trim() || utilityProvider
  };

  return fallbacks[column];
}

function isInvalidDateColumn(error: { message?: string; code?: string }, relation: string) {
  const message = `${error.message ?? ""} ${error.code ?? ""}`.toLowerCase();
  return relation === "bills" && message.includes("invalid input syntax for type date");
}

function isInvalidEnumValue(error: { message?: string; code?: string }, column: string) {
  const message = `${error.message ?? ""} ${error.code ?? ""}`.toLowerCase();
  return message.includes(`"${column}"`) && message.includes("invalid input value for enum");
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

    const nullConstraintColumn = getNullConstraintColumn(result.error, relation);
    if (nullConstraintColumn && relation === "bills") {
      const nextValue = getLegacyBillsValue(nullConstraintColumn, payload);
      if (nextValue !== undefined && (workingPayload[nullConstraintColumn] == null || workingPayload[nullConstraintColumn] === "")) {
        workingPayload[nullConstraintColumn] = nextValue;
        continue;
      }
    }

    if (isInvalidDateColumn(result.error, relation)) {
      if ("due_date" in workingPayload) workingPayload.due_date = null;
      if ("due" in workingPayload) workingPayload.due = null;
      continue;
    }

    if (relation === "bills" && isInvalidEnumValue(result.error, "bill_type")) {
      if ("bill_type" in workingPayload) workingPayload.bill_type = "electric";
      if ("category" in workingPayload) workingPayload.category = "electric";
      if ("type" in workingPayload) workingPayload.type = "electric";
      continue;
    }

    if (relation === "bills" && isInvalidEnumValue(result.error, "split_mode")) {
      if ("split_mode" in workingPayload) workingPayload.split_mode = "equal";
      continue;
    }

    const missingColumn = getMissingColumn(result.error, relation);
    if (!missingColumn || !(missingColumn in workingPayload)) {
      return { data: null, error: result.error, removedColumns };
    }

    delete workingPayload[missingColumn];
    removedColumns.push(missingColumn);
  }
}
