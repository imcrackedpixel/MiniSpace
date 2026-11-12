-- MiniSpace shared market foundation
-- Run once in Supabase SQL Editor. Prices match Market.js at the time this schema was created.

create extension if not exists pgcrypto;

create table if not exists public.pilot_wallets (
  pilot_id uuid primary key references auth.users(id) on delete cascade,
  isk bigint not null default 1000000 check (isk >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pilot_inventory (
  pilot_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null,
  quantity bigint not null default 0 check (quantity >= 0),
  primary key (pilot_id, item_key)
);

create table if not exists public.market_items (
  item_key text primary key,
  display_name text not null,
  unit_price bigint not null check (unit_price > 0),
  stock bigint not null default 0 check (stock >= 0),
  bot_stock bigint not null default 0 check (bot_stock >= 0 and bot_stock <= stock),
  updated_at timestamptz not null default now()
);

create table if not exists public.market_transactions (
  id bigint generated always as identity primary key,
  pilot_id uuid references auth.users(id) on delete set null,
  item_key text not null references public.market_items(item_key),
  side text not null check (side in ('buy','sell','bot_supply')),
  quantity bigint not null check (quantity > 0),
  unit_price bigint not null check (unit_price > 0),
  total_isk bigint not null check (total_isk >= 0),
  created_at timestamptz not null default now()
);

insert into public.market_items(item_key, display_name, unit_price)
values
 ('veldspar','Veldspar',2),
 ('scordite','Scordite',4),
 ('pyroxeres','Pyroxeres',7),
 ('omber','Omber',10),
 ('debris_t1','T1 Debris',15),
 ('debris_t2','T2 Debris',30),
 ('debris_t3','T3 Debris',50),
 ('debris_t4','T4 Debris',80),
 ('debris_t5','T5 Debris',120)
on conflict (item_key) do update
set display_name=excluded.display_name,
    unit_price=excluded.unit_price;

create or replace function public.create_pilot_wallet()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pilot_wallets(pilot_id, isk)
  values (new.id, 1000000)
  on conflict (pilot_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_wallet on auth.users;
create trigger on_auth_user_created_wallet
after insert on auth.users
for each row execute procedure public.create_pilot_wallet();

alter table public.pilot_wallets enable row level security;
alter table public.pilot_inventory enable row level security;
alter table public.market_items enable row level security;
alter table public.market_transactions enable row level security;

drop policy if exists "Pilots can read own wallet" on public.pilot_wallets;
create policy "Pilots can read own wallet"
on public.pilot_wallets for select
to authenticated
using (auth.uid() = pilot_id);

drop policy if exists "Pilots can read own inventory" on public.pilot_inventory;
create policy "Pilots can read own inventory"
on public.pilot_inventory for select
to authenticated
using (auth.uid() = pilot_id);

drop policy if exists "Anyone can read shared market" on public.market_items;
create policy "Anyone can read shared market"
on public.market_items for select
to anon, authenticated
using (true);

drop policy if exists "Pilots can read own transactions" on public.market_transactions;
create policy "Pilots can read own transactions"
on public.market_transactions for select
to authenticated
using (auth.uid() = pilot_id);

-- Trading RPCs use the authenticated pilot ID and server-stored balances/inventory.
-- Clients cannot choose their own price or directly update wallet/stock tables.
create or replace function public.market_buy(p_item_key text, p_quantity bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pilot uuid := auth.uid();
  v_item public.market_items%rowtype;
  v_total bigint;
begin
  if v_pilot is null then raise exception 'Pilot login required'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 1000000 then
    raise exception 'Invalid quantity';
  end if;

  select * into v_item from public.market_items
  where item_key = p_item_key for update;
  if not found then raise exception 'Unknown market item'; end if;
  if v_item.stock < p_quantity then raise exception 'Not enough market stock'; end if;

  v_total := v_item.unit_price * p_quantity;

  update public.pilot_wallets
  set isk = isk - v_total, updated_at = now()
  where pilot_id = v_pilot and isk >= v_total;
  if not found then raise exception 'Not enough ISK'; end if;

  update public.market_items
  set stock = stock - p_quantity,
      bot_stock = greatest(0, bot_stock - least(bot_stock, p_quantity)),
      updated_at = now()
  where item_key = p_item_key;

  insert into public.pilot_inventory(pilot_id,item_key,quantity)
  values(v_pilot,p_item_key,p_quantity)
  on conflict(pilot_id,item_key)
  do update set quantity = public.pilot_inventory.quantity + excluded.quantity;

  insert into public.market_transactions(pilot_id,item_key,side,quantity,unit_price,total_isk)
  values(v_pilot,p_item_key,'buy',p_quantity,v_item.unit_price,v_total);

  return jsonb_build_object('success',true,'quantity',p_quantity,'unitPrice',v_item.unit_price,'total',v_total);
end;
$$;

create or replace function public.market_sell(p_item_key text, p_quantity bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pilot uuid := auth.uid();
  v_item public.market_items%rowtype;
  v_total bigint;
begin
  if v_pilot is null then raise exception 'Pilot login required'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 1000000 then
    raise exception 'Invalid quantity';
  end if;

  select * into v_item from public.market_items
  where item_key = p_item_key for update;
  if not found then raise exception 'Unknown market item'; end if;

  update public.pilot_inventory
  set quantity = quantity - p_quantity
  where pilot_id = v_pilot and item_key = p_item_key and quantity >= p_quantity;
  if not found then raise exception 'Not enough items in pilot inventory'; end if;

  v_total := v_item.unit_price * p_quantity;

  update public.market_items
  set stock = stock + p_quantity,
      updated_at = now()
  where item_key = p_item_key;

  update public.pilot_wallets
  set isk = isk + v_total, updated_at = now()
  where pilot_id = v_pilot;

  insert into public.market_transactions(pilot_id,item_key,side,quantity,unit_price,total_isk)
  values(v_pilot,p_item_key,'sell',p_quantity,v_item.unit_price,v_total);

  return jsonb_build_object('success',true,'quantity',p_quantity,'unitPrice',v_item.unit_price,'total',v_total);
end;
$$;

-- No direct table writes are granted to browser roles. All economy changes go through RPCs
-- or the trusted game server using the service-role key stored only in server environment variables.
revoke insert, update, delete on public.pilot_wallets from anon, authenticated;
revoke insert, update, delete on public.pilot_inventory from anon, authenticated;
revoke insert, update, delete on public.market_items from anon, authenticated;
revoke insert, update, delete on public.market_transactions from anon, authenticated;

grant execute on function public.market_buy(text,bigint) to authenticated;
grant execute on function public.market_sell(text,bigint) to authenticated;
