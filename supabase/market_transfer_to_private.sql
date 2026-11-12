-- Move purchased or stored Trade Hub goods back to the Private High-Sec hangar.
-- Run once in Supabase SQL Editor.

create or replace function public.market_transfer_to_private(p_item_key text,p_quantity bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pilot uuid := auth.uid();
begin
  if v_pilot is null then raise exception 'Pilot login required'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 1000000 then
    raise exception 'Invalid quantity';
  end if;
  if not exists (select 1 from public.market_items where item_key = p_item_key) then
    raise exception 'Unknown market item';
  end if;

  update public.pilot_hangars
  set quantity = quantity - p_quantity, updated_at = now()
  where pilot_id = v_pilot and station_id = 'trade_hub'
    and item_key = p_item_key and quantity >= p_quantity;
  if not found then raise exception 'Not enough items in Trade Hub hangar'; end if;

  insert into public.pilot_hangars(pilot_id,station_id,item_key,quantity)
  values(v_pilot,'private_highsec',p_item_key,p_quantity)
  on conflict(pilot_id,station_id,item_key)
  do update set quantity = public.pilot_hangars.quantity + excluded.quantity,
                updated_at = now();

  return jsonb_build_object('success',true,'quantity',p_quantity);
end;
$$;

revoke all on function public.market_transfer_to_private(text,bigint) from public,anon;
grant execute on function public.market_transfer_to_private(text,bigint) to authenticated;
