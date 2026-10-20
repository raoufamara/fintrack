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
grant all on ctx to authenticated, anon;

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
insert into ctx select 'code', invite_code from public.trips;
insert into ctx select 'token', share_token from public.trips;

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
  -- Idempotent on client_id: a replay returns the same settlement and adds no row.
  if public.record_settlement(v_trip, v_sara, v_ma, 2.5, '99999999-9999-9999-9999-999999999999')
     <> public.record_settlement(v_trip, v_sara, v_ma, 2.5, '99999999-9999-9999-9999-999999999999') then
    raise exception 'record_settlement replay created a second settlement';
  end if;
  if (select count(*) from trip_settlements where client_id = '99999999-9999-9999-9999-999999999999') <> 1 then
    raise exception 'record_settlement replay duplicated the row';
  end if;

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

-- 5. Invites: preview shows only the trip and its unclaimed members; joining claims a member once.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$
declare
  v_prev jsonb;
  v_code text := (select v from ctx where k = 'code');
  v_sara uuid := (select v from ctx where k = 'sara')::uuid;
  v_joined uuid;
begin
  v_prev := public.preview_trip_invite(upper(v_code));
  if (select array_agg(k order by k) from jsonb_object_keys(v_prev) k)
     <> array['default_currency', 'end_date', 'name', 'start_date', 'trip_id', 'unclaimed'] then
    raise exception 'preview returned unexpected keys';
  end if;
  if jsonb_array_length(v_prev->'unclaimed') <> 2 then raise exception 'expected 2 unclaimed members, got %', v_prev->'unclaimed'; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(v_prev->'unclaimed'->0) k) <> array['display_name', 'id'] then
    raise exception 'unclaimed member leaks keys';
  end if;
  begin perform public.preview_trip_invite('nope'); raise exception 'invalid code accepted';
  exception when sqlstate 'P0002' then null; end;

  v_joined := public.join_trip(v_code, v_sara);
  if v_joined <> v_sara then raise exception 'join_trip did not claim the chosen member'; end if;
  if public.join_trip(v_code) <> v_sara then raise exception 'join_trip is not idempotent for a member'; end if;
  if jsonb_array_length(public.preview_trip_invite(v_code)->'unclaimed') <> 1 then raise exception 'claimed member still unclaimed'; end if;
end $$;
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.must_fail('claim an already claimed member', format($f$select public.join_trip(%L, %L)$f$, (select v from ctx where k='code'), (select v from ctx where k='sara')::uuid));
set local role anon;
do $$ begin
  begin perform public.preview_trip_invite('x'); raise exception 'anon can preview invites';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 6. Guest view-only link (anon): only get_shared_trip is callable, and its payload is stripped.
-- A hidden category with an expense, a settlement and an archived flag must all come through.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare
  v_trip uuid := (select v from ctx where k = 'trip')::uuid;
  v_ma uuid := (select v from ctx where k = 'ma')::uuid;
  v_sara uuid := (select v from ctx where k = 'sara')::uuid;
  v_hidden uuid;
  v_exp uuid;
begin
  v_hidden := public.create_trip_category(v_trip, 'Secret spa', 'sparkles', 'pink');
  v_exp := public.upsert_trip_expense(
    jsonb_build_object('trip_id', v_trip, 'category_id', v_hidden, 'title', 'Spa day', 'amount', 40, 'currency', 'EUR',
                       'paid_by', v_ma, 'client_id', '88888888-8888-8888-8888-888888888888',
                       'place_name', 'Spa', 'place_city', 'Lisbon', 'place_lat', 38.7, 'place_lng', -9.1, 'place_provider_id', 'N77'),
    jsonb_build_array(jsonb_build_object('member_id', v_ma, 'amount', 20), jsonb_build_object('member_id', v_sara, 'amount', 20)));
  update public.trip_categories set hidden_at = now() where id = v_hidden;
  update public.trips set archived_at = now() where id = v_trip;
  perform public.record_settlement(v_trip, v_sara, v_ma, 3, '77777777-7777-7777-7777-777777777777');
end $$;
reset role;

set local role anon;
do $$
declare
  v_pay jsonb;
  v_token text := (select v from ctx where k = 'token');
  v_text text;
begin
  v_pay := public.get_shared_trip(v_token);
  if v_pay is null then raise exception 'anon could not read an enabled share'; end if;
  v_text := v_pay::text;

  if (v_pay->'trip') ?| array['invite_code', 'share_token', 'created_by'] then raise exception 'trip leaks private keys'; end if;
  if (v_pay->'expenses'->0) ?| array['created_by', 'client_id', 'place_lat', 'place_lng', 'place_provider_id'] then raise exception 'expense leaks private keys'; end if;
  if (v_pay->'settlements'->0) ?| array['client_id'] then raise exception 'settlement leaks client_id'; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(v_pay->'members'->0) k) <> array['color', 'display_name', 'id'] then
    raise exception 'members expose more than id, display_name and color';
  end if;
  if v_text ~ 'user_id' or v_text ~ '@' or v_text ~ (select v from ctx where k = 'code') then
    raise exception 'payload mentions a user id, an email or the invite code';
  end if;
  if v_text ~ '38\.7' or v_text ~ 'N77' then raise exception 'payload mentions coordinates or the provider id'; end if;

  -- What the read-only UI needs.
  if v_pay->>'shared_by' is null then raise exception 'missing shared_by'; end if;
  if v_pay->'trip'->>'archived_at' is null then raise exception 'archived_at missing'; end if;
  if v_pay->'trip'->>'default_currency' is null then raise exception 'default_currency missing'; end if;
  if not exists (select 1 from jsonb_array_elements(v_pay->'categories') c where c->>'name' = 'Secret spa' and c->>'hidden_at' is not null) then
    raise exception 'hidden category with expenses is missing';
  end if;
  if jsonb_array_length(v_pay->'settlements') < 1 then raise exception 'settlements missing'; end if;
  if jsonb_array_length(v_pay->'shares') < 2 then raise exception 'shares missing'; end if;

  if public.get_shared_trip('not-a-token') is not null then raise exception 'unknown token returned data'; end if;

  begin perform public.set_share_enabled(gen_random_uuid(), false); raise exception 'anon can toggle sharing';
  exception when insufficient_privilege then null; end;
  begin perform public.rotate_share_token(gen_random_uuid()); raise exception 'anon can rotate tokens';
  exception when insufficient_privilege then null; end;
  begin perform public.request_join_from_share(v_token); raise exception 'anon can request the invite code';
  exception when insufficient_privilege then null; end;
  begin perform public.join_trip('x'); raise exception 'anon can join';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- A member disables sharing: the link is dead and the invite code stays private.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select public.set_share_enabled((select v from ctx where k = 'trip')::uuid, false);
do $$
declare
  v_token text := (select v from ctx where k = 'token');
begin
  begin perform public.request_join_from_share(v_token); raise exception 'disabled share handed out the invite code';
  exception when sqlstate 'P0002' then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  if public.get_shared_trip((select v from ctx where k = 'token')) is not null then raise exception 'disabled share still readable'; end if;
end $$;
reset role;

-- Re-enable, then rotate: the old token is dead, the new one works, and a logged-in user gets the invite code.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select public.set_share_enabled((select v from ctx where k = 'trip')::uuid, true);
insert into ctx select 'newtoken', public.rotate_share_token((select v from ctx where k = 'trip')::uuid);
reset role;
set local role anon;
do $$ begin
  if public.get_shared_trip((select v from ctx where k = 'token')) is not null then raise exception 'rotated token still works'; end if;
  if public.get_shared_trip((select v from ctx where k = 'newtoken')) is null then raise exception 'new token does not work'; end if;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$
begin
  if public.request_join_from_share((select v from ctx where k = 'newtoken')) <> (select v from ctx where k = 'code') then
    raise exception 'request_join_from_share did not return the invite code';
  end if;
  begin perform public.request_join_from_share((select v from ctx where k = 'token')); raise exception 'old token handed out the code';
  exception when sqlstate 'P0002' then null; end;
end $$;
reset role;

rollback;
select 'hardening assertions passed' as result;
