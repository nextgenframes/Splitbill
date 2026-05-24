"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.string().uuid();

export async function createHousehold(formData: FormData) {
  try {
    const name = z.string().min(2).max(64).parse(formData.get("name"));
    const supabase = await createClient();
    if (!supabase) throw new Error("Supabase env missing");

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) redirect("/login");

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

    revalidatePath("/households");
    redirect(`/households?householdId=${household.id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create household";
    redirect(`/households?error=${encodeURIComponent(message)}`);
  }
}

export async function renameHousehold(formData: FormData) {
  try {
    const householdId = idSchema.parse(formData.get("householdId"));
    const name = z.string().min(2).max(64).parse(formData.get("name"));
    const supabase = await createClient();
    if (!supabase) throw new Error("Supabase env missing");

    const { error } = await supabase.from("households").update({ name }).eq("id", householdId);
    if (error) throw error;

    revalidatePath("/households");
    redirect(`/households?householdId=${householdId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to rename household";
    redirect(`/households?error=${encodeURIComponent(message)}`);
  }
}

export async function addMember(formData: FormData) {
  try {
    const householdId = idSchema.parse(formData.get("householdId"));
    const email = z.string().email().parse(formData.get("email"));
    const displayNameRaw = String(formData.get("displayName") ?? "").trim();
    const splitWeight = z.coerce.number().positive().max(20).parse(formData.get("splitWeight"));

    const supabase = await createClient();
    if (!supabase) throw new Error("Supabase env missing");

    const { error } = await supabase.from("household_members").insert({
      household_id: householdId,
      user_id: null,
      email,
      display_name: displayNameRaw ? displayNameRaw : null,
      role: "member",
      split_weight: splitWeight
    });
    if (error) throw error;

    revalidatePath("/households");
    redirect(`/households?householdId=${householdId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add member";
    redirect(`/households?error=${encodeURIComponent(message)}`);
  }
}

export async function updateMember(formData: FormData) {
  try {
    const householdId = idSchema.parse(formData.get("householdId"));
    const memberId = idSchema.parse(formData.get("memberId"));
    const displayNameRaw = String(formData.get("displayName") ?? "").trim();
    const splitWeight = z.coerce.number().positive().max(20).parse(formData.get("splitWeight"));

    const supabase = await createClient();
    if (!supabase) throw new Error("Supabase env missing");

    const { error } = await supabase
      .from("household_members")
      .update({
        display_name: displayNameRaw ? displayNameRaw : null,
        split_weight: splitWeight
      })
      .eq("id", memberId);
    if (error) throw error;

    revalidatePath("/households");
    redirect(`/households?householdId=${householdId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update member";
    redirect(`/households?error=${encodeURIComponent(message)}`);
  }
}

export async function removeMember(formData: FormData) {
  try {
    const householdId = idSchema.parse(formData.get("householdId"));
    const memberId = idSchema.parse(formData.get("memberId"));

    const supabase = await createClient();
    if (!supabase) throw new Error("Supabase env missing");

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) redirect("/login");

    const { data: member } = await supabase
      .from("household_members")
      .select("role,user_id")
      .eq("id", memberId)
      .single();

    if (member?.role === "owner") {
      revalidatePath("/households");
      redirect(`/households?householdId=${householdId}`);
    }

    const { error } = await supabase.from("household_members").delete().eq("id", memberId);
    if (error) throw error;

    revalidatePath("/households");
    redirect(`/households?householdId=${householdId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to remove member";
    redirect(`/households?error=${encodeURIComponent(message)}`);
  }
}
