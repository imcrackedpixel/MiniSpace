-- MiniSpace GM access and starter tools.
-- Run once in Supabase SQL Editor after the existing market/hangar migrations.
-- The GM account is assigned by email, but stored by immutable Supabase user ID.
-- Only the account matching this email receives GM access.

create table if not exists public.minispace_gm_accounts (
  pilot_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.minispace_gm_accounts enable row level security;
revoke all on public.minispace_gm_accounts from anon, authenticated;

do $$
declare
  v_pilot_id uuid;
begin
  select id into v_pilot_id
  from auth.users
  where lower(email) = lower('Mathewhawk12@gmail.com')
  limit 1;

  if v_pilot_id is null then
    raise exception 'GM account email was not found in auth.users. Check the email used to register MiniSpace.';
  end if;

  insert into public.minispace_gm_accounts(pilot_id)
  values (v_pilot_id)
  on conflict (pilot_id) do nothing;
end;
$$;

create or replace function public.gm_is_authorized()
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.minispace_gm_accounts where pilot_id = auth.uid());
$$;

create or replace function public.gm_grant_scrap_metals(p_amount bigint)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_pilot uuid := auth.uid();
begin
  if v_pilot is null or not exists (select 1 from public.minispace_gm_accounts where pilot_id = v_pilot)
    then raise exception 'GM access required'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 1000000000000
    then raise exception 'Enter a valid Scrap Metals amount'; end if;
  update public.pilot_wallets set isk = isk + p_amount, updated_at = now() where pilot_id = v_pilot;
  if not found then raise exception 'Pilot wallet not found'; end if;
  return jsonb_build_object('success', true, 'amount', p_amount);
end;
$$;

create or replace function public.gm_grant_item(p_item_key text, p_quantity bigint)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_pilot uuid := auth.uid();
begin
  if v_pilot is null or not exists (select 1 from public.minispace_gm_accounts where pilot_id = v_pilot)
    then raise exception 'GM access required'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 1000000000
    then raise exception 'Enter a valid item quantity'; end if;
  if p_item_key not in ('veldspar','scordite','pyroxeres','omber','debris_t1','debris_t2','debris_t3','debris_t4','debris_t5')
    then raise exception 'Unknown item'; end if;
  insert into public.pilot_hangars(pilot_id, station_id, item_key, quantity)
  values(v_pilot, 'private_highsec', p_item_key, p_quantity)
  on conflict(pilot_id, station_id, item_key)
  do update set quantity = public.pilot_hangars.quantity + excluded.quantity, updated_at = now();
  return jsonb_build_object('success', true, 'item', p_item_key, 'quantity', p_quantity);
end;
$$;

revoke all on function public.gm_is_authorized() from public, anon;
revoke all on function public.gm_grant_scrap_metals(bigint) from public, anon;
revoke all on function public.gm_grant_item(text,bigint) from public, anon;
grant execute on function public.gm_is_authorized() to authenticated;
grant execute on function public.gm_grant_scrap_metals(bigint) to authenticated;
grant execute on function public.gm_grant_item(text,bigint) to authenticated;
