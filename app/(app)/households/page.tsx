import { Trash2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/server";
import { initials } from "@/lib/utils";
import { addMember, createHousehold, removeMember, renameHousehold, updateMember } from "./actions";

export default async function HouseholdsPage({
  searchParams
}: {
  searchParams: Promise<{ householdId?: string; error?: string }>;
}) {
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

  const params = await searchParams;
  const { data: households } = await supabase
    .from("households")
    .select("id,name,owner_id,invite_code")
    .order("created_at", { ascending: true });
  const active = households?.find((h) => h.id === params.householdId) ?? households?.[0] ?? null;

  const { data: members } = active
    ? await supabase
        .from("household_members")
        .select("id,email,display_name,split_weight,role,user_id")
        .eq("household_id", active.id)
        .order("created_at", { ascending: true })
    : { data: null };

  if (!active) {
    return (
      <Card>
        <CardHeader>
          <Badge className="w-fit border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-slate-200">
            Household
          </Badge>
          <CardTitle className="text-2xl tracking-[-0.02em]">Create your first household</CardTitle>
          <p className="text-sm text-muted-foreground">Start by naming your home. You can invite roommates after.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {params.error ? (
            <p className="rounded-2xl border bg-amber-50 p-4 text-sm text-amber-900">
              {decodeURIComponent(params.error)}
            </p>
          ) : null}
          <form action={createHousehold} className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Input name="name" placeholder="e.g. 1420 Elm Street" required minLength={2} />
            <Button variant="dark" type="submit">Create</Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001"}/join?code=${active.invite_code}`;
  const isOwner = active.owner_id === user.id;

  return (
    <div className="grid gap-5 pb-24 lg:grid-cols-[1fr_0.8fr] md:pb-0">
      <Card>
        <CardHeader>
          <Badge className="w-fit border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-slate-200">
            Household
          </Badge>
          <CardTitle className="text-2xl tracking-[-0.02em]">Manage household</CardTitle>
          <p className="text-sm text-muted-foreground">Edit name, members, and split weights.</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {params.error ? (
            <p className="rounded-2xl border bg-amber-50 p-4 text-sm text-amber-900">
              {decodeURIComponent(params.error)}
            </p>
          ) : null}
          <form action={renameHousehold} className="grid gap-3 rounded-2xl border bg-background/70 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <input type="hidden" name="householdId" value={active.id} />
            <div className="space-y-2">
              <Label>Household name</Label>
              <Input name="name" defaultValue={active.name} required minLength={2} />
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
                    <Badge className={member.user_id ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40" : "border-slate-200 bg-slate-50 text-slate-700 dark:bg-white/10 dark:text-slate-200"}>
                      {member.user_id ? "active" : "invited"}
                    </Badge>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_140px_auto_auto] sm:items-end">
                    <form action={updateMember} className="contents">
                      <input type="hidden" name="householdId" value={active.id} />
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
                      <input type="hidden" name="householdId" value={active.id} />
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
              <input type="hidden" name="householdId" value={active.id} />
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
              <p className="mt-1 break-all text-xs text-muted-foreground">{inviteLink}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
