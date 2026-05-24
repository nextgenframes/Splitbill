create extension if not exists "pgcrypto";

create type household_role as enum ('owner', 'admin', 'member');
create type bill_status as enum ('draft', 'scheduled', 'paid', 'overdue');
create type bill_type as enum ('electric', 'water', 'garbage', 'internet');
create type split_mode as enum ('equal', 'weighted');
create type split_status as enum ('unpaid', 'paid');
create type payment_request_status as enum ('pending', 'paid', 'overdue');
create type payment_provider as enum ('venmo', 'zelle', 'cash_app', 'paypal');
create type notification_channel as enum ('email', 'sms', 'push');
create type notification_kind as enum ('upcoming_bill', 'overdue_balance', 'completed_payment', 'bill_spike');

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  invite_code text not null unique default encode(gen_random_bytes(8), 'hex'),
  created_at timestamptz not null default now()
);

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role household_role not null default 'member',
  split_weight numeric(8, 2) not null default 1 check (split_weight > 0),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  unique (household_id, email)
);

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  utility_provider text not null,
  bill_type bill_type not null,
  amount numeric(10, 2) not null check (amount >= 0),
  due_date date,
  billing_period text,
  service_address text,
  split_mode split_mode not null default 'equal',
  status bill_status not null default 'scheduled',
  proof_path text,
  ocr_confidence numeric(4, 3) not null default 0 check (ocr_confidence >= 0 and ocr_confidence <= 1),
  needs_manual_review boolean not null default true,
  ocr_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.bill_splits (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  member_id uuid not null references public.household_members(id) on delete cascade,
  amount numeric(10, 2) not null check (amount >= 0),
  status split_status not null default 'unpaid',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (bill_id, member_id)
);

create table public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  split_id uuid not null references public.bill_splits(id) on delete cascade,
  member_id uuid not null references public.household_members(id) on delete cascade,
  utility_name text not null,
  total_bill numeric(10, 2) not null check (total_bill >= 0),
  user_share numeric(10, 2) not null check (user_share >= 0),
  due_date date,
  proof_path text,
  provider payment_provider not null,
  payment_target text not null,
  payment_url text,
  zelle_instructions text,
  status payment_request_status not null default 'pending',
  last_reminder_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (split_id)
);

create table public.payment_history (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.payment_requests(id) on delete cascade,
  member_id uuid not null references public.household_members(id) on delete cascade,
  amount numeric(10, 2) not null check (amount >= 0),
  provider payment_provider not null,
  paid_at timestamptz not null default now(),
  note text
);

create table public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  provider payment_provider not null,
  handle text not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (household_id, provider)
);

create table public.reminder_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  days_offset integer not null,
  send_time time not null default '09:00',
  is_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.reminder_events (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.payment_requests(id) on delete cascade,
  member_id uuid not null references public.household_members(id) on delete cascade,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status text not null default 'scheduled',
  created_at timestamptz not null default now()
);

create table public.utility_forecasts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  bill_type bill_type not null,
  forecast_month date not null,
  predicted_amount numeric(10, 2) not null,
  previous_amount numeric(10, 2) not null,
  percent_change numeric(6, 2) not null,
  is_spike boolean not null default false,
  reason text,
  suggestion text,
  created_at timestamptz not null default now(),
  unique (household_id, bill_type, forecast_month)
);

create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email_enabled boolean not null default true,
  sms_enabled boolean not null default false,
  push_enabled boolean not null default true,
  quiet_start time not null default '21:00',
  quiet_end time not null default '08:00',
  upcoming_bills boolean not null default true,
  overdue_balances boolean not null default true,
  completed_payments boolean not null default true,
  unusual_spikes boolean not null default true,
  created_at timestamptz not null default now(),
  unique (household_id, user_id)
);

create table public.smart_notifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  kind notification_kind not null,
  channel notification_channel not null,
  title text not null,
  body text not null,
  priority text not null default 'normal',
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.bills enable row level security;
alter table public.bill_splits enable row level security;
alter table public.payment_requests enable row level security;
alter table public.payment_history enable row level security;
alter table public.payment_accounts enable row level security;
alter table public.reminder_rules enable row level security;
alter table public.reminder_events enable row level security;
alter table public.utility_forecasts enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.smart_notifications enable row level security;

create or replace function public.is_household_member(target_household_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = auth.uid()
  );
$$;

create policy "members read households"
on public.households for select
using (public.is_household_member(id) or owner_id = auth.uid());

create policy "users create households"
on public.households for insert
with check (owner_id = auth.uid());

create policy "owners update households"
on public.households for update
using (owner_id = auth.uid());

create policy "members read members"
on public.household_members for select
using (public.is_household_member(household_id));

create policy "admins manage members"
on public.household_members for all
using (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = household_members.household_id
      and hm.user_id = auth.uid()
      and hm.role in ('owner', 'admin')
  )
);

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

create policy "members read payment history"
on public.payment_history for select
using (
  exists (
    select 1
    from public.payment_requests pr
    join public.bills b on b.id = pr.bill_id
    where pr.id = payment_history.payment_request_id
      and public.is_household_member(b.household_id)
  )
);

create policy "members manage payment history"
on public.payment_history for all
using (
  exists (
    select 1
    from public.payment_requests pr
    join public.bills b on b.id = pr.bill_id
    where pr.id = payment_history.payment_request_id
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

create policy "members read reminders"
on public.reminder_rules for select
using (public.is_household_member(household_id));

create policy "admins manage reminders"
on public.reminder_rules for all
using (
  exists (
    select 1 from public.household_members hm
    where hm.household_id = reminder_rules.household_id
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

create policy "members read utility forecasts"
on public.utility_forecasts for select
using (public.is_household_member(household_id));

create policy "members manage utility forecasts"
on public.utility_forecasts for all
using (public.is_household_member(household_id));

create policy "users read notification preferences"
on public.notification_preferences for select
using (public.is_household_member(household_id) and user_id = auth.uid());

create policy "users manage notification preferences"
on public.notification_preferences for all
using (public.is_household_member(household_id) and user_id = auth.uid());

create policy "members read smart notifications"
on public.smart_notifications for select
using (public.is_household_member(household_id));

create policy "members manage smart notifications"
on public.smart_notifications for all
using (public.is_household_member(household_id));

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
