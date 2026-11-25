-- ===========================================================================
-- Hostel Manager - Supabase schema
-- ---------------------------------------------------------------------------
-- Run this once in your Supabase project: Dashboard -> SQL Editor -> New query
-- -> paste this whole file -> Run. It is safe to run again.
--
-- What it does
--   * app_state          one row per owner holding the whole hostel database as
--                        a single jsonb document, plus a version number that is
--                        bumped on every save (used to detect two phones
--                        editing at the same time).
--   * app_state_history  an automatic snapshot of the previous copy, kept for
--                        60 days, so a bad sync can be undone by hand.
--   * Row level security on both tables: a signed-in owner can only ever read
--                        and write their own row. There is no delete policy, so
--                        rows cannot be removed through the API, and anonymous
--                        (not signed in) requests get nothing at all.
--
-- No secret keys are involved. The browser only ever uses the publishable
-- (anon) key, and these policies are the protection.
-- ===========================================================================

create table if not exists public.app_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_state_history (
  id       bigserial primary key,
  user_id  uuid not null references auth.users (id) on delete cascade,
  data     jsonb not null,
  version  bigint not null,
  saved_at timestamptz not null default now()
);

create index if not exists app_state_history_user_time
  on public.app_state_history (user_id, saved_at desc);

-- ---------------------------------------------------------------------------
-- One snapshot per user per 6 hours, and history older than 60 days is
-- dropped. Runs as the table owner so it works even though clients may only
-- select from the history table.
-- ---------------------------------------------------------------------------
create or replace function public.app_state_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- old.updated_at is the time the previous copy was written, so this copies a
  -- row into history only when the last snapshot is at least 6 hours old.
  if old.updated_at is null or old.updated_at < now() - interval '6 hours' then
    insert into public.app_state_history (user_id, data, version, saved_at)
    values (old.user_id, old.data, old.version, coalesce(old.updated_at, now()));
  end if;

  delete from public.app_state_history
   where user_id = old.user_id
     and saved_at < now() - interval '60 days';

  return new;
end;
$$;

drop trigger if exists app_state_snapshot on public.app_state;
create trigger app_state_snapshot
  after update on public.app_state
  for each row execute function public.app_state_snapshot();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.app_state enable row level security;
alter table public.app_state_history enable row level security;

-- app_state: the owner reads, creates and updates only their own row.
-- (No delete policy on purpose: nothing in the app deletes cloud copies.)
drop policy if exists "own state - select" on public.app_state;
create policy "own state - select" on public.app_state
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "own state - insert" on public.app_state;
create policy "own state - insert" on public.app_state
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "own state - update" on public.app_state;
create policy "own state - update" on public.app_state
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- app_state_history: read only for the owner. Rows are written by the trigger.
drop policy if exists "own history - select" on public.app_state_history;
create policy "own history - select" on public.app_state_history
  for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Optional check. After creating the owner in Authentication -> Users, run:
--
--   select user_id, version, updated_at from public.app_state;
--   select count(*) from public.app_state_history;
--
-- Both return zero rows until the app saves for the first time.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- Resident ID numbers (also available on its own as
-- supabase/migrations/002_resident_ids.sql)
-- ---------------------------------------------------------------------------
-- Aadhaar and other ID numbers must never sit inside the app_state document or
-- its history snapshots, so they live in their own table: one row per resident,
-- never snapshotted, deleted with the resident. Row level security lets a
-- signed-in owner select, insert, update and delete only their own rows;
-- anonymous requests see nothing.
-- ===========================================================================

create table if not exists public.resident_ids (
  user_id    uuid not null references auth.users (id) on delete cascade,
  resident_id text not null,
  id_type    text,
  id_number  text,
  updated_at timestamptz not null default now(),
  primary key (user_id, resident_id)
);

alter table public.resident_ids enable row level security;

drop policy if exists "own ids - select" on public.resident_ids;
create policy "own ids - select" on public.resident_ids
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "own ids - insert" on public.resident_ids;
create policy "own ids - insert" on public.resident_ids
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "own ids - update" on public.resident_ids;
create policy "own ids - update" on public.resident_ids
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "own ids - delete" on public.resident_ids;
create policy "own ids - delete" on public.resident_ids
  for delete to authenticated
  using (user_id = auth.uid());
