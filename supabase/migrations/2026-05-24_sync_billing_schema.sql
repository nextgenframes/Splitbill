-- Bring older Supabase billing/payment schema up to app expectations.
-- Safe to run more than once.

create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'bill_status') then
    create type bill_status as enum ('draft', 'scheduled', 'paid', 'overdue');
  end if;
  if not exists (select 1 from pg_type where typname = 'bill_type') then
    create type bill_type as enum ('electric', 'water', 'garbage', 'internet');
  end if;
  if not exists (select 1 from pg_type where typname = 'split_mode') then
    create type split_mode as enum ('equal', 'weighted');
  end if;
  if not exists (select 1 from pg_type where typname = 'split_status') then
    create type split_status as enum ('unpaid', 'paid');
  end if;
  if not exists (select 1 from pg_type where typname = 'payment_request_status') then
    create type payment_request_status as enum ('pending', 'paid', 'overdue');
  end if;
  if not exists (select 1 from pg_type where typname = 'payment_provider') then
    create type payment_provider as enum ('venmo', 'zelle', 'cash_app', 'paypal');
  end if;
end $$;

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  utility_provider text not null,
  bill_type bill_type not null default 'electric',
  amount numeric(10, 2) not null default 0,
  due_date date,
  billing_period text,
  service_address text,
  split_mode split_mode not null default 'equal',
  status bill_status not null default 'scheduled',
  proof_path text,
  ocr_confidence numeric(4, 3) not null default 0,
  needs_manual_review boolean not null default true,
  ocr_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.bills
add column if not exists utility_provider text,
add column if not exists bill_type bill_type default 'electric',
add column if not exists amount numeric(10, 2) default 0,
add column if not exists due_date date,
add column if not exists billing_period text,
add column if not exists service_address text,
add column if not exists split_mode split_mode default 'equal',
add column if not exists status bill_status default 'scheduled',
add column if not exists proof_path text,
add column if not exists ocr_confidence numeric(4, 3) default 0,
add column if not exists needs_manual_review boolean default true,
add column if not exists ocr_payload jsonb default '{}'::jsonb,
add column if not exists created_at timestamptz default now();

create table if not exists public.bill_splits (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  member_id uuid not null references public.household_members(id) on delete cascade,
  amount numeric(10, 2) not null default 0,
  status split_status not null default 'unpaid',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (bill_id, member_id)
);

alter table public.bill_splits
add column if not exists amount numeric(10, 2) default 0,
add column if not exists status split_status default 'unpaid',
add column if not exists paid_at timestamptz,
add column if not exists created_at timestamptz default now();

create table if not exists public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  provider payment_provider not null,
  handle text not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (household_id, provider)
);

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  split_id uuid not null references public.bill_splits(id) on delete cascade,
  member_id uuid not null references public.household_members(id) on delete cascade,
  utility_name text not null,
  total_bill numeric(10, 2) not null default 0,
  user_share numeric(10, 2) not null default 0,
  due_date date,
  proof_path text,
  provider payment_provider not null default 'venmo',
  payment_target text not null default '',
  payment_url text,
  zelle_instructions text,
  status payment_request_status not null default 'pending',
  last_reminder_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (split_id)
);

create table if not exists public.reminder_events (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.payment_requests(id) on delete cascade,
  member_id uuid not null references public.household_members(id) on delete cascade,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status text not null default 'scheduled',
  created_at timestamptz not null default now()
);

alter table public.payment_accounts enable row level security;
alter table public.payment_requests enable row level security;
alter table public.reminder_events enable row level security;
alter table public.bill_splits enable row level security;
alter table public.bills enable row level security;

drop policy if exists "members create bills" on public.bills;
drop policy if exists "members read bills" on public.bills;
drop policy if exists "members update bills" on public.bills;
drop policy if exists "members manage splits" on public.bill_splits;
drop policy if exists "members read splits" on public.bill_splits;
drop policy if exists "members read payment requests" on public.payment_requests;
drop policy if exists "members manage payment requests" on public.payment_requests;
drop policy if exists "members read payment accounts" on public.payment_accounts;
drop policy if exists "admins manage payment accounts" on public.payment_accounts;
drop policy if exists "members read reminder events" on public.reminder_events;
drop policy if exists "members manage reminder events" on public.reminder_events;
drop policy if exists "members read bill proofs" on storage.objects;
drop policy if exists "authenticated upload bill proofs" on storage.objects;

create policy "members read bills"
on public.bills for select
using (public.is_household_member(household_id));

create policy "members create bills"
on public.bills for insert
with check (public.is_household_member(household_id) and uploaded_by = auth.uid());

create policy "members update bills"
on public.bills for update
using (public.is_household_member(household_id));

create policy "members read splits"
on public.bill_splits for select
using (
  exists (
    select 1
    from public.bills b
    where b.id = bill_splits.bill_id
      and public.is_household_member(b.household_id)
  )
);

create policy "members manage splits"
on public.bill_splits for all
using (
  exists (
    select 1
    from public.bills b
    where b.id = bill_splits.bill_id
      and public.is_household_member(b.household_id)
  )
);

create policy "members read payment requests"
on public.payment_requests for select
using (
  exists (
    select 1
    from public.bills b
    where b.id = payment_requests.bill_id
      and public.is_household_member(b.household_id)
  )
);

create policy "members manage payment requests"
on public.payment_requests for all
using (
  exists (
    select 1
    from public.bills b
    where b.id = payment_requests.bill_id
      and public.is_household_member(b.household_id)
  )
);

create policy "members read payment accounts"
on public.payment_accounts for select
using (public.is_household_member(household_id));

create policy "admins manage payment accounts"
on public.payment_accounts for all
using (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = payment_accounts.household_id
      and hm.user_id = auth.uid()
      and hm.role in ('owner', 'admin')
  )
);

create policy "members read reminder events"
on public.reminder_events for select
using (
  exists (
    select 1
    from public.payment_requests pr
    join public.bills b on b.id = pr.bill_id
    where pr.id = reminder_events.payment_request_id
      and public.is_household_member(b.household_id)
  )
);

create policy "members manage reminder events"
on public.reminder_events for all
using (
  exists (
    select 1
    from public.payment_requests pr
    join public.bills b on b.id = pr.bill_id
    where pr.id = reminder_events.payment_request_id
      and public.is_household_member(b.household_id)
  )
);

insert into storage.buckets (id, name, public)
values ('bill-proofs', 'bill-proofs', false)
on conflict (id) do nothing;

create policy "members read bill proofs"
on storage.objects for select
using (
  bucket_id = 'bill-proofs'
  and exists (
    select 1
    from public.bills b
    where b.proof_path = storage.objects.name
      and public.is_household_member(b.household_id)
  )
);

create policy "authenticated upload bill proofs"
on storage.objects for insert
with check (
  bucket_id = 'bill-proofs'
  and auth.role() = 'authenticated'
);

notify pgrst, 'reload schema';
