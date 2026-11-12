-- MiniSpace: player-initiated hangar sales delivered by the Corporation Transport Manager.
-- Run once in Supabase SQL Editor after market_pool.sql, market_hangars.sql,
-- market_game_sync.sql and market_corp_supply.sql.
-- The Transport Manager earns a 10% commission on completed sales.

create table if not exists public.market_transport_sales (
  pilot_id uuid not null references auth.users(id) on delete cascade,
  shipment_id text not null,
  items jsonb not null,
  status text not null default 'reserved' check (status in ('reserved','completed')),
  gross bigint not null default 0 check (gross >= 0),
  fee bigint not null default 0 check (fee >= 0),
  net bigint not null default 0 check (net >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (pilot_id, shipment_id)
);

alter table public.market_transport_sales enable row level security;
revoke all on public.market_transport_sales from public, anon, authenticated;

create or replace function public.market_reserve_transport_sale(p_shipment_id text,p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pilot uuid := auth.uid();
  v_entry record;
  v_qty bigint;
  v_existing public.market_transport_sales%rowtype;
  v_inserted integer;
begin
  if v_pilot is null then raise exception 'Pilot login required'; end if;
  if p_shipment_id is null or length(p_shipment_id) < 8 or length(p_shipment_id) > 128 then raise exception 'Invalid shipment ID'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'object' or not exists (select 1 from jsonb_each(p_items)) then raise exception 'Invalid or empty shipment'; end if;

  insert into public.market_transport_sales(pilot_id,shipment_id,items,status)
  values(v_pilot,p_shipment_id,p_items,'reserved')
  on conflict(pilot_id,shipment_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select * into v_existing from public.market_transport_sales where pilot_id=v_pilot and shipment_id=p_shipment_id;
    if v_existing.items <> p_items then raise exception 'Shipment ID already belongs to different goods'; end if;
    return jsonb_build_object('success',true,'alreadyReserved',true,'status',v_existing.status,'items',v_existing.items);
  end if;

  for v_entry in select key,value from jsonb_each(p_items) order by key loop
    if v_entry.key not in ('veldspar','scordite','pyroxeres','omber','debris_t1','debris_t2','debris_t3','debris_t4','debris_t5')
       or jsonb_typeof(v_entry.value) <> 'number' then raise exception 'Invalid shipment item'; end if;
    if (v_entry.value #>> '{}')::numeric <> trunc((v_entry.value #>> '{}')::numeric)
       or (v_entry.value #>> '{}')::numeric < 1
       or (v_entry.value #>> '{}')::numeric > 1000000 then raise exception 'Invalid shipment quantity'; end if;
    v_qty := (v_entry.value #>> '{}')::bigint;
    update public.pilot_hangars set quantity=quantity-v_qty,updated_at=now()
    where pilot_id=v_pilot and station_id='private_highsec' and item_key=v_entry.key and quantity>=v_qty;
    if not found then raise exception 'Not enough items in Private High-Sec hangar: %', v_entry.key; end if;
  end loop;
  return jsonb_build_object('success',true,'alreadyReserved',false,'status','reserved','items',p_items);
end;
$$;

create or replace function public.market_complete_transport_sale(p_shipment_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pilot uuid := auth.uid();
  v_sale public.market_transport_sales%rowtype;
  v_entry record;
  v_item public.market_items%rowtype;
  v_qty bigint;
  v_gross bigint := 0;
  v_fee bigint := 0;
  v_net bigint := 0;
begin
  if v_pilot is null then raise exception 'Pilot login required'; end if;
  if p_shipment_id is null or length(p_shipment_id) < 8 or length(p_shipment_id) > 128 then raise exception 'Invalid shipment ID'; end if;
  select * into v_sale from public.market_transport_sales where pilot_id=v_pilot and shipment_id=p_shipment_id for update;
  if not found then raise exception 'Reserved transport sale not found'; end if;
  if v_sale.status='completed' then
    return jsonb_build_object('success',true,'alreadyCompleted',true,'gross',v_sale.gross,'fee',v_sale.fee,'net',v_sale.net,'items',v_sale.items);
  end if;

  for v_entry in select key,value from jsonb_each(v_sale.items) order by key loop
    v_qty := (v_entry.value #>> '{}')::bigint;
    select * into v_item from public.market_items where item_key=v_entry.key for update;
    if not found then raise exception 'Unknown market item: %', v_entry.key; end if;
    v_gross := v_gross + (v_item.unit_price * v_qty);
    update public.market_items set player_stock=player_stock+v_qty,player_volume=player_volume+v_qty,updated_at=now()
    where item_key=v_entry.key;
    insert into public.market_transactions(pilot_id,item_key,side,quantity,unit_price,total_isk)
    values(v_pilot,v_entry.key,'sell',v_qty,v_item.unit_price,v_item.unit_price*v_qty);
    perform public.market_reprice(v_entry.key);
  end loop;

  v_fee := floor(v_gross * 0.10)::bigint;
  v_net := v_gross - v_fee;
  update public.pilot_wallets set isk=isk+v_net,updated_at=now() where pilot_id=v_pilot;
  if not found then raise exception 'Pilot wallet not found'; end if;
  update public.market_transport_sales set status='completed',gross=v_gross,fee=v_fee,net=v_net,completed_at=now()
  where pilot_id=v_pilot and shipment_id=p_shipment_id;
  return jsonb_build_object('success',true,'alreadyCompleted',false,'gross',v_gross,'fee',v_fee,'net',v_net,'items',v_sale.items);
end;
$$;

revoke all on function public.market_reserve_transport_sale(text,jsonb) from public,anon;
revoke all on function public.market_complete_transport_sale(text) from public,anon;
grant execute on function public.market_reserve_transport_sale(text,jsonb) to authenticated;
grant execute on function public.market_complete_transport_sale(text) to authenticated;
