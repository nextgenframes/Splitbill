import { redirect } from "next/navigation";
import { Trash2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/server";
import { initials } from "@/lib/utils";
import { addMember, createHousehold, removeMember, renameHousehold, updateMember } from "../actions";

export default async function HouseholdDetailPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: Promise<{ error?: string }>;
}) {
  console.log("HouseholdDetailPage: params.id =", params.id);

  const supabase = await createClient();
  if (!supabase) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connect Supabase</CardTitle>
          <p className="text-sm text-muted-foreground">Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.</p>
        </CardHeader>
      </Card>
    );
  }

  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return null;

  const searchParamsObj = await searchParams;

  // Fetch the specific household by id
  const { data: household, error: householdError } = await supabase
    .from("households")
    .select("id,name,owner_id,invite_code,created_at")
    .eq("id", params.id)
    .single();

  if (householdError) {
    console.error("HouseholdDetailPage: error fetching household:", householdError);
    redirect(`/households?error=${encodeURIComponent("Failed to load household")}`);
  }

  // If household not found, redirect to households list
  if (!household) {
    console.log("HouseholdDetailPage: household not found, redirecting to households list");
    redirect(`/households?error=${encodeURIComponent("Household not found")}`);
  }

  // Fetch members for this household
  const { data: members, error: membersError } = await supabase
    .from("household_members")
    .select("id,email,display_name,split_weight,role,user_id,created_at")
    .eq("household_id", household.id)
    .order("created_at", { ascending: true });

  // Fetch bills for this household (if any)
  const { data: bills, error: billsError } = await supabase
    .from("bills")
    .select("id,description,amount,date,paid,created_at")
    .eq("household_id", household.id)
    .order("created_at", { ascending: true });

  if (membersError) {
    console.error("HouseholdDetailPage: error fetching members:", membersError);
  }
  if (billsError) {
    console.error("HouseholdDetailPage: error fetching bills:", billsError);
  }

  const isOwner = household.owner_id === user.id;

  return (
    <div className="grid gap-5 pb-24 lg:grid-cols-[1fr_0.8fr] md:pb-0">
      {/* Left column: Household management */}
      <Card>
        <CardHeader>
          <Badge className="w-fit border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-slate-200">
            Household
          </Badge>
          <CardTitle className="text-2xl tracking-[-0.02em]">{household.name}</CardTitle>
          <p className="text-sm text-muted-foreground">Manage your household details and members.</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {searchParamsObj.error ? (
            <p className="rounded-2xl border bg-amber-50 p-4 text-sm text-amber-900">
              {decodeURIComponent(searchParamsObj.error)}
            </p>
          ) : null}

          <form action={renameHousehold} className="grid gap-3 rounded-2xl border bg-background/70 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <input type="hidden" name="householdId" value={household.id} />
            <div className="space-y-2">
              <Label>Household name</Label>
              <Input name="name" defaultValue={household.name} required minLength={2} />
            </div>
            <Button type="submit" variant="dark" className="min-h-11">Save</Button>
          </form>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold">Members</p>
              <Badge className="text-xs">{members?.length ?? 0}</Badge>
            </div>

            {(members ?? []).map((member) => {
              const label = member.display_name || member.email;
              const isProtected = member.role === "owner";
              return (
                <div key={member.id} className="rounded-2xl border bg-background/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white shadow-sm dark:bg-white dark:text-slate-950">
                        {initials(label)}
                      </div>
                      <div>
                        <p className="font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">{member.role}</p>
                      </div>
                    </div>
                    <Badge className={member.user_id ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40" : "border-slate-200 bg-slate-50 text-slate-700 dark:bg-white/10 dark:text-slate-200">
                      {member.user_id ? "active" : "invited"}
                    </Badge>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_140px_auto_auto] sm:items-end">
                    <form action={updateMember} className="contents">
                      <input type="hidden" name="householdId" value={household.id} />
                      <input type="hidden" name="memberId" value={member.id} />
                      <div className="space-y-2">
                        <Label>Display name</Label>
                        <Input name="displayName" defaultValue={member.display_name ?? ""} placeholder={member.email} />
                      </div>
                      <div className="space-y-2">
                        <Label>Split weight</Label>
                        <Input name="splitWeight" defaultValue={String(member.split_weight)} inputMode="decimal" required />
                      </div>
                      <Button type="submit" variant="outline" className="min-h-11">Update</Button>
                    </form>
                    <form action={removeMember}>
                      <input type="hidden" name="householdId" value={household.id} />
                      <input type="hidden" name="memberId" value={member.id} />
                      <Button type="submit" variant="outline" className="min-h-11" disabled={isProtected || !isOwner} aria-disabled={isProtected || !isOwner}>
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </Button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Right column: Invite and Bills */}
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                <UserPlus className="h-4 w-4" />
              </span>
              Invite roommate
            </CardTitle>
            <p className="text-sm text-muted-foreground">Creates member record. Roommate can join later.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <form action={addMember} className="space-y-3">
              <input type="hidden" name="householdId" value={household.id} />
              <div className="space-y-2">
                <Label>Email</Label>
                <Input name="email" placeholder="roommate@example.com" type="email" required />
              </div>
              <div className="space-y-2">
                <Label>Display name</Label>
                <Input name="displayName" placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label>Split weight</Label>
                <Input name="splitWeight" defaultValue="1" inputMode="decimal" required />
              </div>
              <Button className="w-full min-h-12" variant="dark" type="submit" disabled={!isOwner}>
                Add member
              </Button>
            </form>
            <div className="rounded-2xl border bg-background/70 p-4">
              <p className="text-sm font-medium">Invite link</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                {`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001"}/join?code=${household.invite_code}`}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Bills section */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl tracking-[-0.02em]">Bills</CardTitle>
            <p className="text-sm text-muted-foreground">Track shared expenses.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {billsError ? (
              <p className="rounded-2xl border bg-amber-50 p-4 text-sm text-amber-900">
                Error loading bills: {billsError.message}
              </p>
            ) : bills && bills.length > 0 ? (
              <>
                {bills.map((bill) => (
                  <div key={bill.id} className="rounded-2xl border bg-background/70 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{bill.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(bill.date).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right space-y-1">
                        <p className="font-semibold">${Number(bill.amount).toFixed(2)}</p>
                        <span className={bill.paid ? "text-xs text-green-600" : "text-xs text-red-600"}>
                          {bill.paid ? "Paid" : "Pending"}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                <div className="pt-4 border-t">
                  <Button asChild href="/bills/new" variant="outline">
                    Add bill
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center">
                No bills yet. Add your first bill to get started.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}