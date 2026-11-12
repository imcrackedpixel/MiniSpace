-- MiniSpace cloud pilot saves.
-- Run this once in Supabase SQL Editor after the account system is deployed.

create table if not exists public.pilot_saves (
  pilot_id uuid primary key references auth.users(id) on delete cascade,
  save_data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.pilot_saves enable row level security;

drop policy if exists "Pilots can read own cloud save" on public.pilot_saves;
create policy "Pilots can read own cloud save"
on public.pilot_saves for select
to authenticated
using (auth.uid() = pilot_id);

drop policy if exists "Pilots can create own cloud save" on public.pilot_saves;
create policy "Pilots can create own cloud save"
on public.pilot_saves for insert
to authenticated
with check (auth.uid() = pilot_id);

drop policy if exists "Pilots can update own cloud save" on public.pilot_saves;
create policy "Pilots can update own cloud save"
on public.pilot_saves for update
to authenticated
using (auth.uid() = pilot_id)
with check (auth.uid() = pilot_id);

revoke all on public.pilot_saves from anon;
grant select, insert, update on public.pilot_saves to authenticated;
