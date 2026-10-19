-- Self-checking assertions for the hardened Trips model (002_trips.sql).
-- Run on a SCRATCH Postgres (never a real project) after 001 and 002, with
-- Supabase-like stubs: roles anon/authenticated, auth.uid() reading the
-- 'request.jwt.claim.sub' setting, and auth.users. Any failure raises an exception:
--   psql -v ON_ERROR_STOP=1 -f stub.sql -f 001_initial_schema.sql -f 002_trips.sql -f 002_trips_hardening.sql
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.io'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.io'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.io');

create temp table ctx (k text primary key, v text);
grant all on ctx to authenticated;

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, true);
end $$;

-- Runs sql as the authenticated role and asserts that it fails.
create or replace function pg_temp.must_fail(label text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute 'set local role authenticated';
    execute stmt;
    execute 'reset role';
  exception when others then
    execute 'reset role';
    return;
  end;
  raise exception 'ASSERTION FAILED (expected an error): %', label;
end $$;

create or replace function pg_temp.must_pass(label text, stmt text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  execute stmt;
  execute 'reset role';
exception when others then
  execute 'reset role';
  raise exception 'ASSERTION FAILED (%): %', label, sqlerrm;
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
insert into ctx select 'trip', public.create_trip('Lisbon', 'EUR', null, null, null, array['Sara']);
reset role;
insert into ctx select 'ma', id::text from public.trip_members where user_id is not null;
insert into ctx select 'sara', id::text from public.trip_members where display_name = 'Sara';
insert into ctx select 'cat', id::text from public.trip_categories where key = 'food';

-- 1. Direct writes that must be rejected for a member.
select pg_temp.must_fail('insert expense', format($f$insert into trip_expenses (trip_id, category_id, title, amount, currency, paid_by, created_by) values (%L, %L, 'x', 1, 'EUR', %L, %L)$f$, (select v from ctx where k='trip')::uuid, (select v from ctx where k='cat')::uuid, (select v from ctx where k='ma')::uuid, '00000000-0000-0000-0000-00000000000a'));
select pg_temp.must_fail('insert settlement', format($f$insert into trip_settlements (trip_id, from_member, to_member, amount, currency) values (%L, %L, %L, 1, 'EUR')$f$, (select v from ctx where k='trip')::uuid, (select v from ctx where k='ma')::uuid, (select v from ctx where k='sara')::uuid));
select pg_temp.must_fail('change share_token', format($f$update trips set share_token = 'hacked' where id = %L$f$, (select v from ctx where k='trip')::uuid));
select pg_temp.must_fail('change default_currency', format($f$update trips set default_currency = 'USD' where id = %L$f$, (select v from ctx where k='trip')::uuid));
select pg_temp.must_fail('clear user_id', format($f$update trip_members set user_id = null where id = %L$f$, (select v from ctx where k='ma')::uuid));
select pg_temp.must_fail('hijack user_id', format($f$update trip_members set user_id = %L where id = %L$f$, '00000000-0000-0000-0000-00000000000a', (select v from ctx where k='sara')::uuid));
select pg_temp.must_fail('insert member', format($f$insert into trip_members (trip_id, display_name, color) values (%L, 'Evil', '#000')$f$, (select v from ctx where k='trip')::uuid));
select pg_temp.must_fail('delete member', format($f$delete from trip_members where id = %L$f$, (select v from ctx where k='sara')::uuid));
select pg_temp.must_fail('delete trip', format($f$delete from trips where id = %L$f$, (select v from ctx where k='trip')::uuid));
select pg_temp.must_fail('insert category', format($f$insert into trip_categories (trip_id, name, icon, color) values (%L, 'Z', 'tag', 'blue')$f$, (select v from ctx where k='trip')::uuid));
select pg_temp.must_fail('unknown icon', format($f$update trip_categories set icon = 'nope' where id = %L$f$, (select v from ctx where k='cat')::uuid));
select pg_temp.must_fail('other member display_currency', format($f$update trip_members set display_currency = 'CAD' where id = %L$f$, (select v from ctx where k='sara')::uuid));

-- 2. Direct writes that are allowed.
select pg_temp.must_pass('rename trip', format($f$update trips set name = 'Lisbon 2026', budget_amount = 500 where id = %L$f$, (select v from ctx where k='trip')::uuid));
select pg_temp.must_pass('edit member', format($f$update trip_members set display_name = 'Sara K', color = '#fff' where id = %L$f$, (select v from ctx where k='sara')::uuid));
select pg_temp.must_pass('own display currency', format($f$update trip_members set display_currency = 'CAD' where id = %L$f$, (select v from ctx where k='ma')::uuid));
select pg_temp.must_pass('edit category', format($f$update trip_categories set name = 'Meals', icon = 'coffee', color = 'teal' where id = %L$f$, (select v from ctx where k='cat')::uuid));

-- 3. New RPCs.
set local role authenticated;
do $$
declare
  v_trip uuid := (select v from ctx where k='trip')::uuid;
  v_ma uuid := (select v from ctx where k='ma')::uuid;
  v_sara uuid := (select v from ctx where k='sara')::uuid;
  v_cat uuid := (select v from ctx where k='cat')::uuid;
  v_mal uuid; v_newcat uuid; v_exp uuid; v_st uuid;
begin
  v_mal := public.add_trip_member(v_trip, 'Malik');
  if (select user_id from trip_members where id = v_mal) is not null then raise exception 'add_trip_member set user_id'; end if;

  v_newcat := public.create_trip_category(v_trip, 'Hammam & spa', 'sparkles', 'pink');
  if (select sort_order from trip_categories where id = v_newcat) <> 8 then raise exception 'sort_order'; end if;
  begin perform public.create_trip_category(v_trip, 'hammam & SPA', 'sparkles', 'pink'); raise exception 'dup accepted';
  exception when unique_violation then null; end;
  begin perform public.create_trip_category(v_trip, 'x', 'sparkles', 'red'); raise exception 'colour accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.create_trip_category(v_trip, 'x', 'nope', 'pink'); raise exception 'icon accepted';
  exception when sqlstate '22023' then null; end;

  v_exp := public.upsert_trip_expense(
    jsonb_build_object('trip_id', v_trip, 'category_id', v_cat, 'title', 'Dinner', 'amount', 24, 'currency', 'EUR', 'paid_by', v_ma),
    jsonb_build_array(jsonb_build_object('member_id', v_ma, 'amount', 12), jsonb_build_object('member_id', v_sara, 'amount', 12)));

  v_st := public.record_settlement(v_trip, v_sara, v_ma, 5);
  if (select currency from trip_settlements where id = v_st) <> 'EUR' then raise exception 'settlement currency'; end if;
  begin perform public.record_settlement(v_trip, v_ma, v_ma, 5); raise exception 'self settlement accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.record_settlement(v_trip, v_ma, v_sara, 0); raise exception 'zero settlement accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.record_settlement(v_trip, v_ma, gen_random_uuid(), 1); raise exception 'foreign member accepted';
  exception when sqlstate '22023' then null; end;

  perform public.delete_trip_expense(v_exp);
  if exists (select 1 from trip_expenses where id = v_exp) then raise exception 'expense not deleted'; end if;
  if exists (select 1 from trip_expense_shares where expense_id = v_exp) then raise exception 'shares not deleted'; end if;
end $$;
reset role;

-- 4. Outsiders and anon.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.must_fail('outsider add_trip_member', format($f$select public.add_trip_member(%L, 'Spy')$f$, (select v from ctx where k='trip')::uuid));
select pg_temp.must_fail('outsider record_settlement', format($f$select public.record_settlement(%L, %L, %L, 1)$f$, (select v from ctx where k='trip')::uuid, (select v from ctx where k='ma')::uuid, (select v from ctx where k='sara')::uuid));
select pg_temp.must_fail('outsider create_trip_category', format($f$select public.create_trip_category(%L, 'Spy', 'tag', 'blue')$f$, (select v from ctx where k='trip')::uuid));
set local role authenticated;
do $$ begin
  if (select count(*) from trips) <> 0 then raise exception 'outsider can read trips'; end if;
end $$;
reset role;

rollback;
select 'hardening assertions passed' as result;
