-- MiniSpace: separate private and Trade Hub hangars.
-- Run after market_pool.sql in Supabase SQL Editor.

create table if not exists public.pilot_hangars (
  pilot_id uuid not null references auth.users(id) on delete cascade,
  station_id text not null check (station_id in ('private_highsec','trade_hub')),
  item_key text not null references public.market_items(item_key),
  quantity bigint not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (pilot_id, station_id, item_key)
);

alter table public.pilot_hangars enable row level security;
drop policy if exists "Pilots can read own hangars" on public.pilot_hangars;
create policy "Pilots can read own hangars"
on public.pilot_hangars for select to authenticated
using (auth.uid() = pilot_id);
revoke insert, update, delete on public.pilot_hangars from anon, authenticated;
grant select on public.pilot_hangars to authenticated;

-- Import the existing browser save once, into the PRIVATE hangar.
create or replace function public.market_import_legacy_save(
  p_isk bigint,
  p_inventory jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pilot uuid := auth.uid();
  v_entry record;
  v_qty bigint;
begin
  if v_pilot is null then raise exception 'Pilot login required'; end if;
  if p_isk is null or p_isk < 0 or p_isk > 9000000000000000 then
    raise exception 'Invalid legacy wallet';
  end if;

  insert into public.pilot_wallets(pilot_id,isk)
  values(v_pilot,1000000) on conflict(pilot_id) do nothing;

  perform 1 from public.pilot_wallets where pilot_id=v_pilot for update;
  if (select legacy_imported from public.pilot_wallets where pilot_id=v_pilot) then
    return jsonb_build_object('success',true,'alreadyImported',true);
  end if;

  update public.pilot_wallets
  set isk=p_isk, legacy_imported=true, updated_at=now()
  where pilot_id=v_pilot;

  if p_inventory is not null and jsonb_typeof(p_inventory)='object' then
    for v_entry in select key,value from jsonb_each(p_inventory)
    loop
      if v_entry.key in ('veldspar','scordite','pyroxeres','omber',
        'debris_t1','debris_t2','debris_t3','debris_t4','debris_t5')
        and jsonb_typeof(v_entry.value)='number' then
        v_qty := greatest(0,least(1000000000000,(v_entry.value #>> '{}')::numeric)::bigint);
        if v_qty>0 then
          insert into public.pilot_hangars(pilot_id,station_id,item_key,quantity)
          values(v_pilot,'private_highsec',v_entry.key,v_qty)
          on conflict(pilot_id,station_id,item_key)
          do update set quantity=excluded.quantity,updated_at=now();
        end if;
      end if;
    end loop;
  end if;
  return jsonb_build_object('success',true,'alreadyImported',false);
end;
$$;

-- Buy goods into the Trade Hub hangar.
create or replace function public.market_buy(p_item_key text,p_quantity bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pilot uuid := auth.uid();
  v_item public.market_items%rowtype;
  v_stock bigint;
  v_npc_cap bigint;
  v_npc_add bigint := 0;
  v_total bigint;
  v_price bigint;
begin
  if v_pilot is null then raise exception 'Pilot login required'; end if;
  if p_quantity is null or p_quantity<1 or p_quantity>1000000 then raise exception 'Invalid quantity'; end if;

  select * into v_item from public.market_items where item_key=p_item_key for update;
  if not found then raise exception 'Unknown market item'; end if;

  v_npc_cap:=greatest(10,floor(v_item.player_volume*0.10)::bigint);
  if v_item.npc_volume<v_npc_cap then
    v_npc_add:=least(greatest(0,p_quantity-v_item.player_stock-v_item.npc_stock),v_npc_cap-v_item.npc_volume);
    if v_npc_add>0 then
      update public.market_items set npc_stock=npc_stock+v_npc_add,npc_volume=npc_volume+v_npc_add where item_key=p_item_key;
      insert into public.market_transactions(pilot_id,item_key,side,quantity,unit_price,total_isk)
      values(v_pilot,p_item_key,'bot_supply',v_npc_add,v_item.base_price,0);
    end if;
    select * into v_item from public.market_items where item_key=p_item_key;
  end if;

  v_stock:=v_item.player_stock+v_item.npc_stock;
  if v_stock<p_quantity then raise exception 'Not enough stock in the shared market'; end if;
  v_price:=v_item.unit_price;
  v_total:=v_price*p_quantity;

  update public.pilot_wallets set isk=isk-v_total,updated_at=now()
  where pilot_id=v_pilot and isk>=v_total;
  if not found then raise exception 'Not enough ISK'; end if;

  update public.market_items
  set player_stock=player_stock-least(player_stock,p_quantity),
      npc_stock=npc_stock-greatest(0,p_quantity-player_stock),
      updated_at=now()
  where item_key=p_item_key;

  insert into public.pilot_hangars(pilot_id,station_id,item_key,quantity)
  values(v_pilot,'trade_hub',p_item_key,p_quantity)
  on conflict(pilot_id,station_id,item_key)
  do update set quantity=public.pilot_hangars.quantity+excluded.quantity,updated_at=now();

  insert into public.market_transactions(pilot_id,item_key,side,quantity,unit_price,total_isk)
  values(v_pilot,p_item_key,'buy',p_quantity,v_price,v_total);
  perform public.market_reprice(p_item_key);
  return jsonb_build_object('success',true,'quantity',p_quantity,'unitPrice',v_price,'total',v_total);
end;
$$;

-- Sell only goods physically in the Trade Hub hangar.
create or replace function public.market_sell(p_item_key text,p_quantity bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pilot uuid := auth.uid();
  v_item public.market_items%rowtype;
  v_price bigint;
  v_total bigint;
begin
  if v_pilot is null then raise exception 'Pilot login required'; end if;
  if p_quantity is null or p_quantity<1 or p_quantity>1000000 then raise exception 'Invalid quantity'; end if;

  select * into v_item from public.market_items where item_key=p_item_key for update;
  if not found then raise exception 'Unknown market item'; end if;

  update public.pilot_hangars
  set quantity=quantity-p_quantity,updated_at=now()
  where pilot_id=v_pilot and station_id='trade_hub'
    and item_key=p_item_key and quantity>=p_quantity;
  if not found then raise exception 'Not enough items in Trade Hub hangar'; end if;

  v_price:=v_item.unit_price;
  v_total:=v_price*p_quantity;

  update public.market_items
  set player_stock=player_stock+p_quantity,
      player_volume=player_volume+p_quantity,
      updated_at=now()
  where item_key=p_item_key;

  update public.pilot_wallets set isk=isk+v_total,updated_at=now() where pilot_id=v_pilot;
  insert into public.market_transactions(pilot_id,item_key,side,quantity,unit_price,total_isk)
  values(v_pilot,p_item_key,'sell',p_quantity,v_price,v_total);
  perform public.market_reprice(p_item_key);
  return jsonb_build_object('success',true,'quantity',p_quantity,'unitPrice',v_price,'total',v_total);
end;
$$;

-- Move items from the private station into the Trade Hub; no wallet change.
create or replace function public.market_transfer_to_trade(p_item_key text,p_quantity bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_pilot uuid:=auth.uid();
begin
  if v_pilot is null then raise exception 'Pilot login required'; end if;
  if p_quantity is null or p_quantity<1 or p_quantity>1000000 then raise exception 'Invalid quantity'; end if;

  update public.pilot_hangars
  set quantity=quantity-p_quantity,updated_at=now()
  where pilot_id=v_pilot and station_id='private_highsec'
    and item_key=p_item_key and quantity>=p_quantity;
  if not found then raise exception 'Not enough items in Private High-Sec hangar'; end if;

  insert into public.pilot_hangars(pilot_id,station_id,item_key,quantity)
  values(v_pilot,'trade_hub',p_item_key,p_quantity)
  on conflict(pilot_id,station_id,item_key)
  do update set quantity=public.pilot_hangars.quantity+excluded.quantity,updated_at=now();

  return jsonb_build_object('success',true,'quantity',p_quantity);
end;
$$;

revoke all on function public.market_import_legacy_save(bigint,jsonb) from public,anon;
revoke all on function public.market_buy(text,bigint) from public,anon;
revoke all on function public.market_sell(text,bigint) from public,anon;
revoke all on function public.market_transfer_to_trade(text,bigint) from public,anon;
grant execute on function public.market_import_legacy_save(bigint,jsonb) to authenticated;
grant execute on function public.market_buy(text,bigint) to authenticated;
grant execute on function public.market_sell(text,bigint) to authenticated;
grant execute on function public.market_transfer_to_trade(text,bigint) to authenticated;
