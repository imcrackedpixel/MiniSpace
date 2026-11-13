-- MiniSpace: reset one authenticated pilot's game progress without deleting their login account.
-- Run once in Supabase SQL Editor after market_game_sync.sql and pilot_saves.sql.

create or replace function public.market_reset_pilot_progress()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pilot uuid := auth.uid();
begin
  if v_pilot is null then raise exception 'Pilot login required'; end if;

  -- Remove the cloud character save and both station hangars.
  delete from public.pilot_saves where pilot_id = v_pilot;
  delete from public.pilot_hangars where pilot_id = v_pilot;

  -- Reset spendable currency while marking the wallet as already bootstrapped,
  -- so an old browser save can never be imported over the reset.
  insert into public.pilot_wallets(pilot_id, isk, game_state_synced, legacy_imported)
  values(v_pilot, 0, true, true)
  on conflict(pilot_id) do update
    set isk = 0,
        game_state_synced = true,
        legacy_imported = true,
        updated_at = now();

  -- Personal transaction history is character data; shared market stock and
  -- global price history are deliberately left intact.
  delete from public.market_transactions where pilot_id = v_pilot;

  return jsonb_build_object('success', true, 'wallet', 0, 'hangarsCleared', true);
end;
$$;

revoke all on function public.market_reset_pilot_progress() from public, anon;
grant execute on function public.market_reset_pilot_progress() to authenticated;
