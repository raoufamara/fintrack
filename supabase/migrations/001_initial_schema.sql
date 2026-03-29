-- ============================================
-- Fintrack Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Users profile table (extends Supabase auth.users)
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  display_name text not null default '',
  budget_strategy text check (budget_strategy in ('envelope', '50_30_20', 'zero_based', 'tracking_only')),
  currency text not null default 'CAD',
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2. Categories (preset, shared across all users)
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon text not null,
  color text not null,
  sort_order int not null default 0,
  is_active boolean not null default true
);

-- 3. Budgets (one per user per month)
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  month date not null,
  total_amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique(user_id, month)
);

-- 4. Budget allocations (amount per category per budget)
create table public.budget_allocations (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.budgets(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  allocated_amount numeric(12,2) not null default 0,
  unique(budget_id, category_id)
);

-- 5. Transactions
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  category_id uuid not null references public.categories(id),
  amount numeric(12,2) not null,
  type text not null check (type in ('income', 'expense')),
  description text not null default '',
  date date not null default current_date,
  is_recurring boolean not null default false,
  recurrence_rule text check (recurrence_rule in ('daily', 'weekly', 'biweekly', 'monthly')),
  parent_transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ============================================
-- Indexes
-- ============================================
create index idx_budgets_user_month on public.budgets(user_id, month);
create index idx_transactions_user_date on public.transactions(user_id, date);
create index idx_transactions_category on public.transactions(category_id);
create index idx_budget_allocations_budget on public.budget_allocations(budget_id);

-- ============================================
-- Row Level Security (RLS)
-- ============================================

-- Users: can only read/update their own profile
alter table public.users enable row level security;

create policy "Users can read own profile"
  on public.users for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.users for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.users for insert
  with check (auth.uid() = id);

-- Categories: readable by everyone (preset data)
alter table public.categories enable row level security;

create policy "Categories are readable by all authenticated users"
  on public.categories for select
  to authenticated
  using (true);

-- Budgets: users can only access their own
alter table public.budgets enable row level security;

create policy "Users can read own budgets"
  on public.budgets for select
  using (auth.uid() = user_id);

create policy "Users can create own budgets"
  on public.budgets for insert
  with check (auth.uid() = user_id);

create policy "Users can update own budgets"
  on public.budgets for update
  using (auth.uid() = user_id);

create policy "Users can delete own budgets"
  on public.budgets for delete
  using (auth.uid() = user_id);

-- Budget allocations: access through budget ownership
alter table public.budget_allocations enable row level security;

create policy "Users can read own budget allocations"
  on public.budget_allocations for select
  using (
    exists (
      select 1 from public.budgets
      where budgets.id = budget_allocations.budget_id
      and budgets.user_id = auth.uid()
    )
  );

create policy "Users can create own budget allocations"
  on public.budget_allocations for insert
  with check (
    exists (
      select 1 from public.budgets
      where budgets.id = budget_allocations.budget_id
      and budgets.user_id = auth.uid()
    )
  );

create policy "Users can update own budget allocations"
  on public.budget_allocations for update
  using (
    exists (
      select 1 from public.budgets
      where budgets.id = budget_allocations.budget_id
      and budgets.user_id = auth.uid()
    )
  );

create policy "Users can delete own budget allocations"
  on public.budget_allocations for delete
  using (
    exists (
      select 1 from public.budgets
      where budgets.id = budget_allocations.budget_id
      and budgets.user_id = auth.uid()
    )
  );

-- Transactions: users can only access their own
alter table public.transactions enable row level security;

create policy "Users can read own transactions"
  on public.transactions for select
  using (auth.uid() = user_id);

create policy "Users can create own transactions"
  on public.transactions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own transactions"
  on public.transactions for update
  using (auth.uid() = user_id);

create policy "Users can delete own transactions"
  on public.transactions for delete
  using (auth.uid() = user_id);

-- ============================================
-- Auto-create user profile on signup
-- ============================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================
-- Seed preset categories
-- ============================================
insert into public.categories (name, icon, color, sort_order) values
  ('Housing / Rent',      'house',          '#7340FE', 1),
  ('Groceries',           'shopping-cart',   '#249A0E', 2),
  ('Transportation',      'car',            '#1570FF', 3),
  ('Dining Out',          'utensils',       '#EF9700', 4),
  ('Entertainment',       'gamepad-2',      '#FD6FB8', 5),
  ('Health / Medical',    'heart-pulse',    '#FE3428', 6),
  ('Fitness',             'dumbbell',       '#2CAEB7', 7),
  ('Shopping',            'shopping-bag',   '#9E6FF7', 8),
  ('Education',           'graduation-cap', '#1570FF', 9),
  ('Utilities & Bills',   'zap',            '#EF9700', 10),
  ('Subscriptions',       'repeat',         '#2CAEB7', 11),
  ('Charity / Donations', 'hand-heart',     '#FD6FB8', 12),
  ('Self Care',           'sparkles',       '#9E6FF7', 13),
  ('Personal',            'user',           '#1570FF', 14),
  ('General / Other',     'wallet',         '#929292', 15);
