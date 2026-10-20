-- ============================================
-- Fintrack Trips: bulk import (Splitwise CSV)
-- Spec: docs/design/TRIPS.md ("Import & export")
-- Run this in Supabase SQL Editor after 002_trips.sql.
-- Adds one RPC, public.import_trip. No new tables, so nothing changes for
-- Realtime or RLS. Uses create or replace only; safe to re-run.
-- ============================================

-- import_trip(p_trip, p_members, p_expenses, p_settlements) -> trip id
--
-- Creates a whole trip in ONE transaction (any error rolls everything back).
-- It seeds the same 8 default categories as create_trip and validates every
-- expense the way upsert_trip_expense does. Rows refer to each other by
-- client-side keys, which this function resolves to the new ids.
--
--   p_trip         {name, default_currency, start_date?, end_date?}
--   p_members      [{key, display_name, is_me}]   exactly one is_me; that member gets user_id = auth.uid()
--   p_expenses     [{title, amount, currency, category_key, paid_by_key, date?, note?, split_mode?,
--                    fx_rate?, fx_source?, fx_date?,
--                    shares: [{member_key, amount, weight?}]}]
--   p_settlements  [{from_key, to_key, amount, currency?, date?}]   default currency only
--
-- category_key is one of the seeded keys: stay, food, transport, activity,
-- groceries, shopping, fees, other.
-- Limits: 50 members, 5000 expenses, 2000 settlements.
create or replace function public.import_trip(
  p_trip jsonb,
  p_members jsonb,
  p_expenses jsonb,
  p_settlements jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trip uuid;
  v_name text;
  v_currency text;
  v_start date;
  v_end date;
  v_minor int;
  v_colors text[] := array['#FD6FB8','#93D4D9','#FDAC62','#D0E2FF','#B9A1FF','#A8E6A1','#FFD36B','#F7B2B2'];
  v_members jsonb := '{}'::jsonb;       -- member key -> new member id
  v_cats jsonb;                         -- category key -> new category id
  v_m record;
  v_key text;
  v_mname text;
  v_is_me boolean;
  v_n_me int := 0;
  v_member_id uuid;
  v_e record;
  v_expense_id uuid;
  v_label text;
  v_title text;
  v_amount numeric;
  v_ccy text;
  v_category uuid;
  v_paid_by uuid;
  v_split_mode text;
  v_fx_rate numeric;
  v_fx_source text;
  v_fx_date date;
  v_amount_default numeric;
  v_date date;
  v_shares jsonb;
  v_n_shares int;
  v_n_distinct int;
  v_sum numeric;
  v_bad int;
  v_s record;
  v_from uuid;
  v_to uuid;
  v_samount numeric;
  v_sdate date;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- Shape and size limits first, so a huge payload is refused before any work.
  if p_trip is null or jsonb_typeof(p_trip) <> 'object' then
    raise exception 'trip must be a JSON object' using errcode = '22023';
  end if;
  if p_members is null or jsonb_typeof(p_members) <> 'array' or jsonb_array_length(p_members) = 0 then
    raise exception 'members must be a non-empty JSON array' using errcode = '22023';
  end if;
  p_expenses := coalesce(p_expenses, '[]'::jsonb);
  p_settlements := coalesce(p_settlements, '[]'::jsonb);
  if jsonb_typeof(p_expenses) <> 'array' or jsonb_typeof(p_settlements) <> 'array' then
    raise exception 'expenses and settlements must be JSON arrays' using errcode = '22023';
  end if;
  if jsonb_array_length(p_members) > 50 then
    raise exception 'Too many members (at most 50)' using errcode = '22023';
  end if;
  if jsonb_array_length(p_expenses) > 5000 then
    raise exception 'Too many expenses (at most 5000)' using errcode = '22023';
  end if;
  if jsonb_array_length(p_settlements) > 2000 then
    raise exception 'Too many settlements (at most 2000)' using errcode = '22023';
  end if;

  -- Trip, validated like create_trip.
  v_name := btrim(coalesce(p_trip->>'name', ''));
  if length(v_name) < 1 or length(v_name) > 80 then
    raise exception 'Trip name must be 1-80 characters' using errcode = '22023';
  end if;
  v_currency := upper(btrim(coalesce(p_trip->>'default_currency', '')));
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Invalid currency code' using errcode = '22023';
  end if;
  v_start := nullif(p_trip->>'start_date', '')::date;
  v_end := nullif(p_trip->>'end_date', '')::date;
  if v_start is not null and v_end is not null and v_end < v_start then
    raise exception 'The end date is before the start date' using errcode = '22023';
  end if;
  v_minor := public.currency_minor_units(v_currency);

  -- Members: validate everything before the first insert is not needed (the
  -- transaction rolls back), but exactly one "me" is required up front.
  select count(*) filter (where coalesce((m->>'is_me')::boolean, false))
    into v_n_me
    from jsonb_array_elements(p_members) as m;
  if v_n_me <> 1 then
    raise exception 'Exactly one member must be marked is_me' using errcode = '22023';
  end if;

  insert into public.trips (name, default_currency, start_date, end_date, share_token, created_by)
  values (v_name, v_currency, v_start, v_end, public.new_share_token(), v_uid)
  returning id into v_trip;

  for v_m in
    select m.value as j, m.ordinality as pos
      from jsonb_array_elements(p_members) with ordinality as m(value, ordinality)
      order by m.ordinality
  loop
    if jsonb_typeof(v_m.j) <> 'object' then
      raise exception 'Member % must be a JSON object', v_m.pos using errcode = '22023';
    end if;
    v_key := btrim(coalesce(v_m.j->>'key', ''));
    if v_key = '' then
      raise exception 'Member % needs a key', v_m.pos using errcode = '22023';
    end if;
    if v_members ? v_key then
      raise exception 'Duplicate member key %', v_key using errcode = '22023';
    end if;
    v_mname := btrim(coalesce(v_m.j->>'display_name', ''));
    if length(v_mname) < 1 or length(v_mname) > 40 then
      raise exception 'Member % name must be 1-40 characters', v_m.pos using errcode = '22023';
    end if;
    v_is_me := coalesce((v_m.j->>'is_me')::boolean, false);

    insert into public.trip_members (trip_id, display_name, user_id, color)
    values (
      v_trip,
      v_mname,
      case when v_is_me then v_uid else null end,
      v_colors[((v_m.pos::int - 1) % array_length(v_colors, 1)) + 1]
    )
    returning id into v_member_id;
    v_members := v_members || jsonb_build_object(v_key, v_member_id);
  end loop;

  -- The same 8 default categories as create_trip (which stays untouched).
  with ins as (
    insert into public.trip_categories (trip_id, key, name, icon, color, sort_order)
    values
      (v_trip, 'stay',      'Stay',          'bed-double',         'blue',   0),
      (v_trip, 'food',      'Food & drinks', 'utensils',           'rust',   1),
      (v_trip, 'transport', 'Transport',     'train-front',        'teal',   2),
      (v_trip, 'activity',  'Activities',    'ticket',             'purple', 3),
      (v_trip, 'groceries', 'Groceries',     'shopping-basket',    'green',  4),
      (v_trip, 'shopping',  'Shopping',      'shopping-bag',       'pink',   5),
      (v_trip, 'fees',      'Fees & tips',   'circle-dollar-sign', 'grey',   6),
      (v_trip, 'other',     'Other',         'ellipsis',           'grey',   7)
    returning key, id
  )
  select jsonb_object_agg(key, id) into v_cats from ins;

  -- Expenses, validated like upsert_trip_expense.
  for v_e in
    select e.value as j, e.ordinality as pos
      from jsonb_array_elements(p_expenses) with ordinality as e(value, ordinality)
      order by e.ordinality
  loop
    v_label := 'Expense ' || v_e.pos;
    if jsonb_typeof(v_e.j) <> 'object' then
      raise exception '% must be a JSON object', v_label using errcode = '22023';
    end if;

    v_title := btrim(coalesce(v_e.j->>'title', ''));
    if length(v_title) < 1 or length(v_title) > 120 then
      raise exception '%: title must be 1-120 characters', v_label using errcode = '22023';
    end if;

    v_amount := (v_e.j->>'amount')::numeric;
    if v_amount is null or v_amount <= 0 then
      raise exception '%: amount must be positive', v_label using errcode = '22023';
    end if;

    v_ccy := upper(btrim(coalesce(v_e.j->>'currency', '')));
    if v_ccy !~ '^[A-Z]{3}$' then
      raise exception '%: invalid currency code', v_label using errcode = '22023';
    end if;

    v_category := (v_cats->>(v_e.j->>'category_key'))::uuid;
    if v_category is null then
      raise exception '%: unknown category', v_label using errcode = '22023';
    end if;

    v_paid_by := (v_members->>(v_e.j->>'paid_by_key'))::uuid;
    if v_paid_by is null then
      raise exception '%: payer is not a member of this trip', v_label using errcode = '22023';
    end if;

    v_split_mode := coalesce(nullif(v_e.j->>'split_mode', ''), 'equal');
    if v_split_mode not in ('equal', 'exact', 'shares') then
      raise exception '%: invalid split mode', v_label using errcode = '22023';
    end if;

    -- Currency conversion fields, exactly like upsert_trip_expense.
    v_fx_rate := nullif(v_e.j->>'fx_rate', '')::numeric;
    v_fx_source := nullif(v_e.j->>'fx_source', '');
    v_fx_date := nullif(v_e.j->>'fx_date', '')::date;
    if v_ccy = v_currency then
      v_fx_rate := 1;
      v_fx_source := 'same';
    end if;
    if v_fx_rate is not null and v_fx_rate <= 0 then
      raise exception '%: fx_rate must be positive', v_label using errcode = '22023';
    end if;
    if v_fx_rate is null then
      v_amount_default := null;
      v_fx_source := null;
    else
      if v_fx_source is not null and v_fx_source not in ('cache', 'api', 'manual', 'same') then
        raise exception '%: invalid fx_source', v_label using errcode = '22023';
      end if;
      v_amount_default := public.round_half_even(v_amount * v_fx_rate, v_minor);
    end if;

    -- Shares: valid members of this trip, no duplicates, non-negative, summing to the amount.
    v_shares := v_e.j->'shares';
    if v_shares is null or jsonb_typeof(v_shares) <> 'array' or jsonb_array_length(v_shares) = 0 then
      raise exception '%: shares must be a non-empty JSON array', v_label using errcode = '22023';
    end if;
    select count(*), count(distinct s.member_key), coalesce(sum(s.amount), 0),
           count(*) filter (
             where s.member_key is null
                or not (v_members ? s.member_key)
                or s.amount is null or s.amount < 0
                or coalesce(s.weight, 1) < 0
           )
      into v_n_shares, v_n_distinct, v_sum, v_bad
      from jsonb_to_recordset(v_shares) as s(member_key text, weight numeric, amount numeric);
    if v_bad > 0 then
      raise exception '%: shares contain an invalid member or amount', v_label using errcode = '22023';
    end if;
    if v_n_shares <> v_n_distinct then
      raise exception '%: duplicate member in shares', v_label using errcode = '22023';
    end if;
    if round(v_sum, 3) <> round(v_amount, 3) then
      raise exception '%: shares (%) must sum to the amount (%)', v_label, v_sum, v_amount using errcode = '22023';
    end if;

    v_date := coalesce(nullif(v_e.j->>'date', '')::date, current_date);

    insert into public.trip_expenses (
      trip_id, category_id, title, amount, currency,
      fx_rate, fx_source, fx_date, amount_default,
      paid_by, split_mode, date, note, created_by, created_at
    ) values (
      v_trip, v_category, v_title, v_amount, v_ccy,
      v_fx_rate, v_fx_source, v_fx_date, v_amount_default,
      v_paid_by, v_split_mode, v_date,
      coalesce(nullif(btrim(v_e.j->>'note'), ''), 'Imported from Splitwise'),
      -- clock_timestamp() (not now()) so rows keep the order of the file when sorted by creation time.
      v_uid, clock_timestamp()
    )
    returning id into v_expense_id;

    insert into public.trip_expense_shares (expense_id, member_id, weight, amount)
    select v_expense_id, (v_members->>s.member_key)::uuid, coalesce(s.weight, 1), s.amount
      from jsonb_to_recordset(v_shares) as s(member_key text, weight numeric, amount numeric);
  end loop;

  -- Settlements: trip default currency only, like record_settlement.
  for v_s in
    select s.value as j, s.ordinality as pos
      from jsonb_array_elements(p_settlements) with ordinality as s(value, ordinality)
      order by s.ordinality
  loop
    v_label := 'Settlement ' || v_s.pos;
    if jsonb_typeof(v_s.j) <> 'object' then
      raise exception '% must be a JSON object', v_label using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(v_s.j->>'currency', '')), '') is not null
       and upper(btrim(v_s.j->>'currency')) <> v_currency then
      raise exception '%: settlements must be in the trip default currency (%)', v_label, v_currency using errcode = '22023';
    end if;
    v_from := (v_members->>(v_s.j->>'from_key'))::uuid;
    v_to := (v_members->>(v_s.j->>'to_key'))::uuid;
    if v_from is null or v_to is null then
      raise exception '%: both members must belong to this trip', v_label using errcode = '22023';
    end if;
    if v_from = v_to then
      raise exception '%: a settlement needs two different members', v_label using errcode = '22023';
    end if;
    v_samount := round((v_s.j->>'amount')::numeric, v_minor);
    if v_samount is null or v_samount <= 0 then
      raise exception '%: amount must be positive', v_label using errcode = '22023';
    end if;
    v_sdate := nullif(v_s.j->>'date', '')::date;

    insert into public.trip_settlements (trip_id, from_member, to_member, amount, currency, fx_rate, created_at)
    values (
      v_trip, v_from, v_to, v_samount, v_currency, 1,
      -- Keep the day of the original payment (noon UTC, so no time zone moves it).
      coalesce(((v_sdate::timestamp + interval '12 hours') at time zone 'UTC'), now())
    );
  end loop;

  return v_trip;
end;
$$;

-- Grants. Supabase grants new public functions to anon and authenticated
-- through default privileges, which "revoke ... from public" does not undo,
-- so anon is revoked explicitly.
revoke all on function public.import_trip(jsonb, jsonb, jsonb, jsonb) from public;
revoke execute on function public.import_trip(jsonb, jsonb, jsonb, jsonb) from anon;
grant execute on function public.import_trip(jsonb, jsonb, jsonb, jsonb) to authenticated;
