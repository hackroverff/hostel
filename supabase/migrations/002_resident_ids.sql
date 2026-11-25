-- ===========================================================================
-- 002_resident_ids.sql - ID numbers kept apart from the hostel document
-- ---------------------------------------------------------------------------
-- Run this in the Supabase SQL editor after 001 (schema.sql). It is also
-- appended to the end of supabase/schema.sql, so a fresh project only needs
-- that one file. Safe to run again.
--
-- Why a second table
--   The whole hostel database travels as ONE jsonb document (app_state) and is
--   snapshotted into app_state_history. Aadhaar and other ID numbers must not
--   sit in that document, its history or any log, so they live here: one row
--   per resident, never snapshotted, deleted with the resident.
--
-- Access
--   Row level security: a signed-in owner can select, insert, update and delete
--   only their own rows. Anonymous requests see nothing. The app uses the
--   publishable (anon) key only; these policies are the protection.
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

-- Deleting a resident (or erasing everything) removes the row too, so the
-- owner is allowed to delete only their own rows.
drop policy if exists "own ids - delete" on public.resident_ids;
create policy "own ids - delete" on public.resident_ids
  for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Check after the first sync:
--
--   select count(*) from public.resident_ids;
--   select resident_id, id_type, updated_at from public.resident_ids;
--
-- Resident names are not stored here, only the resident_id used inside the
-- app_state document, so this table is useless without the document.
-- ---------------------------------------------------------------------------
