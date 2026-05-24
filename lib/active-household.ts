type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      order: (column: string, options: { ascending: boolean }) => {
        limit: (count: number) => Promise<{ data: any[] | null; error: { message?: string } | null }>;
      };
      in: (column: string, values: string[]) => {
        eq: (column: string, value: string) => Promise<{ data: any[] | null; error: { message?: string } | null }>;
      };
    };
  };
};

export async function getActiveHousehold<T extends SupabaseLike>(supabase: T, userId: string) {
  const { data: households, error } = await supabase
    .from("households")
    .select("id,name,owner_id,invite_code,created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error || !households?.length) return null;

  const householdIds = households.map((household) => household.id);
  const { data: memberships } = await supabase
    .from("household_members")
    .select("household_id,user_id,role")
    .in("household_id", householdIds)
    .eq("user_id", userId);

  const membershipIds = new Set((memberships ?? []).map((membership) => membership.household_id));
  return (
    households.find((household) => membershipIds.has(household.id)) ??
    households.find((household) => household.owner_id === userId) ??
    households[0]
  );
}
