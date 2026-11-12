-- Corporation Transport Manager: add full shipments to the shared player market.
-- Run once in Supabase SQL Editor AFTER market_pool.sql, market_hangars.sql,
-- market_game_sync.sql, and market_transfer_to_private.sql.

create table if not exists public.market_corp_shipments (
  pilot_id uuid not null references auth.users(id) on delete cascade,
  shipment_id text not null,
  proceeds bigint not null default 0 check (proceeds >= 0),
  items jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (pilot_id, shipment_id)
);

alter table public.market_corp_shipments enable row level security;
revoke all on public.market_corp_shipments from public, anon, authenticated;

create or replace function public.market_corp_supply(
  p_shipment_id text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pilot uuid := auth.uid();
  v_entry record;
  v_item public.market_items%rowtype;
  v_qty bigint;
  v_total bigint;
  v_proceeds bigint := 0;
  v_recorded_items jsonb := '{}'::jsonb;
  v_inserted integer;
  v_existing public.market_corp_shipments%rowtype;
begin
  if v_pilot is null then raise exception 'Pilot login required'; end if;
  if p_shipment_id is null or length(p_shipment_id) < 8 or length(p_shipment_id) > 128 then
    raise exception 'Invalid shipment ID';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'object' then
    raise exception 'Invalid shipment contents';
  end if;

  -- Reserve the shipment ID first. Concurrent retries wait for the first
  -- transaction and then return its saved result instead of adding stock twice.
  insert into public.market_corp_shipments(pilot_id, shipment_id)
  values (v_pilot, p_shipment_id)
  on conflict (pilot_id, shipment_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select * into v_existing
    from public.market_corp_shipments
    where pilot_id = v_pilot and shipment_id = p_shipment_id;
    return jsonb_build_object(
      'success', true,
      'alreadyProcessed', true,
      'proceeds', v_existing.proceeds,
      'items', v_existing.items
    );
  end if;

  if not exists (select 1 from jsonb_each(p_items)) then
    raise exception 'Shipment is empty';
  end if;

  for v_entry in
    select key, value from jsonb_each(p_items) order by key
  loop
    if v_entry.key not in (
      'veldspar','scordite','pyroxeres','omber',
      'debris_t1','debris_t2','debris_t3','debris_t4','debris_t5'
    ) or jsonb_typeof(v_entry.value) <> 'number' then
      raise exception 'Invalid shipment item';
    end if;

    if (v_entry.value #>> '{}')::numeric <> trunc((v_entry.value #>> '{}')::numeric)
       or (v_entry.value #>> '{}')::numeric < 1
       or (v_entry.value #>> '{}')::numeric > 1000000 then
      raise exception 'Invalid shipment quantity';
    end if;
    v_qty := (v_entry.value #>> '{}')::bigint;

    select * into v_item
    from public.market_items
    where item_key = v_entry.key
    for update;
    if not found then raise exception 'Unknown market item'; end if;

    v_total := v_item.unit_price * v_qty;
    if v_total < 0 or v_total > 9000000000000000 then
      raise exception 'Shipment value is out of range';
    end if;

    update public.market_items
    set player_stock = player_stock + v_qty,
        player_volume = player_volume + v_qty,
        updated_at = now()
    where item_key = v_entry.key;

    insert into public.market_transactions(
      pilot_id, item_key, side, quantity, unit_price, total_isk
    ) values (
      v_pilot, v_entry.key, 'sell', v_qty, v_item.unit_price, v_total
    );

    perform public.market_reprice(v_entry.key);
    v_proceeds := v_proceeds + v_total;
    v_recorded_items := v_recorded_items || jsonb_build_object(v_entry.key, v_qty);
  end loop;

  update public.market_corp_shipments
  set proceeds = v_proceeds, items = v_recorded_items
  where pilot_id = v_pilot and shipment_id = p_shipment_id;

  return jsonb_build_object(
    'success', true,
    'alreadyProcessed', false,
    'proceeds', v_proceeds,
    'items', v_recorded_items
  );
end;
$$;

revoke all on function public.market_corp_supply(text,jsonb) from public, anon;
grant execute on function public.market_corp_supply(text,jsonb) to authenticated;
