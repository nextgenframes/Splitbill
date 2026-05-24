-- Allow a household owner to create their initial household_members row.
-- Without this, RLS can create the household but block the owner member insert.

drop policy if exists "owners create initial member" on public.household_members;
drop policy if exists "owners manage owned household members" on public.household_members;

create policy "owners create initial member"
on public.household_members for insert
with check (
  exists (
    select 1 from public.households h
    where h.id = household_members.household_id
      and h.owner_id = auth.uid()
  )
);

create policy "owners manage owned household members"
on public.household_members for all
using (
  exists (
    select 1 from public.households h
    where h.id = household_members.household_id
      and h.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.households h
    where h.id = household_members.household_id
      and h.owner_id = auth.uid()
  )
);
