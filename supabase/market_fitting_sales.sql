-- MiniSpace: fitting-drop supply through the Transport Manager.
-- Run once in Supabase SQL Editor AFTER market_pool.sql and market_transport_sales.sql.
-- Fitting drops live in the game's moduleDrops hangar rather than pilot_hangars,
-- so the client removes only drops belonging to shipments the RPC accepted.

insert into public.market_items
  (item_key,display_name,unit_price,stock,bot_stock,base_price,player_stock,npc_stock,player_volume,npc_volume,target_stock)
values
  ('fitting_white','White Fitting Salvage',250000,0,0,250000,0,0,0,0,100),
  ('fitting_green','Green Fitting Salvage',1250000,0,0,1250000,0,0,0,0,100),
  ('fitting_blue','Blue Fitting Salvage',6000000,0,0,6000000,0,0,0,0,100),
  ('fitting_purple','Purple Fitting Salvage',25000000,0,0,25000000,0,0,0,0,100)
on conflict (item_key) do update
set display_name=excluded.display_name,
    base_price=excluded.base_price,
    target_stock=excluded.target_stock;

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
    if v_entry.key not in (
      'veldspar','scordite','pyroxeres','omber',
      'debris_t1','debris_t2','debris_t3','debris_t4','debris_t5',
      'fitting_white','fitting_green','fitting_blue','fitting_purple'
    ) or jsonb_typeof(v_entry.value) <> 'number' then
      raise exception 'Invalid shipment item';
    end if;
    if (v_entry.value #>> '{}')::numeric <> trunc((v_entry.value #>> '{}')::numeric)
       or (v_entry.value #>> '{}')::numeric < 1
       or (v_entry.value #>> '{}')::numeric > 1000000 then
      raise exception 'Invalid shipment quantity';
    end if;
    v_qty := (v_entry.value #>> '{}')::bigint;

    -- Ore/components are reserved from the cloud hangar. Fitting drops are
    -- held in moduleDrops locally and removed by the client after this reservation succeeds.
    if v_entry.key not in ('fitting_white','fitting_green','fitting_blue','fitting_purple') then
      update public.pilot_hangars set quantity=quantity-v_qty,updated_at=now()
      where pilot_id=v_pilot and station_id='private_highsec' and item_key=v_entry.key and quantity>=v_qty;
      if not found then raise exception 'Not enough items in Private High-Sec hangar: %', v_entry.key; end if;
    end if;
  end loop;
  return jsonb_build_object('success',true,'alreadyReserved',false,'status','reserved','items',p_items);
end;
$$;

revoke all on function public.market_reserve_transport_sale(text,jsonb) from public,anon;
grant execute on function public.market_reserve_transport_sale(text,jsonb) to authenticated;
