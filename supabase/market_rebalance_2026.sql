-- MiniSpace market rebalance migration
-- Run once in the Supabase SQL Editor after market_pool.sql.
-- Aligns existing live market rows with Market.js and the game's new rarity progression.

update public.market_items
set base_price = case item_key
  when 'veldspar' then 100
  when 'scordite' then 250
  when 'pyroxeres' then 500
  when 'omber' then 1000
  when 'debris_t1' then 2500
  when 'debris_t2' then 10000
  when 'debris_t3' then 40000
  when 'debris_t4' then 150000
  when 'debris_t5' then 500000
  else base_price
end
where item_key in (
  'veldspar','scordite','pyroxeres','omber',
  'debris_t1','debris_t2','debris_t3','debris_t4','debris_t5'
);

-- Recalculate current quotes from the new base prices and existing market supply.
do $$
declare
  v_key text;
begin
  for v_key in
    select item_key from public.market_items
    where item_key in (
      'veldspar','scordite','pyroxeres','omber',
      'debris_t1','debris_t2','debris_t3','debris_t4','debris_t5'
    )
  loop
    perform public.market_reprice(v_key);
  end loop;
end;
$$;
