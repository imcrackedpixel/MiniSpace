-- MiniSpace GM administration commands.
-- Run once in Supabase SQL Editor after gm_setup.sql and the market/hangar migrations.
-- All target-player actions are restricted to the private GM account table.

create table if not exists public.minispace_gm_bans (
  pilot_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null default 'Banned by a Game Master',
  banned_by uuid references auth.users(id) on delete set null,
  banned_at timestamptz not null default now()
);

alter table public.minispace_gm_bans enable row level security;
revoke all on public.minispace_gm_bans from anon, authenticated;

create or replace function public.gm_admin_account_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ban public.minispace_gm_bans%rowtype;
begin
  if auth.uid() is null then raise exception 'Pilot login required'; end if;
  select * into v_ban from public.minispace_gm_bans where pilot_id=auth.uid();
  if found then
    return jsonb_build_object('banned',true,'reason',v_ban.reason,'bannedAt',v_ban.banned_at);
  end if;
  return jsonb_build_object('banned',false);
end;
$$;

create or replace function public.gm_admin_inspect(p_pilot_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target uuid;
  v_save jsonb;
  v_wallet bigint;
  v_hangars jsonb;
  v_matches integer;
  v_name text;
  v_ban public.minispace_gm_bans%rowtype;
begin
  if auth.uid() is null or not exists(select 1 from public.minispace_gm_accounts where pilot_id=auth.uid()) then
    raise exception 'GM access required';
  end if;
  if nullif(trim(p_pilot_name),'') is null then raise exception 'Enter a pilot callsign'; end if;

  select count(*) into v_matches
  from public.pilot_saves
  where lower(trim(coalesce(save_data #>> '{playerData,pilotName}',''))) = lower(trim(p_pilot_name));
  if v_matches=0 then raise exception 'Pilot not found. The pilot must have saved at least once.'; end if;
  if v_matches>1 then raise exception 'More than one pilot has that callsign. Use a unique callsign.'; end if;

  select pilot_id,save_data into v_target,v_save
  from public.pilot_saves
  where lower(trim(coalesce(save_data #>> '{playerData,pilotName}',''))) = lower(trim(p_pilot_name))
  limit 1;
  v_name:=coalesce(v_save #>> '{playerData,pilotName}',p_pilot_name);
  select isk into v_wallet from public.pilot_wallets where pilot_id=v_target;
  select coalesce(jsonb_agg(jsonb_build_object(
    'stationId',station_id,'itemKey',item_key,'quantity',quantity
  ) order by station_id,item_key),'[]'::jsonb)
  into v_hangars from public.pilot_hangars where pilot_id=v_target;
  select * into v_ban from public.minispace_gm_bans where pilot_id=v_target;

  return jsonb_build_object(
    'pilotId',v_target,
    'pilotName',v_name,
    'playerData',coalesce(v_save->'playerData','{}'::jsonb),
    'wallet',coalesce(v_wallet,0),
    'hangars',coalesce(v_hangars,'[]'::jsonb),
    'banned',found,
    'banReason',case when found then v_ban.reason else null end
  );
end;
$$;

create or replace function public.gm_admin_ban(p_pilot_name text,p_reason text default 'Banned by a Game Master')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target uuid;
  v_matches integer;
  v_reason text:=left(coalesce(nullif(trim(p_reason),''),'Banned by a Game Master'),240);
begin
  if auth.uid() is null or not exists(select 1 from public.minispace_gm_accounts where pilot_id=auth.uid()) then
    raise exception 'GM access required';
  end if;
  select count(*) into v_matches from public.pilot_saves
  where lower(trim(coalesce(save_data #>> '{playerData,pilotName}',''))) = lower(trim(p_pilot_name));
  if v_matches=0 then raise exception 'Pilot not found'; end if;
  if v_matches>1 then raise exception 'Callsign is not unique'; end if;
  select pilot_id into v_target from public.pilot_saves
  where lower(trim(coalesce(save_data #>> '{playerData,pilotName}',''))) = lower(trim(p_pilot_name))
  limit 1;
  if v_target=auth.uid() then raise exception 'You cannot ban your own GM account'; end if;
  insert into public.minispace_gm_bans(pilot_id,reason,banned_by)
  values(v_target,v_reason,auth.uid())
  on conflict(pilot_id) do update set reason=excluded.reason,banned_by=excluded.banned_by,banned_at=now();
  return jsonb_build_object('success',true,'pilotId',v_target,'pilotName',trim(p_pilot_name),'reason',v_reason);
end;
$$;

create or replace function public.gm_admin_unban(p_pilot_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target uuid;
  v_matches integer;
begin
  if auth.uid() is null or not exists(select 1 from public.minispace_gm_accounts where pilot_id=auth.uid()) then
    raise exception 'GM access required';
  end if;
  select count(*) into v_matches from public.pilot_saves
  where lower(trim(coalesce(save_data #>> '{playerData,pilotName}',''))) = lower(trim(p_pilot_name));
  if v_matches=0 then raise exception 'Pilot not found'; end if;
  if v_matches>1 then raise exception 'Callsign is not unique'; end if;
  select pilot_id into v_target from public.pilot_saves
  where lower(trim(coalesce(save_data #>> '{playerData,pilotName}',''))) = lower(trim(p_pilot_name))
  limit 1;
  delete from public.minispace_gm_bans where pilot_id=v_target;
  return jsonb_build_object('success',true,'pilotId',v_target,'pilotName',trim(p_pilot_name));
end;
$$;

create or replace function public.gm_admin_adjust_wallet(p_pilot_name text,p_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target uuid;
  v_matches integer;
  v_balance bigint;
begin
  if auth.uid() is null or not exists(select 1 from public.minispace_gm_accounts where pilot_id=auth.uid()) then
    raise exception 'GM access required';
  end if;
  if p_amount is null or p_amount=0 or abs(p_amount)>1000000000000 then raise exception 'Invalid wallet adjustment'; end if;
  select count(*) into v_matches from public.pilot_saves
  where lower(trim(coalesce(save_data #>> '{playerData,pilotName}',''))) = lower(trim(p_pilot_name));
  if v_matches=0 then raise exception 'Pilot not found'; end if;
  if v_matches>1 then raise exception 'Callsign is not unique'; end if;
  select pilot_id into v_target from public.pilot_saves
  where lower(trim(coalesce(save_data #>> '{playerData,pilotName}',''))) = lower(trim(p_pilot_name))
  limit 1;
  update public.pilot_wallets set isk=isk+p_amount,updated_at=now()
  where pilot_id=v_target and isk+p_amount>=0
  returning isk into v_balance;
  if not found then raise exception 'Wallet not found or insufficient balance'; end if;
  update public.pilot_saves set
    save_data=jsonb_set(save_data,'{playerData,isk}',to_jsonb(v_balance),true),
    updated_at=now()
  where pilot_id=v_target;
  return jsonb_build_object('success',true,'pilotId',v_target,'wallet',v_balance,'change',p_amount);
end;
$$;

create or replace function public.gm_admin_adjust_item(
  p_pilot_name text,p_item_key text,p_quantity bigint,p_station_id text default 'private_highsec'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target uuid;
  v_matches integer;
  v_new_quantity bigint;
  v_old_quantity bigint;
begin
  if auth.uid() is null or not exists(select 1 from public.minispace_gm_accounts where pilot_id=auth.uid()) then
    raise exception 'GM access required';
  end if;
  if p_quantity is null or p_quantity=0 or abs(p_quantity)>1000000000 then raise exception 'Invalid item quantity'; end if;
  if p_item_key not in ('veldspar','scordite','pyroxeres','omber','debris_t1','debris_t2','debris_t3','debris_t4','debris_t5') then
    raise exception 'Unknown item';
  end if;
  if p_station_id not in ('private_highsec','trade_hub') then raise exception 'Unknown hangar'; end if;
  select count(*) into v_matches from public.pilot_saves
  where lower(trim(coalesce(save_data #>> '{playerData,pilotName}',''))) = lower(trim(p_pilot_name));
  if v_matches=0 then raise exception 'Pilot not found'; end if;
  if v_matches>1 then raise exception 'Callsign is not unique'; end if;
  select pilot_id into v_target from public.pilot_saves
  where lower(trim(coalesce(save_data #>> '{playerData,pilotName}',''))) = lower(trim(p_pilot_name))
  limit 1;

  select quantity into v_old_quantity from public.pilot_hangars
  where pilot_id=v_target and station_id=p_station_id and item_key=p_item_key
  for update;
  v_old_quantity:=coalesce(v_old_quantity,0);
  if p_quantity<0 and v_old_quantity < -p_quantity then raise exception 'Pilot does not have enough of that item'; end if;

  insert into public.pilot_hangars(pilot_id,station_id,item_key,quantity)
  values(v_target,p_station_id,p_item_key,greatest(0,v_old_quantity+p_quantity))
  on conflict(pilot_id,station_id,item_key)
  do update set quantity=greatest(0,public.pilot_hangars.quantity+p_quantity),updated_at=now()
  returning quantity into v_new_quantity;

  if p_station_id='private_highsec' then
    update public.pilot_saves set
      save_data=jsonb_set(
        save_data,
        array['playerData','stationOre',p_item_key],
        to_jsonb(greatest(0,coalesce((save_data #>> array['playerData','stationOre',p_item_key])::bigint,0)+p_quantity)),
        true
      ),
      updated_at=now()
    where pilot_id=v_target;
  end if;
  return jsonb_build_object('success',true,'pilotId',v_target,'item',p_item_key,'stationId',p_station_id,'quantity',v_new_quantity,'change',p_quantity);
end;
$$;

revoke all on function public.gm_admin_account_status() from public,anon;
revoke all on function public.gm_admin_inspect(text) from public,anon;
revoke all on function public.gm_admin_ban(text,text) from public,anon;
revoke all on function public.gm_admin_unban(text) from public,anon;
revoke all on function public.gm_admin_adjust_wallet(text,bigint) from public,anon;
revoke all on function public.gm_admin_adjust_item(text,text,bigint,text) from public,anon;

grant execute on function public.gm_admin_account_status() to authenticated;
grant execute on function public.gm_admin_inspect(text) to authenticated;
grant execute on function public.gm_admin_ban(text,text) to authenticated;
grant execute on function public.gm_admin_unban(text) to authenticated;
grant execute on function public.gm_admin_adjust_wallet(text,bigint) to authenticated;
grant execute on function public.gm_admin_adjust_item(text,text,bigint,text) to authenticated;
