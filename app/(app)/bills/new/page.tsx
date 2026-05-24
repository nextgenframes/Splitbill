import { BillUploadForm } from "@/components/bill-upload-form";
import { createClient } from "@/lib/supabase/server";

export default async function NewBillPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase?.auth.getUser() ?? { data: { user: null } };
  const user = auth.user;

  // Fallback to empty; UI will still allow manual entry.
  let members: { name: string; weight: number }[] = [];
  if (supabase && user) {
    const { data: households } = await supabase.from("households").select("id").order("created_at", { ascending: true }).limit(1);
    const householdId = households?.[0]?.id;
    if (householdId) {
      const { data } = await supabase
        .from("household_members")
        .select("email,name,display_name,split_weight")
        .eq("household_id", householdId)
        .order("created_at", { ascending: true });
      members =
        data?.map((m) => ({
          name: m.display_name || m.name || m.email,
          weight: Number(m.split_weight)
        })) ?? [];
    }
  }

  return (
    <div className="pb-24 md:pb-0">
      <BillUploadForm members={members} />
    </div>
  );
}
