-- ============================================
-- Fintrack Trips: group expense tracking
-- Spec: docs/design/TRIPS.md (section 5)
-- Run this in Supabase SQL Editor after 001_initial_schema.sql.
-- Safe to re-run: tables, indexes, policies and functions are idempotent.
-- Trips tables use the trip_ prefix and reference only public.users.
-- ============================================

-- --------------------------------------------
-- 0. Extensions
-- --------------------------------------------
-- pgcrypto: gen_random_bytes() for share tokens.
-- On Supabase this extension usually already exists in the "extensions" schema,
-- in which case this is a no-op. Functions below that need it resolve it through
-- public.new_share_token(), which has its own search_path.
create extension if not exists pgcrypto with schema extensions;
-- unaccent: accent-insensitive unique category names.
create extension if not exists unaccent with schema public;

-- unaccent() is only STABLE, so wrap it to use it in an index expression.
create or replace function public.immutable_unaccent(t text)
returns text
language sql
immutable
parallel safe
as $$ select public.unaccent('public.unaccent'::regdictionary, t) $$;

-- URL-safe random token (24 chars, 144 bits of entropy).
create or replace function public.new_share_token()
returns text
language sql
volatile
set search_path = public, extensions
as $$ select translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_') $$;

-- Decimal places of a currency (ISO 4217 minor units). Keep the 0- and 3-decimal
-- lists in sync with currencies.json; a test compares them. Everything else is 2.
create or replace function public.currency_minor_units(p_code text)
returns int
language sql
immutable
parallel safe
as $$
  select case
    when upper(p_code) = any (array['BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF']) then 0
    when upper(p_code) = any (array['BHD','IQD','JOD','KWD','LYD','OMR','TND']) then 3
    else 2
  end
$$;

-- Banker's rounding (half to even) at `p_places` decimals, exact on numeric.
-- Matches toDefault() in the client, so balances and amount_default agree.
create or replace function public.round_half_even(p_value numeric, p_places int)
returns numeric
language sql
immutable
parallel safe
as $$
  with s as (select p_value * power(10::numeric, p_places) as scaled)
  select (
    case
      when abs(scaled - trunc(scaled)) = 0.5
        then trunc(scaled) + case when mod(trunc(scaled), 2) = 0 then 0 else sign(scaled) end
      else round(scaled)
    end
  ) / power(10::numeric, p_places)
  from s
$$;

-- --------------------------------------------
-- 1. Tables
-- --------------------------------------------
create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  default_currency char(3) not null,             -- ISO 4217; totals & balances
  start_date date,
  end_date date,
  budget_amount numeric(14,2),                   -- in default_currency
  invite_code text unique not null default substr(md5(gen_random_uuid()::text), 1, 8),  -- join (needs account)
  share_token text unique not null default public.new_share_token(),                   -- view-only link
  share_enabled boolean not null default true,
  created_by uuid not null references public.users(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table if not exists public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  display_name text not null,
  user_id uuid references public.users(id) on delete set null,   -- null until claimed
  color text not null,
  display_currency char(3) check (display_currency is null or display_currency ~ '^[A-Z]{3}$'),  -- personal "show in" currency; null = users.currency
  created_at timestamptz not null default now(),
  unique (trip_id, user_id)
);

create table if not exists public.trip_categories (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  key text,                                       -- 'stay','food',... for seeded rows; null for custom
  name text not null check (length(btrim(name)) between 1 and 24),
  icon text not null,                             -- lucide name from the curated list
  color text not null check (color in ('blue','rust','teal','purple','green','pink','grey')),
  sort_order int not null default 0,
  hidden_at timestamptz,
  created_by_member uuid references public.trip_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- case/accent-insensitive unique name per trip
create unique index if not exists uq_trip_categories_name
  on public.trip_categories (trip_id, lower(public.immutable_unaccent(btrim(name))));

create table if not exists public.trip_expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  category_id uuid not null references public.trip_categories(id),   -- no cascade: delete RPC reassigns first
  title text not null check (length(title) between 1 and 120),
  amount numeric(14,3) not null check (amount > 0),                  -- in original currency (3 dp for KWD etc.)
  currency char(3) not null,
  fx_rate numeric(20,10),                         -- 1 unit of currency -> default_currency; null = pending
  fx_source text check (fx_source in ('cache','api','manual','same')),
  fx_date date,                                   -- date of the rate table used
  amount_default numeric(14,3),                   -- amount * fx_rate, half-even at the default currency's decimals; null while pending
  paid_by uuid not null references public.trip_members(id),
  split_mode text not null default 'equal' check (split_mode in ('equal','exact','shares')),
  date date not null default current_date,
  note text,
  place_name text, place_address text, place_area text, place_city text,
  place_country char(2), place_lat double precision, place_lng double precision, place_provider_id text,
  created_by uuid not null references public.users(id),
  client_id uuid unique,                          -- idempotency key from the offline retry queue
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((place_lat is null) = (place_lng is null)),
  check ((fx_rate is null) = (amount_default is null))
);

create table if not exists public.trip_expense_shares (
  expense_id uuid not null references public.trip_expenses(id) on delete cascade,
  member_id uuid not null references public.trip_members(id) on delete cascade,
  weight numeric(8,3) not null default 1,
  amount numeric(14,3) not null,                  -- share in the expense's original currency (exact)
  primary key (expense_id, member_id)
);

create table if not exists public.trip_settlements (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  from_member uuid not null references public.trip_members(id),
  to_member uuid not null references public.trip_members(id),
  amount numeric(14,2) not null check (amount > 0),
  currency char(3) not null,                      -- v1: always trip default_currency
  fx_rate numeric(20,10) not null default 1,
  created_at timestamptz not null default now(),
  check (from_member <> to_member)
);

-- --------------------------------------------
-- 2. Indexes
-- --------------------------------------------
create index if not exists idx_trip_expenses_trip_date on public.trip_expenses(trip_id, date desc);
create index if not exists idx_trip_expenses_trip_cat  on public.trip_expenses(trip_id, category_id);
create index if not exists idx_trip_expenses_trip_city on public.trip_expenses(trip_id, place_city);
create index if not exists idx_trip_categories_trip    on public.trip_categories(trip_id, sort_order);
create index if not exists idx_trip_members_user       on public.trip_members(user_id);
create index if not exists idx_trip_expense_shares_member on public.trip_expense_shares(member_id);
create index if not exists idx_trip_settlements_trip   on public.trip_settlements(trip_id);

-- --------------------------------------------
-- 3. Membership helper + RLS
-- --------------------------------------------
-- security definer so that the policies on trip_members do not recurse into themselves.
create or replace function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trip_members m
    where m.trip_id = p_trip_id
      and m.user_id = auth.uid()
  );
$$;

revoke all on function public.is_trip_member(uuid) from public;
grant execute on function public.is_trip_member(uuid) to authenticated;

alter table public.trips               enable row level security;
alter table public.trip_members        enable row level security;
alter table public.trip_categories     enable row level security;
alter table public.trip_expenses       enable row level security;
alter table public.trip_expense_shares enable row level security;
alter table public.trip_settlements    enable row level security;

-- Hardened model: members READ everything of their trips directly, but almost all
-- writes go through security definer RPCs (section 4), which validate the data.
-- Direct writes are limited to a few harmless columns via column-level grants.
-- Anonymous visitors never touch tables; guests use get_shared_trip().
revoke all on public.trips, public.trip_members, public.trip_categories,
              public.trip_expenses, public.trip_expense_shares, public.trip_settlements
  from anon, authenticated;

grant select on public.trips, public.trip_members, public.trip_categories,
                public.trip_expenses, public.trip_expense_shares, public.trip_settlements
  to authenticated;

-- trips: direct UPDATE of name, dates, budget and archive flag only.
-- default_currency, share_token, share_enabled, invite_code change via RPCs.
-- Insert only via create_trip; no delete for now.
grant update (name, start_date, end_date, budget_amount, archived_at) on public.trips to authenticated;

drop policy if exists "Trip members can access trips" on public.trips;
drop policy if exists "Trip members can read trips" on public.trips;
create policy "Trip members can read trips"
  on public.trips for select to authenticated
  using (public.is_trip_member(id));
drop policy if exists "Trip members can update trips" on public.trips;
create policy "Trip members can update trips"
  on public.trips for update to authenticated
  using (public.is_trip_member(id))
  with check (public.is_trip_member(id));

-- trip_members: direct UPDATE of display_name, color, display_currency only.
-- user_id changes only inside join_trip; inserts only via create_trip / join_trip /
-- add_trip_member (always user_id null); no delete for now.
grant update (display_name, color, display_currency) on public.trip_members to authenticated;

drop policy if exists "Trip members can access members" on public.trip_members;
drop policy if exists "Trip members can read members" on public.trip_members;
create policy "Trip members can read members"
  on public.trip_members for select to authenticated
  using (public.is_trip_member(trip_id));
drop policy if exists "Trip members can update members" on public.trip_members;
create policy "Trip members can update members"
  on public.trip_members for update to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

-- display_currency is personal: only the member themself may change it.
create or replace function public.trip_members_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.display_currency is distinct from old.display_currency
     and old.user_id is distinct from auth.uid() then
    raise exception 'Only the member themself can change their display currency' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trip_members_guard on public.trip_members;
create trigger trip_members_guard
  before update on public.trip_members
  for each row execute function public.trip_members_guard();

-- trip_categories: direct UPDATE of name, icon, color, hidden_at (validated by trigger).
-- Insert via create_trip_category, delete via delete_trip_category, reorder via RPC.
grant update (name, icon, color, hidden_at) on public.trip_categories to authenticated;

drop policy if exists "Trip members can access categories" on public.trip_categories;
drop policy if exists "Trip members can read categories" on public.trip_categories;
create policy "Trip members can read categories"
  on public.trip_categories for select to authenticated
  using (public.is_trip_member(trip_id));
drop policy if exists "Trip members can update categories" on public.trip_categories;
create policy "Trip members can update categories"
  on public.trip_categories for update to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

-- Curated icon list (keep in sync with CATEGORY_ICONS in lib/categories.ts; a test checks it).
create or replace function public.trip_category_icons()
returns text[]
language sql
immutable
as $$
  select array[
    'bed-double','hotel','tent','utensils','coffee','wine','beer','pizza',
    'train-front','plane','bus','car','ship','bike','fuel','ticket',
    'landmark','camera','mountain','waves','music','shopping-bag',
    'shopping-basket','shirt','gift','heart-pulse','pill','sparkles',
    'scissors','wifi','smartphone','circle-dollar-sign','receipt',
    'hand-coins','baby','dog','briefcase','graduation-cap','ellipsis','tag'
  ]::text[]
$$;

create or replace function public.trip_categories_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.icon is distinct from old.icon and not (new.icon = any (public.trip_category_icons())) then
    raise exception 'Unknown icon' using errcode = '22023';
  end if;
  -- The last visible category can't be hidden.
  if new.hidden_at is not null and old.hidden_at is null and not exists (
    select 1 from public.trip_categories c
    where c.trip_id = old.trip_id and c.id <> old.id and c.hidden_at is null
  ) then
    raise exception 'The last visible category cannot be hidden' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trip_categories_guard on public.trip_categories;
create trigger trip_categories_guard
  before update on public.trip_categories
  for each row execute function public.trip_categories_guard();

-- Expenses, shares, settlements: read-only for members; all writes go through
-- upsert_trip_expense, delete_trip_expense and record_settlement.
drop policy if exists "Trip members can access expenses" on public.trip_expenses;
drop policy if exists "Trip members can read expenses" on public.trip_expenses;
create policy "Trip members can read expenses"
  on public.trip_expenses for select to authenticated
  using (public.is_trip_member(trip_id));

-- Shares are checked through their parent expense.
drop policy if exists "Trip members can access expense shares" on public.trip_expense_shares;
drop policy if exists "Trip members can read expense shares" on public.trip_expense_shares;
create policy "Trip members can read expense shares"
  on public.trip_expense_shares for select to authenticated
  using (exists (
    select 1 from public.trip_expenses e
    where e.id = trip_expense_shares.expense_id
      and public.is_trip_member(e.trip_id)
  ));

drop policy if exists "Trip members can access settlements" on public.trip_settlements;
drop policy if exists "Trip members can read settlements" on public.trip_settlements;
create policy "Trip members can read settlements"
  on public.trip_settlements for select to authenticated
  using (public.is_trip_member(trip_id));

-- --------------------------------------------
-- 4. RPCs (all security definer, search_path = public)
-- --------------------------------------------

-- 4.1 create_trip --------------------------------------------------------
create or replace function public.create_trip(
  p_name text,
  p_default_currency text,
  p_start date default null,
  p_end date default null,
  p_budget numeric default null,
  p_member_names text[] default '{}'::text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trip uuid;
  v_currency text := upper(btrim(coalesce(p_default_currency, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_creator_name text;
  v_colors text[] := array['#FD6FB8','#93D4D9','#FDAC62','#D0E2FF','#B9A1FF','#A8E6A1','#FFD36B','#F7B2B2'];
  v_n int := 1;
  v_member text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if length(v_name) < 1 or length(v_name) > 80 then
    raise exception 'Trip name must be 1-80 characters' using errcode = '22023';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Invalid currency code' using errcode = '22023';
  end if;
  if coalesce(array_length(p_member_names, 1), 0) > 50 then
    raise exception 'Too many members' using errcode = '22023';
  end if;
  if p_budget is not null and p_budget < 0 then
    raise exception 'Budget must not be negative' using errcode = '22023';
  end if;

  insert into public.trips (name, default_currency, start_date, end_date, budget_amount, share_token, created_by)
  values (v_name, v_currency, p_start, p_end, p_budget, public.new_share_token(), v_uid)
  returning id into v_trip;

  select coalesce(nullif(btrim(u.display_name), ''), 'Me')
    into v_creator_name
    from public.users u
    where u.id = v_uid;

  insert into public.trip_members (trip_id, display_name, user_id, color)
  values (v_trip, coalesce(v_creator_name, 'Me'), v_uid, v_colors[1]);

  if p_member_names is not null then
    foreach v_member in array p_member_names loop
      v_member := btrim(coalesce(v_member, ''));
      if v_member <> '' then
        insert into public.trip_members (trip_id, display_name, color)
        values (v_trip, left(v_member, 40), v_colors[(v_n % array_length(v_colors, 1)) + 1]);
        v_n := v_n + 1;
      end if;
    end loop;
  end if;

  insert into public.trip_categories (trip_id, key, name, icon, color, sort_order)
  values
    (v_trip, 'stay',      'Stay',          'bed-double',         'blue',   0),
    (v_trip, 'food',      'Food & drinks', 'utensils',           'rust',   1),
    (v_trip, 'transport', 'Transport',     'train-front',        'teal',   2),
    (v_trip, 'activity',  'Activities',    'ticket',             'purple', 3),
    (v_trip, 'groceries', 'Groceries',     'shopping-basket',    'green',  4),
    (v_trip, 'shopping',  'Shopping',      'shopping-bag',       'pink',   5),
    (v_trip, 'fees',      'Fees & tips',   'circle-dollar-sign', 'grey',   6),
    (v_trip, 'other',     'Other',         'ellipsis',           'grey',   7);

  return v_trip;
end;
$$;

-- 4.2 join_trip ----------------------------------------------------------
-- Works by invite code. With p_member_id, claims that unclaimed member row;
-- without, creates a new member for the caller. Returns the caller's member id.
create or replace function public.join_trip(
  p_code text,
  p_member_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trip uuid;
  v_member uuid;
  v_claimed uuid;
  v_name text;
  v_colors text[] := array['#FD6FB8','#93D4D9','#FDAC62','#D0E2FF','#B9A1FF','#A8E6A1','#FFD36B','#F7B2B2'];
  v_count int;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select t.id into v_trip
    from public.trips t
    where t.invite_code = lower(btrim(coalesce(p_code, '')));
  if v_trip is null then
    raise exception 'Invalid invite code' using errcode = 'P0002';
  end if;

  -- Already a member: idempotent.
  select m.id into v_member
    from public.trip_members m
    where m.trip_id = v_trip and m.user_id = v_uid;
  if v_member is not null then
    return v_member;
  end if;

  if p_member_id is not null then
    select m.id, m.user_id into v_member, v_claimed
      from public.trip_members m
      where m.id = p_member_id and m.trip_id = v_trip
      for update;
    if v_member is null then
      raise exception 'Member not found in this trip' using errcode = 'P0002';
    end if;
    if v_claimed is not null then
      raise exception 'This member has already been claimed' using errcode = '23505';
    end if;
    update public.trip_members set user_id = v_uid where id = v_member;
    return v_member;
  end if;

  select coalesce(nullif(btrim(u.display_name), ''), 'Me') into v_name
    from public.users u where u.id = v_uid;
  select count(*) into v_count from public.trip_members m where m.trip_id = v_trip;

  insert into public.trip_members (trip_id, display_name, user_id, color)
  values (v_trip, coalesce(v_name, 'Me'), v_uid, v_colors[(v_count % array_length(v_colors, 1)) + 1])
  returning id into v_member;

  return v_member;
end;
$$;

-- 4.3 upsert_trip_expense ------------------------------------------------
-- p_expense: jsonb with trip_id, category_id, title, amount, currency, paid_by,
--   and optionally id, client_id, fx_rate, fx_source, fx_date, split_mode, date, note, place_*.
-- p_shares: jsonb array of {member_id, weight?, amount} in the expense's currency.
-- Idempotent on client_id (and on id). amount_default is computed here: banker's
-- rounding to the default currency's decimals, exactly like toDefault() on the client.
create or replace function public.upsert_trip_expense(
  p_expense jsonb,
  p_shares jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trip uuid;
  v_id uuid;
  v_client uuid;
  v_exists boolean := false;
  v_existing_trip uuid;
  v_default_currency text;
  v_category uuid;
  v_paid_by uuid;
  v_title text;
  v_amount numeric;
  v_currency text;
  v_fx_rate numeric;
  v_fx_source text;
  v_fx_date date;
  v_amount_default numeric;
  v_split_mode text;
  v_n_shares int;
  v_n_distinct int;
  v_sum numeric;
  v_bad int;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_expense is null or jsonb_typeof(p_expense) <> 'object' then
    raise exception 'expense must be a JSON object' using errcode = '22023';
  end if;
  if p_shares is null or jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then
    raise exception 'shares must be a non-empty JSON array' using errcode = '22023';
  end if;

  v_trip := nullif(p_expense->>'trip_id', '')::uuid;
  if v_trip is null or not public.is_trip_member(v_trip) then
    raise exception 'Not a member of this trip' using errcode = '42501';
  end if;

  select t.default_currency into v_default_currency from public.trips t where t.id = v_trip;

  v_id := nullif(p_expense->>'id', '')::uuid;
  v_client := nullif(p_expense->>'client_id', '')::uuid;

  -- Idempotency: a replayed client_id resolves to the expense it created.
  if v_id is null and v_client is not null then
    select e.id into v_id from public.trip_expenses e where e.client_id = v_client;
  end if;
  if v_id is not null then
    select e.trip_id into v_existing_trip from public.trip_expenses e where e.id = v_id;
    v_exists := found;
    if v_exists and v_existing_trip <> v_trip then
      raise exception 'Expense belongs to another trip' using errcode = '42501';
    end if;
  end if;

  v_title := btrim(coalesce(p_expense->>'title', ''));
  if length(v_title) < 1 or length(v_title) > 120 then
    raise exception 'Title must be 1-120 characters' using errcode = '22023';
  end if;

  v_amount := (p_expense->>'amount')::numeric;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Amount must be positive' using errcode = '22023';
  end if;

  v_currency := upper(btrim(coalesce(p_expense->>'currency', '')));
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Invalid currency code' using errcode = '22023';
  end if;

  -- Category must belong to this trip.
  v_category := nullif(p_expense->>'category_id', '')::uuid;
  if v_category is null or not exists (
    select 1 from public.trip_categories c where c.id = v_category and c.trip_id = v_trip
  ) then
    raise exception 'Category does not belong to this trip' using errcode = '22023';
  end if;

  -- Payer must be a member of this trip.
  v_paid_by := nullif(p_expense->>'paid_by', '')::uuid;
  if v_paid_by is null or not exists (
    select 1 from public.trip_members m where m.id = v_paid_by and m.trip_id = v_trip
  ) then
    raise exception 'Payer is not a member of this trip' using errcode = '22023';
  end if;

  v_split_mode := coalesce(nullif(p_expense->>'split_mode', ''), 'equal');
  if v_split_mode not in ('equal', 'exact', 'shares') then
    raise exception 'Invalid split mode' using errcode = '22023';
  end if;

  -- Currency conversion fields.
  v_fx_rate := nullif(p_expense->>'fx_rate', '')::numeric;
  v_fx_source := nullif(p_expense->>'fx_source', '');
  v_fx_date := nullif(p_expense->>'fx_date', '')::date;
  if v_currency = v_default_currency then
    v_fx_rate := 1;
    v_fx_source := 'same';
  end if;
  if v_fx_rate is not null and v_fx_rate <= 0 then
    raise exception 'fx_rate must be positive' using errcode = '22023';
  end if;
  if v_fx_rate is null then
    v_amount_default := null;
    v_fx_source := null;
  else
    v_amount_default := public.round_half_even(v_amount * v_fx_rate, public.currency_minor_units(v_default_currency));
  end if;

  -- Shares: valid members, no duplicates, non-negative, sum equals the amount.
  select count(*), count(distinct s.member_id), coalesce(sum(s.amount), 0),
         count(*) filter (
           where s.member_id is null
              or s.amount is null or s.amount < 0
              or coalesce(s.weight, 1) < 0
              or not exists (select 1 from public.trip_members m
                             where m.id = s.member_id and m.trip_id = v_trip)
         )
    into v_n_shares, v_n_distinct, v_sum, v_bad
    from jsonb_to_recordset(p_shares) as s(member_id uuid, weight numeric, amount numeric);

  if v_bad > 0 then
    raise exception 'Shares contain an invalid member or amount' using errcode = '22023';
  end if;
  if v_n_shares <> v_n_distinct then
    raise exception 'Duplicate member in shares' using errcode = '22023';
  end if;
  if round(v_sum, 3) <> round(v_amount, 3) then
    raise exception 'Shares (%) must sum to the amount (%)', v_sum, v_amount using errcode = '22023';
  end if;

  v_id := coalesce(v_id, gen_random_uuid());

  if v_exists then
    update public.trip_expenses set
      category_id = v_category,
      title = v_title,
      amount = v_amount,
      currency = v_currency,
      fx_rate = v_fx_rate,
      fx_source = v_fx_source,
      fx_date = v_fx_date,
      amount_default = v_amount_default,
      paid_by = v_paid_by,
      split_mode = v_split_mode,
      date = coalesce(nullif(p_expense->>'date', '')::date, date),
      note = p_expense->>'note',
      place_name = p_expense->>'place_name',
      place_address = p_expense->>'place_address',
      place_area = p_expense->>'place_area',
      place_city = p_expense->>'place_city',
      place_country = p_expense->>'place_country',
      place_lat = nullif(p_expense->>'place_lat', '')::double precision,
      place_lng = nullif(p_expense->>'place_lng', '')::double precision,
      place_provider_id = p_expense->>'place_provider_id',
      client_id = coalesce(client_id, v_client),
      updated_at = now()
    where id = v_id;
    delete from public.trip_expense_shares where expense_id = v_id;
  else
    insert into public.trip_expenses (
      id, trip_id, category_id, title, amount, currency,
      fx_rate, fx_source, fx_date, amount_default,
      paid_by, split_mode, date, note,
      place_name, place_address, place_area, place_city, place_country,
      place_lat, place_lng, place_provider_id,
      created_by, client_id
    ) values (
      v_id, v_trip, v_category, v_title, v_amount, v_currency,
      v_fx_rate, v_fx_source, v_fx_date, v_amount_default,
      v_paid_by, v_split_mode, coalesce(nullif(p_expense->>'date', '')::date, current_date), p_expense->>'note',
      p_expense->>'place_name', p_expense->>'place_address', p_expense->>'place_area', p_expense->>'place_city',
      p_expense->>'place_country',
      nullif(p_expense->>'place_lat', '')::double precision, nullif(p_expense->>'place_lng', '')::double precision,
      p_expense->>'place_provider_id',
      v_uid, v_client
    );
  end if;

  insert into public.trip_expense_shares (expense_id, member_id, weight, amount)
  select v_id, s.member_id, coalesce(s.weight, 1), s.amount
    from jsonb_to_recordset(p_shares) as s(member_id uuid, weight numeric, amount numeric);

  return v_id;
end;
$$;

-- 4.4 delete_trip_category -----------------------------------------------
create or replace function public.delete_trip_category(
  p_category_id uuid,
  p_move_to uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trip uuid;
  v_hidden timestamptz;
  v_expense_count int;
  v_other_visible int;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select c.trip_id, c.hidden_at into v_trip, v_hidden
    from public.trip_categories c
    where c.id = p_category_id
    for update;
  if v_trip is null then
    raise exception 'Category not found' using errcode = 'P0002';
  end if;
  if not public.is_trip_member(v_trip) then
    raise exception 'Not a member of this trip' using errcode = '42501';
  end if;

  -- The last visible category can't be deleted.
  if v_hidden is null then
    select count(*) into v_other_visible
      from public.trip_categories c
      where c.trip_id = v_trip and c.id <> p_category_id and c.hidden_at is null;
    if v_other_visible = 0 then
      raise exception 'The last visible category cannot be deleted' using errcode = '23514';
    end if;
  end if;

  select count(*) into v_expense_count
    from public.trip_expenses e where e.category_id = p_category_id;

  if p_move_to is not null then
    if p_move_to = p_category_id then
      raise exception 'Cannot move expenses to the category being deleted' using errcode = '22023';
    end if;
    if not exists (select 1 from public.trip_categories c where c.id = p_move_to and c.trip_id = v_trip) then
      raise exception 'Target category does not belong to this trip' using errcode = '22023';
    end if;
  elsif v_expense_count > 0 then
    raise exception 'Category has % expenses; move_to is required', v_expense_count using errcode = '23503';
  end if;

  if v_expense_count > 0 then
    update public.trip_expenses
      set category_id = p_move_to, updated_at = now()
      where category_id = p_category_id;
  end if;

  delete from public.trip_categories where id = p_category_id;
end;
$$;

-- 4.5 reorder_trip_categories --------------------------------------------
-- Listed ids come first, in the given order; categories not listed keep their
-- relative order after them (so a concurrently added category is never lost).
create or replace function public.reorder_trip_categories(
  p_trip_id uuid,
  p_ordered_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n int := coalesce(array_length(p_ordered_ids, 1), 0);
  v_valid int;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'Not a member of this trip' using errcode = '42501';
  end if;
  if v_n = 0 then
    return;
  end if;

  select count(*) into v_valid
    from public.trip_categories c
    where c.trip_id = p_trip_id and c.id = any (p_ordered_ids);
  if v_valid <> v_n or v_n <> (select count(distinct x) from unnest(p_ordered_ids) as x) then
    raise exception 'ordered_ids must be distinct categories of this trip' using errcode = '22023';
  end if;

  with listed as (
    select t.id, t.ord
      from unnest(p_ordered_ids) with ordinality as t(id, ord)
  ),
  rest as (
    select c.id,
           v_n + row_number() over (order by c.sort_order, c.created_at) as ord
      from public.trip_categories c
      where c.trip_id = p_trip_id
        and c.id <> all (p_ordered_ids)
  ),
  merged as (
    select id, ord from listed
    union all
    select id, ord from rest
  )
  update public.trip_categories c
    set sort_order = (m.ord - 1)::int,
        updated_at = now()
    from merged m
    where c.id = m.id and c.trip_id = p_trip_id;
end;
$$;

-- 4.6 set_trip_default_currency ------------------------------------------
-- p_rates shape: { "<CCY>": { "<YYYY-MM-DD>": <rate to the NEW default>, "latest": <rate> } }
-- Each expense is looked up by its currency and its own date (e.date), then 'latest'.
-- An expense with no supplied rate becomes pending (fx_rate null) for the reconciler.
-- Settlements and the budget are also moved to the new currency, so p_rates must
-- include the OLD default currency (a 'latest' entry at least) when they exist.
create or replace function public.set_trip_default_currency(
  p_trip_id uuid,
  p_currency text,
  p_rates jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new text := upper(btrim(coalesce(p_currency, '')));
  v_old text;
  v_budget numeric;
  v_rate numeric;
  v_row record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'Not a member of this trip' using errcode = '42501';
  end if;
  if v_new !~ '^[A-Z]{3}$' then
    raise exception 'Invalid currency code' using errcode = '22023';
  end if;
  if p_rates is null or jsonb_typeof(p_rates) <> 'object' then
    p_rates := '{}'::jsonb;
  end if;

  select t.default_currency, t.budget_amount into v_old, v_budget
    from public.trips t where t.id = p_trip_id for update;
  if v_old is null then
    raise exception 'Trip not found' using errcode = 'P0002';
  end if;
  if v_old = v_new then
    return;
  end if;

  -- Expenses.
  for v_row in
    select e.id, e.currency, e.amount, e.date as rate_date
      from public.trip_expenses e
      where e.trip_id = p_trip_id
      for update
  loop
    if v_row.currency = v_new then
      update public.trip_expenses
        set fx_rate = 1, fx_source = 'same', amount_default = public.round_half_even(amount, public.currency_minor_units(v_new)), updated_at = now()
        where id = v_row.id;
    else
      v_rate := coalesce(
        nullif(p_rates #>> array[v_row.currency::text, v_row.rate_date::text], '')::numeric,
        nullif(p_rates #>> array[v_row.currency::text, 'latest'], '')::numeric
      );
      if v_rate is not null and v_rate > 0 then
        update public.trip_expenses
          set fx_rate = v_rate, fx_source = 'api', amount_default = public.round_half_even(v_row.amount * v_rate, public.currency_minor_units(v_new)), updated_at = now()
          where id = v_row.id;
      else
        update public.trip_expenses
          set fx_rate = null, fx_source = null, amount_default = null, updated_at = now()
          where id = v_row.id;
      end if;
    end if;
  end loop;

  -- Settlements keep their own currency and amount; only fx_rate to the new default changes.
  for v_row in
    select s.id, s.currency, s.created_at::date as rate_date
      from public.trip_settlements s
      where s.trip_id = p_trip_id
      for update
  loop
    if v_row.currency = v_new then
      update public.trip_settlements set fx_rate = 1 where id = v_row.id;
    else
      v_rate := coalesce(
        nullif(p_rates #>> array[v_row.currency::text, v_row.rate_date::text], '')::numeric,
        nullif(p_rates #>> array[v_row.currency::text, 'latest'], '')::numeric
      );
      if v_rate is null or v_rate <= 0 then
        raise exception 'Missing rate for settlement currency %', v_row.currency using errcode = '22023';
      end if;
      update public.trip_settlements set fx_rate = v_rate where id = v_row.id;
    end if;
  end loop;

  -- Budget is expressed in the default currency.
  if v_budget is not null then
    v_rate := nullif(p_rates #>> array[v_old, 'latest'], '')::numeric;
    if v_rate is null or v_rate <= 0 then
      raise exception 'Missing latest rate for % (needed to convert the budget)', v_old using errcode = '22023';
    end if;
    update public.trips set budget_amount = round(v_budget * v_rate, 2) where id = p_trip_id;
  end if;

  update public.trips set default_currency = v_new where id = p_trip_id;
end;
$$;

-- 4.7 get_shared_trip (guest, read-only) ---------------------------------
-- Returns null unless share_enabled and the token matches. Never exposes
-- invite_code, share_token, created_by, client_id, place_lat/lng, place_provider_id,
-- user ids or emails.
create or replace function public.get_shared_trip(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_trip public.trips%rowtype;
  v_result jsonb;
begin
  if p_token is null or length(p_token) = 0 or length(p_token) > 128 then
    return null;
  end if;

  select * into v_trip
    from public.trips t
    where t.share_token = p_token and t.share_enabled;
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'trip',
      to_jsonb(v_trip) - array['invite_code', 'share_token', 'created_by'],
    'shared_by',
      (select m.display_name from public.trip_members m
         where m.trip_id = v_trip.id and m.user_id = v_trip.created_by
         limit 1),
    'members',
      coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'display_name', m.display_name, 'color', m.color)
                                 order by m.created_at, m.id)
                  from public.trip_members m where m.trip_id = v_trip.id), '[]'::jsonb),
    'categories',
      coalesce((select jsonb_agg(to_jsonb(c) - array['created_by_member'] order by c.sort_order, c.created_at)
                  from public.trip_categories c where c.trip_id = v_trip.id), '[]'::jsonb),
    'expenses',
      coalesce((select jsonb_agg(to_jsonb(e) - array['created_by', 'client_id', 'place_lat', 'place_lng', 'place_provider_id']
                                 order by e.date desc, e.created_at desc)
                  from public.trip_expenses e where e.trip_id = v_trip.id), '[]'::jsonb),
    'shares',
      coalesce((select jsonb_agg(to_jsonb(s))
                  from public.trip_expense_shares s
                  join public.trip_expenses e on e.id = s.expense_id
                  where e.trip_id = v_trip.id), '[]'::jsonb),
    'settlements',
      coalesce((select jsonb_agg(to_jsonb(st) order by st.created_at)
                  from public.trip_settlements st where st.trip_id = v_trip.id), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- 4.8 rotate_share_token / set_share_enabled -----------------------------
create or replace function public.rotate_share_token(p_trip_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_token text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'Not a member of this trip' using errcode = '42501';
  end if;

  update public.trips
    set share_token = public.new_share_token()
    where id = p_trip_id
    returning share_token into v_token;

  return v_token;
end;
$$;

create or replace function public.set_share_enabled(
  p_trip_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'Not a member of this trip' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'enabled must not be null' using errcode = '22023';
  end if;

  update public.trips set share_enabled = p_enabled where id = p_trip_id;
end;
$$;

-- 4.9 delete_trip_expense ------------------------------------------------
create or replace function public.delete_trip_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trip uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select e.trip_id into v_trip from public.trip_expenses e where e.id = p_expense_id;
  if v_trip is null then
    raise exception 'Expense not found' using errcode = 'P0002';
  end if;
  if not public.is_trip_member(v_trip) then
    raise exception 'Not a member of this trip' using errcode = '42501';
  end if;
  delete from public.trip_expenses where id = p_expense_id;  -- shares cascade
end;
$$;

-- 4.10 record_settlement -------------------------------------------------
-- A settlement is always recorded in the trip default currency (v1).
create or replace function public.record_settlement(
  p_trip_id uuid,
  p_from uuid,
  p_to uuid,
  p_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_currency text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'Not a member of this trip' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from = p_to then
    raise exception 'A settlement needs two different members' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive' using errcode = '22023';
  end if;
  if (select count(*) from public.trip_members m
        where m.trip_id = p_trip_id and m.id in (p_from, p_to)) <> 2 then
    raise exception 'Both members must belong to this trip' using errcode = '22023';
  end if;

  select t.default_currency into v_currency from public.trips t where t.id = p_trip_id;

  insert into public.trip_settlements (trip_id, from_member, to_member, amount, currency, fx_rate)
  values (p_trip_id, p_from, p_to, round(p_amount, 2), v_currency, 1)
  returning id into v_id;
  return v_id;
end;
$$;

-- 4.11 add_trip_member ---------------------------------------------------
-- Adds a name-only member (user_id always null; they can claim it via join_trip).
create or replace function public.add_trip_member(p_trip_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_colors text[] := array['#FD6FB8','#93D4D9','#FDAC62','#D0E2FF','#B9A1FF','#A8E6A1','#FFD36B','#F7B2B2'];
  v_count int;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'Not a member of this trip' using errcode = '42501';
  end if;
  if length(v_name) < 1 or length(v_name) > 40 then
    raise exception 'Name must be 1-40 characters' using errcode = '22023';
  end if;
  select count(*) into v_count from public.trip_members m where m.trip_id = p_trip_id;
  if v_count >= 50 then
    raise exception 'Too many members' using errcode = '22023';
  end if;

  insert into public.trip_members (trip_id, display_name, color)
  values (p_trip_id, v_name, v_colors[(v_count % array_length(v_colors, 1)) + 1])
  returning id into v_id;
  return v_id;
end;
$$;

-- 4.12 create_trip_category ----------------------------------------------
create or replace function public.create_trip_category(
  p_trip_id uuid,
  p_name text,
  p_icon text,
  p_color text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_member uuid;
  v_order int;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'Not a member of this trip' using errcode = '42501';
  end if;
  if length(v_name) < 1 or length(v_name) > 24 then
    raise exception 'Name must be 1-24 characters' using errcode = '22023';
  end if;
  if p_color is null or p_color not in ('blue','rust','teal','purple','green','pink','grey') then
    raise exception 'Unknown colour' using errcode = '22023';
  end if;
  if p_icon is null or not (p_icon = any (public.trip_category_icons())) then
    raise exception 'Unknown icon' using errcode = '22023';
  end if;

  select m.id into v_member from public.trip_members m
    where m.trip_id = p_trip_id and m.user_id = v_uid;
  select coalesce(max(c.sort_order), -1) + 1 into v_order
    from public.trip_categories c where c.trip_id = p_trip_id;

  begin
    insert into public.trip_categories (trip_id, name, icon, color, sort_order, created_by_member)
    values (p_trip_id, v_name, p_icon, p_color, v_order, v_member)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'There''s already a category called %', v_name using errcode = '23505';
  end;
  return v_id;
end;
$$;

-- --------------------------------------------
-- 5. Grants (explicit; functions are not executable by PUBLIC by default)
-- --------------------------------------------
revoke all on function public.create_trip(text, text, date, date, numeric, text[])          from public;
revoke all on function public.join_trip(text, uuid)                                         from public;
revoke all on function public.upsert_trip_expense(jsonb, jsonb)                             from public;
revoke all on function public.delete_trip_category(uuid, uuid)                              from public;
revoke all on function public.reorder_trip_categories(uuid, uuid[])                         from public;
revoke all on function public.set_trip_default_currency(uuid, text, jsonb)                  from public;
revoke all on function public.get_shared_trip(text)                                         from public;
revoke all on function public.rotate_share_token(uuid)                                      from public;
revoke all on function public.set_share_enabled(uuid, boolean)                              from public;
revoke all on function public.delete_trip_expense(uuid)                                     from public;
revoke all on function public.record_settlement(uuid, uuid, uuid, numeric)                  from public;
revoke all on function public.add_trip_member(uuid, text)                                   from public;
revoke all on function public.create_trip_category(uuid, text, text, text)                  from public;

grant execute on function public.create_trip(text, text, date, date, numeric, text[])       to authenticated;
grant execute on function public.join_trip(text, uuid)                                      to authenticated;
grant execute on function public.upsert_trip_expense(jsonb, jsonb)                          to authenticated;
grant execute on function public.delete_trip_category(uuid, uuid)                           to authenticated;
grant execute on function public.reorder_trip_categories(uuid, uuid[])                      to authenticated;
grant execute on function public.set_trip_default_currency(uuid, text, jsonb)               to authenticated;
grant execute on function public.get_shared_trip(text)                                      to anon, authenticated;
grant execute on function public.rotate_share_token(uuid)                                   to authenticated;
grant execute on function public.set_share_enabled(uuid, boolean)                           to authenticated;
grant execute on function public.delete_trip_expense(uuid)                                  to authenticated;
grant execute on function public.record_settlement(uuid, uuid, uuid, numeric)               to authenticated;
grant execute on function public.add_trip_member(uuid, text)                                to authenticated;
grant execute on function public.create_trip_category(uuid, text, text, text)               to authenticated;

-- --------------------------------------------
-- 6. Realtime (used from phase 6): expenses and categories of the open trip
-- --------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trip_expenses') then
      alter publication supabase_realtime add table public.trip_expenses;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trip_categories') then
      alter publication supabase_realtime add table public.trip_categories;
    end if;
  end if;
end
$$;
