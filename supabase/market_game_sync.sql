-- MiniSpace game-economy bridge
-- Run once in Supabase SQL Editor after market_hangars.sql.
-- The authenticated game syncs its current wallet/private hangar snapshot here;
-- market buys, sells and transfers then operate on the same database records.

alter table public.pilot_wallets
  add column if not exists game_state_synced boolean not null default false;

create or replace function public.market_sync_game_state(
  p_isk bigint,
  p_inventory jsonb,
  p_bootstrap boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pilot uuid := auth.uid();
  v_synced boolean;
  v_entry record;
  v_qty bigint;
begin
  if v_pilot is null then raise exception 'Pilot login required'; end if;
  if p_inventory is not null and jsonb_typeof(p_inventory) <> 'object' then
    raise exception 'Invalid private hangar inventory';
  end if;

  insert into public.pilot_wallets(pilot_id,isk)
  values(v_pilot,0)
  on conflict(pilot_id) do nothing;

  select game_state_synced into v_synced
  from public.pilot_wallets
  where pilot_id=v_pilot
  for update;

  -- Bootstrap exactly once from the latest cloud save. Later calls are normal
  -- save snapshots and intentionally keep the game's wallet/hangar mirrored.
  if p_bootstrap and v_synced then
    return jsonb_build_object('success',true,'skipped',true);
  end if;

  -- A brand-new pilot may not have a local save yet. Preserve the starter
  -- wallet and any existing hangar contents, but mark the bridge as ready.
  if p_bootstrap and p_isk is null and p_inventory is null then
    update public.pilot_wallets
    set game_state_synced=true, updated_at=now()
    where pilot_id=v_pilot;
    return jsonb_build_object('success',true,'skipped',false,'preservedStarterWallet',true);
  end if;

  if p_isk is null or p_isk < 0 or p_isk > 9000000000000000 then
    raise exception 'Invalid game wallet';
  end if;

  update public.pilot_wallets
  set isk=p_isk, game_state_synced=true, updated_at=now()
  where pilot_id=v_pilot;

  delete from public.pilot_hangars
  where pilot_id=v_pilot and station_id='private_highsec';

  if p_inventory is not null then
    for v_entry in select key,value from jsonb_each(p_inventory)
    loop
      if v_entry.key in (
        'veldspar','scordite','pyroxeres','omber',
        'debris_t1','debris_t2','debris_t3','debris_t4','debris_t5'
      ) and jsonb_typeof(v_entry.value)='number' then
        v_qty := greatest(0,least(1000000000000,
          floor((v_entry.value #>> '{}')::numeric))::bigint);
        if v_qty>0 then
          insert into public.pilot_hangars(pilot_id,station_id,item_key,quantity)
          values(v_pilot,'private_highsec',v_entry.key,v_qty);
        end if;
      end if;
    end loop;
  end if;

  return jsonb_build_object('success',true,'skipped',false);
end;
$$;

revoke all on function public.market_sync_game_state(bigint,jsonb,boolean) from public,anon;
grant execute on function public.market_sync_game_state(bigint,jsonb,boolean) to authenticated;
