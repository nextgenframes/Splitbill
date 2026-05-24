"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.string().uuid();

export async function createHousehold(formData: FormData) {
  // Auth check first - redirect if not authenticated (this redirect throws and is not caught below)
  const supabase = await createClient();
  if (!supabase) throw new Error("Supabase env missing");

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  let errorMessage = null;
  let householdId = null;

  try {
    const name = z.string().min(2).max(64).parse(formData.get("name"));

    const { data: household, error } = await supabase
      .from("households")
      .insert({ name, owner_id: auth.user.id })
      .select("id")
      .single();
    if (error) throw error;

    await supabase.from("household_members").upsert({
      household_id: household.id,
      user_id: auth.user.id,
      email: auth.user.email ?? "unknown",
      display_name: auth.user.user_metadata?.full_name ?? auth.user.email ?? "Owner",
      role: "owner",
      split_weight: 1,
      joined_at: new Date().toISOString()
    });

    householdId = household.id;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Failed to create household";
    if (errorMessage.includes("PGRST204") && errorMessage.includes("owner_id")) {
      errorMessage =
        "Supabase schema missing households.owner_id. Run supabase/migrations/2026-05-24_add_households_owner_id.sql in Supabase SQL editor, then retry.";
    }
  }

  if (errorMessage) {
    redirect(`/households?error=${encodeURIComponent(errorMessage)}`);
  } else {
    revalidatePath("/households");
    redirect(`/households?householdId=${householdId}`);
  }
}

export async function renameHousehold(formData: FormData) {
  const supabase = await createClient();
  if (!supabase) throw new Error("Supabase env missing");

  let errorMessage = null;
  let householdId = null;

  try {
    const householdIdParsed = idSchema.parse(formData.get("householdId"));
    const name = z.string().min(2).max(64).parse(formData.get("name"));
    householdId = householdIdParsed;

    const { error } = await supabase.from("households").update({ name }).eq("id", householdId);
    if (error) throw error;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Failed to rename household";
  }

  if (errorMessage) {
    redirect(`/households?error=${encodeURIComponent(errorMessage)}`);
  } else {
    revalidatePath("/households");
    redirect(`/households?householdId=${householdId}`);
  }
}

export async function addMember(formData: FormData) {
  const supabase = await createClient();
  if (!supabase) throw new Error("Supabase env missing");

  let errorMessage = null;
  let householdId = null;

  try {
    const householdIdParsed = idSchema.parse(formData.get("householdId"));
    const email = z.string().email().parse(formData.get("email"));
    const displayNameRaw = String(formData.get("displayName") ?? "").trim();
    const splitWeight = z.coerce.number().positive().max(20).parse(formData.get("splitWeight"));
    householdId = householdIdParsed;

    const { error } = await supabase.from("household_members").insert({
      household_id: householdId,
      user_id: null,
      email,
      display_name: displayNameRaw ? displayNameRaw : null,
      role: "member",
      split_weight: splitWeight
    });
    if (error) throw error;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Failed to add member";
  }

  if (errorMessage) {
    redirect(`/households?error=${encodeURIComponent(errorMessage)}`);
  } else {
    revalidatePath("/households");
    redirect(`/households?householdId=${householdId}`);
  }
}

export async function updateMember(formData: FormData) {
  const supabase = await createClient();
  if (!supabase) throw new Error("Supabase env missing");

  let errorMessage = null;
  let householdId = null;

  try {
    const householdIdParsed = idSchema.parse(formData.get("householdId"));
    const memberId = idSchema.parse(formData.get("memberId"));
    const displayNameRaw = String(formData.get("displayName") ?? "").trim();
    const splitWeight = z.coerce.number().positive().max(20).parse(formData.get("splitWeight"));
    householdId = householdIdParsed;

    const { error } = await supabase
      .from("household_members")
      .update({
        display_name: displayNameRaw ? displayNameRaw : null,
        split_weight: splitWeight
      })
      .eq("id", memberId);
    if (error) throw error;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Failed to update member";
  }

  if (errorMessage) {
    redirect(`/households?error=${encodeURIComponent(errorMessage)}`);
  } else {
    revalidatePath("/households");
    redirect(`/households?householdId=${householdId}`);
  }
}

export async function removeMember(formData: FormData) {
  // Auth check first - redirect if not authenticated
  const supabase = await createClient();
  if (!supabase) throw new Error("Supabase env missing");

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  let errorMessage = null;
  let householdId = null;

  try {
    const householdIdParsed = idSchema.parse(formData.get("householdId"));
    const memberId = idSchema.parse(formData.get("memberId"));
    householdId = householdIdParsed;

    const { data: member } = await supabase
      .from("household_members")
      .select("role,user_id")
      .eq("id", memberId)
      .single();

    // If member is owner, redirect to household page without deleting
    if (member?.role === "owner") {
      revalidatePath("/households");
      redirect(`/households?householdId=${householdId}`);
      // Note: we return after redirect (though redirect throws, so execution stops)
      return;
    }

    const { error } = await supabase.from("household_members").delete().eq("id", memberId);
    if (error) throw error;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Failed to remove member";
  }

  if (errorMessage) {
    redirect(`/households?error=${encodeURIComponent(errorMessage)}`);
  } else {
    revalidatePath("/households");
    redirect(`/households?householdId=${householdId}`);
  }
}