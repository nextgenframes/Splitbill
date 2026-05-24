-- Add missing owner_id column for households (required by app + RLS policies).
-- Safe: does not drop data. If households already has owner_id, no-op.

alter table public.households
add column if not exists owner_id uuid references auth.users(id) on delete cascade;

-- If this is a fresh project with no households yet, keep it nullable for now.
-- Once you have no orphan rows, you can enforce NOT NULL:
-- alter table public.households alter column owner_id set not null;
