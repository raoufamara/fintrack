-- Self-checking assertions for import_trip (003_trip_import.sql).
-- Run on a SCRATCH Postgres (never a real project) after 001, 002 and 003, with
-- Supabase-like stubs: roles anon/authenticated, auth.uid() reading the
-- 'request.jwt.claim.sub' setting, and auth.users. Any failure raises an exception:
--   psql -v ON_ERROR_STOP=1 -f stub.sql -f 001_initial_schema.sql -f 002_trips.sql \
--        -f 003_trip_import.sql -f tests/003_trip_import.sql
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.io'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.io');

create temp table ctx (k text primary key, v text);
grant all on ctx to authenticated, anon;

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, true);
end $$;

create or replace function pg_temp.must_fail(label text, stmt text, expect_state text default null) returns void language plpgsql as $$
declare st text;
begin
  begin
    execute 'set local role authenticated';
    execute stmt;
    execute 'reset role';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    execute 'reset role';
    if expect_state is not null and st <> expect_state then
      raise exception 'ASSERTION FAILED (%): expected sqlstate %, got % (%)', label, expect_state, st, sqlerrm;
    end if;
    return;
  end;
  raise exception 'ASSERTION FAILED (expected an error): %', label;
end $$;

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'ASSERTION FAILED: %', label; end if;
end $$;

-- Payload building blocks, kept in ctx so the role-switched statements can read them.
insert into ctx values
  ('trip',    '{"name":"Lisbon","default_currency":"EUR","start_date":"2026-10-03","end_date":"2026-10-10"}'),
  ('members', '[{"key":"m0","display_name":"Raouf","is_me":true},{"key":"m1","display_name":"Sara Lopez","is_me":false},{"key":"m2","display_name":"Inès","is_me":false}]'),
  ('one_ok',  '[{"title":"Airbnb Alfama","amount":480.00,"currency":"EUR","category_key":"stay","paid_by_key":"m1","date":"2026-10-03","split_mode":"exact","shares":[{"member_key":"m0","amount":120.00},{"member_key":"m1","amount":240.00},{"member_key":"m2","amount":120.00}]}]');

-- 1. Happy path ---------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
insert into ctx select 'tripid', public.import_trip(
  (select v::jsonb from ctx where k = 'trip'),
  (select v::jsonb from ctx where k = 'members'),
  '[
    {"title":"Airbnb Alfama","amount":480.00,"currency":"EUR","category_key":"stay","paid_by_key":"m1","date":"2026-10-03","split_mode":"exact","note":"Imported from Splitwise",
     "shares":[{"member_key":"m0","amount":120.00},{"member_key":"m1","amount":240.00},{"member_key":"m2","amount":120.00}]},
    {"title":"Taxi","amount":10.05,"currency":"USD","fx_rate":0.5,"fx_source":"api","fx_date":"2026-10-04","category_key":"transport","paid_by_key":"m0","date":"2026-10-04","split_mode":"exact",
     "shares":[{"member_key":"m0","amount":5.05},{"member_key":"m2","amount":5.00}]},
    {"title":"Pending lunch","amount":20.00,"currency":"MAD","category_key":"food","paid_by_key":"m2","date":"2026-10-05","split_mode":"exact",
     "shares":[{"member_key":"m1","amount":20.00}]}
  ]'::jsonb,
  '[{"from_key":"m2","to_key":"m1","amount":50.00,"date":"2026-10-09"}]'::jsonb
)::text;
reset role;

select pg_temp.check('trip created by caller', (select created_by = '00000000-0000-0000-0000-00000000000a' from trips where id = (select v::uuid from ctx where k='tripid')));
select pg_temp.check('trip name, currency and dates', (select name = 'Lisbon' and default_currency = 'EUR' and start_date = '2026-10-03' and end_date = '2026-10-10' from trips where id = (select v::uuid from ctx where k='tripid')));
select pg_temp.check('trip has its own share token', (select length(share_token) = 24 from trips where id = (select v::uuid from ctx where k='tripid')));
select pg_temp.check('3 members', (select count(*) = 3 from trip_members where trip_id = (select v::uuid from ctx where k='tripid')));
select pg_temp.check('only the is_me member is linked to the caller',
  (select count(*) = 1 and bool_and(display_name = 'Raouf') from trip_members where trip_id = (select v::uuid from ctx where k='tripid') and user_id = '00000000-0000-0000-0000-00000000000a'));
select pg_temp.check('other members are name-only', (select count(*) = 2 from trip_members where trip_id = (select v::uuid from ctx where k='tripid') and user_id is null));
select pg_temp.check('8 default categories with keys', (select count(*) = 8 and count(distinct key) = 8 from trip_categories where trip_id = (select v::uuid from ctx where k='tripid')));
select pg_temp.check('categories match create_trip',
  (select array_agg(key || ':' || name || ':' || icon || ':' || color order by sort_order) =
          array['stay:Stay:bed-double:blue','food:Food & drinks:utensils:rust','transport:Transport:train-front:teal','activity:Activities:ticket:purple','groceries:Groceries:shopping-basket:green','shopping:Shopping:shopping-bag:pink','fees:Fees & tips:circle-dollar-sign:grey','other:Other:ellipsis:grey']
     from trip_categories where trip_id = (select v::uuid from ctx where k='tripid')));
select pg_temp.check('3 expenses', (select count(*) = 3 from trip_expenses where trip_id = (select v::uuid from ctx where k='tripid')));
select pg_temp.check('same-currency expense gets rate 1 and same source',
  (select fx_rate = 1 and fx_source = 'same' and amount_default = 480 from trip_expenses where title = 'Airbnb Alfama'));
select pg_temp.check('foreign expense: amount_default is half-even (10.05 * 0.5 = 5.025 -> 5.02)',
  (select amount_default = 5.02 and fx_rate = 0.5 and fx_source = 'api' and fx_date = '2026-10-04' from trip_expenses where title = 'Taxi'));
select pg_temp.check('no rate stays pending', (select fx_rate is null and amount_default is null and fx_source is null from trip_expenses where title = 'Pending lunch'));
select pg_temp.check('note, created_by, client_id',
  (select bool_and(note = 'Imported from Splitwise' and created_by = '00000000-0000-0000-0000-00000000000a' and client_id is null) from trip_expenses where trip_id = (select v::uuid from ctx where k='tripid')));
select pg_temp.check('category and payer resolved', (select c.key = 'transport' and m.display_name = 'Raouf' from trip_expenses e join trip_categories c on c.id = e.category_id join trip_members m on m.id = e.paid_by where e.title = 'Taxi'));
select pg_temp.check('shares stored', (select count(*) = 6 and sum(amount) = 480 + 10.05 + 20 from trip_expense_shares where expense_id in (select id from trip_expenses where trip_id = (select v::uuid from ctx where k='tripid'))));
select pg_temp.check('settlement stored in the default currency',
  (select count(*) = 1 and bool_and(currency = 'EUR' and fx_rate = 1 and amount = 50 and client_id is null and created_at::date = '2026-10-09') from trip_settlements where trip_id = (select v::uuid from ctx where k='tripid')));
select pg_temp.check('settlement direction', (select f.display_name = 'Inès' and t.display_name = 'Sara Lopez' from trip_settlements s join trip_members f on f.id = s.from_member join trip_members t on t.id = s.to_member where s.trip_id = (select v::uuid from ctx where k='tripid')));

-- The caller is a member, so RLS lets them read it; the other user is not.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select pg_temp.check('caller can read the trip', (select count(*) = 1 from trips));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set local role authenticated;
select pg_temp.check('another user cannot see it', (select count(*) = 0 from trips));
reset role;

-- 2. Rejections, every one rolled back ---------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
create or replace function pg_temp.count_trips() returns bigint language sql as $$ select count(*) from public.trips $$;
insert into ctx values ('trips_before', pg_temp.count_trips()::text);

select pg_temp.must_fail('shares do not sum', $s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'),
  '[{"title":"x","amount":10,"currency":"EUR","category_key":"food","paid_by_key":"m0","shares":[{"member_key":"m0","amount":4},{"member_key":"m1","amount":5}]}]'::jsonb, '[]'::jsonb)$s$, '22023');
select pg_temp.must_fail('negative share', $s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'),
  '[{"title":"x","amount":10,"currency":"EUR","category_key":"food","paid_by_key":"m0","shares":[{"member_key":"m0","amount":12},{"member_key":"m1","amount":-2}]}]'::jsonb, '[]'::jsonb)$s$, '22023');
select pg_temp.must_fail('duplicate member in shares', $s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'),
  '[{"title":"x","amount":10,"currency":"EUR","category_key":"food","paid_by_key":"m0","shares":[{"member_key":"m0","amount":5},{"member_key":"m0","amount":5}]}]'::jsonb, '[]'::jsonb)$s$, '22023');
select pg_temp.must_fail('share for an unknown member', $s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'),
  '[{"title":"x","amount":10,"currency":"EUR","category_key":"food","paid_by_key":"m0","shares":[{"member_key":"zz","amount":10}]}]'::jsonb, '[]'::jsonb)$s$, '22023');
select pg_temp.must_fail('empty shares', $s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'),
  '[{"title":"x","amount":10,"currency":"EUR","category_key":"food","paid_by_key":"m0","shares":[]}]'::jsonb, '[]'::jsonb)$s$, '22023');
select pg_temp.must_fail('unknown payer', $s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'),
  '[{"title":"x","amount":10,"currency":"EUR","category_key":"food","paid_by_key":"nope","shares":[{"member_key":"m0","amount":10}]}]'::jsonb, '[]'::jsonb)$s$, '22023');
select pg_temp.must_fail('unknown category', $s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'),
  '[{"title":"x","amount":10,"currency":"EUR","category_key":"nope","paid_by_key":"m0","shares":[{"member_key":"m0","amount":10}]}]'::jsonb, '[]'::jsonb)$s$, '22023');
select pg_temp.must_fail('empty title', $s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'),
  '[{"title":"  ","amount":10,"currency":"EUR","category_key":"food","paid_by_key":"m0","shares":[{"member_key":"m0","amount":10}]}]'::jsonb, '[]'::jsonb)$s$, '22023');
select pg_temp.must_fail('title over 120 characters', format($s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'),
  '[{"title":"%s","amount":10,"currency":"EUR","category_key":"food","paid_by_key":"m0","shares":[{"member_key":"m0","amount":10}]}]'::jsonb, '[]'::jsonb)$s$, repeat('x', 121)), '22023');
select pg_temp.must_fail('zero amount', $s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'),
  '[{"title":"x","amount":0,"currency":"EUR","category_key":"food","paid_by_key":"m0","shares":[{"member_key":"m0","amount":0}]}]'::jsonb, '[]'::jsonb)$s$, '22023');
select pg_temp.must_fail('bad currency code', $s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'),
  '[{"title":"x","amount":10,"currency":"EURO","category_key":"food","paid_by_key":"m0","shares":[{"member_key":"m0","amount":10}]}]'::jsonb, '[]'::jsonb)$s$, '22023');
select pg_temp.must_fail('zero fx rate', $s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'),
  '[{"title":"x","amount":10,"currency":"USD","fx_rate":0,"category_key":"food","paid_by_key":"m0","shares":[{"member_key":"m0","amount":10}]}]'::jsonb, '[]'::jsonb)$s$, '22023');
select pg_temp.must_fail('bad split mode', $s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'),
  '[{"title":"x","amount":10,"currency":"EUR","category_key":"food","paid_by_key":"m0","split_mode":"weird","shares":[{"member_key":"m0","amount":10}]}]'::jsonb, '[]'::jsonb)$s$, '22023');

select pg_temp.must_fail('settlement to self', $s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'),
  '[]'::jsonb, '[{"from_key":"m0","to_key":"m0","amount":5}]'::jsonb)$s$, '22023');
select pg_temp.must_fail('settlement amount zero', $s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'),
  '[]'::jsonb, '[{"from_key":"m0","to_key":"m1","amount":0}]'::jsonb)$s$, '22023');
select pg_temp.must_fail('settlement rounds to zero', $s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'),
  '[]'::jsonb, '[{"from_key":"m0","to_key":"m1","amount":0.001}]'::jsonb)$s$, '22023');
select pg_temp.must_fail('settlement in another currency', $s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'),
  '[]'::jsonb, '[{"from_key":"m0","to_key":"m1","amount":5,"currency":"USD"}]'::jsonb)$s$, '22023');
select pg_temp.must_fail('settlement with an unknown member', $s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'),
  '[]'::jsonb, '[{"from_key":"m0","to_key":"zz","amount":5}]'::jsonb)$s$, '22023');

select pg_temp.must_fail('no member marked is_me', $s$select public.import_trip((select v::jsonb from ctx where k='trip'),
  '[{"key":"a","display_name":"A","is_me":false}]'::jsonb, '[]'::jsonb, '[]'::jsonb)$s$, '22023');
select pg_temp.must_fail('two members marked is_me', $s$select public.import_trip((select v::jsonb from ctx where k='trip'),
  '[{"key":"a","display_name":"A","is_me":true},{"key":"b","display_name":"B","is_me":true}]'::jsonb, '[]'::jsonb, '[]'::jsonb)$s$, '22023');
select pg_temp.must_fail('duplicate member keys', $s$select public.import_trip((select v::jsonb from ctx where k='trip'),
  '[{"key":"a","display_name":"A","is_me":true},{"key":"a","display_name":"B","is_me":false}]'::jsonb, '[]'::jsonb, '[]'::jsonb)$s$, '22023');
select pg_temp.must_fail('blank member name', $s$select public.import_trip((select v::jsonb from ctx where k='trip'),
  '[{"key":"a","display_name":" ","is_me":true}]'::jsonb, '[]'::jsonb, '[]'::jsonb)$s$, '22023');
select pg_temp.must_fail('empty name', $s$select public.import_trip('{"name":"","default_currency":"EUR"}'::jsonb, (select v::jsonb from ctx where k='members'), '[]'::jsonb, '[]'::jsonb)$s$, '22023');
select pg_temp.must_fail('bad trip currency', $s$select public.import_trip('{"name":"T","default_currency":"EU"}'::jsonb, (select v::jsonb from ctx where k='members'), '[]'::jsonb, '[]'::jsonb)$s$, '22023');
select pg_temp.must_fail('end before start', $s$select public.import_trip('{"name":"T","default_currency":"EUR","start_date":"2026-10-10","end_date":"2026-10-01"}'::jsonb, (select v::jsonb from ctx where k='members'), '[]'::jsonb, '[]'::jsonb)$s$, '22023');

-- Limits.
select pg_temp.must_fail('51 members', format($s$select public.import_trip((select v::jsonb from ctx where k='trip'), %L::jsonb, '[]'::jsonb, '[]'::jsonb)$s$,
  (select jsonb_agg(jsonb_build_object('key', 'k' || i, 'display_name', 'P' || i, 'is_me', i = 1))::text from generate_series(1, 51) i)), '22023');
select pg_temp.must_fail('5001 expenses', format($s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'), %L::jsonb, '[]'::jsonb)$s$,
  (select jsonb_agg('{}'::jsonb)::text from generate_series(1, 5001))), '22023');
select pg_temp.must_fail('2001 settlements', format($s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'), '[]'::jsonb, %L::jsonb)$s$,
  (select jsonb_agg('{}'::jsonb)::text from generate_series(1, 2001))), '22023');

select pg_temp.check('failed imports left nothing behind', pg_temp.count_trips()::text = (select v from ctx where k = 'trips_before'));

-- A later bad expense rolls back the earlier good ones and the trip itself.
select pg_temp.must_fail('rollback on a late failure', $s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'),
  '[{"title":"ok","amount":10,"currency":"EUR","category_key":"food","paid_by_key":"m0","shares":[{"member_key":"m0","amount":10}]},
    {"title":"bad","amount":10,"currency":"EUR","category_key":"food","paid_by_key":"m0","shares":[{"member_key":"m0","amount":9}]}]'::jsonb, '[]'::jsonb)$s$, '22023');
select pg_temp.check('nothing left after the late failure', pg_temp.count_trips()::text = (select v from ctx where k = 'trips_before'));

-- Exactly at the limits is fine (50 members).
set local role authenticated;
insert into ctx select 'fifty', public.import_trip((select v::jsonb from ctx where k='trip'),
  (select jsonb_agg(jsonb_build_object('key', 'k' || i, 'display_name', 'P' || i, 'is_me', i = 1))
     from generate_series(1, 50) i), '[]'::jsonb, '[]'::jsonb)::text;
reset role;
select pg_temp.check('50 members are accepted', (select count(*) = 50 from trip_members where trip_id = (select v::uuid from ctx where k='fifty')));

-- JPY (0 decimals) keeps its precision.
set local role authenticated;
insert into ctx select 'jpy', public.import_trip('{"name":"Tokyo","default_currency":"JPY"}'::jsonb,
  '[{"key":"a","display_name":"A","is_me":true},{"key":"b","display_name":"B","is_me":false}]'::jsonb,
  '[{"title":"Sushi","amount":1000,"currency":"JPY","category_key":"food","paid_by_key":"a","shares":[{"member_key":"a","amount":500},{"member_key":"b","amount":500}]},
    {"title":"Coffee","amount":3.5,"currency":"EUR","fx_rate":160.5,"fx_source":"cache","category_key":"food","paid_by_key":"b","shares":[{"member_key":"a","amount":1.75},{"member_key":"b","amount":1.75}]}]'::jsonb,
  '[{"from_key":"b","to_key":"a","amount":250.4}]'::jsonb)::text;
reset role;
select pg_temp.check('JPY: foreign amount_default rounded to whole yen (3.5 * 160.5 = 561.75 -> 562)',
  (select amount_default = 562 from trip_expenses where title = 'Coffee'));
select pg_temp.check('JPY: settlement rounded to whole yen', (select amount = 250 from trip_settlements where trip_id = (select v::uuid from ctx where k='jpy')));

-- 3. Access control ------------------------------------------------------------
select pg_temp.check('security definer with search_path pinned',
  (select prosecdef and proconfig @> array['search_path=public'] from pg_proc where oid = 'public.import_trip(jsonb,jsonb,jsonb,jsonb)'::regprocedure));
select pg_temp.check('authenticated can execute', has_function_privilege('authenticated', 'public.import_trip(jsonb,jsonb,jsonb,jsonb)', 'execute'));
select pg_temp.check('anon cannot execute', not has_function_privilege('anon', 'public.import_trip(jsonb,jsonb,jsonb,jsonb)', 'execute'));
select pg_temp.check('public has no execute', not exists (
  select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.oid = 'public.import_trip(jsonb,jsonb,jsonb,jsonb)'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'));

select pg_temp.as_user('');
select pg_temp.must_fail('not signed in', $s$select public.import_trip((select v::jsonb from ctx where k='trip'), (select v::jsonb from ctx where k='members'), '[]'::jsonb, '[]'::jsonb)$s$, '28000');

-- create_trip is untouched and still works.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
set local role authenticated;
insert into ctx select 'plain', public.create_trip('Still works', 'EUR', null, null, null, array['Sara'])::text;
reset role;
select pg_temp.check('create_trip still seeds 8 categories and 2 members',
  (select count(*) = 8 from trip_categories where trip_id = (select v::uuid from ctx where k='plain'))
  and (select count(*) = 2 from trip_members where trip_id = (select v::uuid from ctx where k='plain')));

rollback;
select 'import_trip assertions passed' as result;
