-- Bring an older Supabase project up to the household schema the app expects.
-- Safe to run more than once: only adds missing columns/policies.

create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'household_role') then
    create type household_role as enum ('owner', 'admin', 'member');
  end if;
end $$;

alter table public.households
add column if not exists owner_id uuid references auth.users(id) on delete cascade,
add column if not exists invite_code text default encode(gen_random_bytes(8), 'hex'),
add column if not exists created_at timestamptz not null default now();

update public.households
set invite_code = encode(gen_random_bytes(8), 'hex')
where invite_code is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'households_invite_code_key'
      and conrelid = 'public.households'::regclass
  ) then
    alter table public.households add constraint households_invite_code_key unique (invite_code);
  end if;
end $$;

alter table public.household_members
add column if not exists user_id uuid references auth.users(id) on delete cascade,
add column if not exists display_name text,
add column if not exists role household_role not null default 'member',
add column if not exists split_weight numeric(8, 2) not null default 1,
add column if not exists joined_at timestamptz,
add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'household_members_split_weight_check'
      and conrelid = 'public.household_members'::regclass
  ) then
    alter table public.household_members
    add constraint household_members_split_weight_check check (split_weight > 0);
  end if;
end $$;

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

notify pgrst, 'reload schema';
