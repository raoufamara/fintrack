# Fintrack Trips — Design Spec

**Status:** Ready for implementation
**Date:** 2026-10-11 (rev. 3: guest read-only link, personal display currency, no link to the personal budget)
**Mockups:** https://claude.ai/artifact/3P8TtTUbNBC6ts25AStqkF (13 phone screens, 390×844. Screen 2 is interactive: tap the category chips.)

---

## 1. What we're building and why

Trips is a group expense tracker for travellers. It covers the same core job as Tricount and Splitwise: log who paid for what, split it, and settle up. It also fixes two gaps in Tricount and adds two things travellers need:

| Need | Our answer |
|---|---|
| **Filter expenses by category** (missing in Tricount) | **Category chips** sit on the trip's main screen and filter in one tap. A **filter sheet** combines category, location, payer and dates. Totals always follow the active filter. |
| **Optional location on expenses** (missing in Tricount) | Every expense can carry a place. It's one tap to attach, never required, and it powers filtering and spending by place. |
| **Add and update categories** | Each trip starts with 8 default categories. Members can add, rename, recolour, re-icon, reorder, hide and delete them. |
| **Multi-country, multi-currency trips** | Each expense can be in any currency. Everything is converted to the trip's **default currency** for totals and balances. Rates come from a free API and are **cached on the device**, so adding expenses works offline. |
| **See it in my own currency** | Each person can pick a personal **display currency** (e.g. CAD). Totals and balances are also shown as an approximate conversion ("≈ CA$9.92"). This is for display only; the trip itself never changes. |
| **Friends without an account** | A **view-only share link** works without signing up. Guests pick "Who are you?" to see their own balance, and can join with one tap to add expenses. |

### Design principles
1. **Adding an expense takes under 10 seconds.** Only amount and title are required. Everything else has a smart default.
2. **Filtering is always one tap away.** The chips stay visible above the list.
3. **A total always matches what's on screen.** When a filter is active, the total, the count and "your share" are recalculated for the filtered set.
4. **Location is optional and private by default.** We suggest a location but never attach one silently.
5. **Offline doesn't block entry.** Currency conversion never needs the network at the moment you add an expense.
6. **Build it as a separable module.** Trips may become its own app, so it must not depend on the personal-budget code (see §2.1).

### Out of scope for v1
- **Any link to the personal budget. This is a decision, not a deferral:** trip expenses never create personal `transactions` and never count toward monthly budgets.
- Balances shown in several currencies. v1 converts everything to the trip's default currency; a later version may keep a balance per currency.
- Receipt photos and OCR
- Map view
- Bank sync
- Itemised bills (splitting line items)
- Push notifications
- Full offline-first sync of expenses. v1 caches **rates** for offline use; expense writes still need the network, with optimistic UI and a retry queue (§7.3).

---

## 2. Information architecture

Add a **Trips** tab to `AppLayout` between Home and Insights, using the lucide icon `Plane`.

```
/trips                              Trips list                     (screen 1)
/trips/new                          Create trip (name, dates, default currency, members, budget)
/trips/join/:code                   Join via invite code/link
/trips/import                       Import a Splitwise CSV as a new trip
/trips/:tripId                      Trip expenses (main)           (screen 2)
   ?cat=<id>,<id>&place=Lisbon,none&payer=<memberId>&from=2026-10-03&to=2026-10-10&mine=1&q=tram
/trips/:tripId/filters              Filter sheet (overlay)         (screen 3; filtered result is screen 4)
/trips/:tripId/expenses/new         Add expense                    (screen 5)
/trips/:tripId/expenses/:id         Expense detail / edit (same form, prefilled)
/trips/:tripId/location             Location picker (overlay)      (screen 6)
/trips/:tripId/currency             Currency picker (overlay)      (screen 9)
/trips/:tripId/insights             Insights by category & place   (screen 7)
/trips/:tripId/balances             Balances & settle up           (screen 8)
/trips/:tripId/categories           Manage categories              (screen 10)
/trips/:tripId/categories/new       Add category (sheet)           (screen 11)
/trips/:tripId/categories/:id       Edit category (sheet)          (screen 11)
/trips/:tripId/settings             Members, default currency, my display currency, budget, share & invite links, archive

/t/:shareToken                      Guest view, read-only, NO login   (screen 12)
/t/:shareToken/balances             Guest balances
/t/:shareToken/insights             Guest insights
```

`/t/*` routes sit **outside** `ProtectedRoute`. They're the only Trips routes reachable without a session.

Keep the **filter state in the URL query**. The back button then works, a filtered view can be shared, and the Insights screen can link into a filtered list.

The trip header has three icon buttons (44×44) on the right: **Insights** (`PieChart`), **Balances** (`Scale`) and **Settings** (`Settings`).

### 2.1 Module boundary (so Trips can become a standalone app)
- Put all code under `src/features/trips/`, with subfolders `pages/`, `components/`, `lib/`, `services/`, `store/` and `types.ts`.
- Allowed imports from outside: only `@/lib/supabase`, the auth store, and the shared UI primitives (`BottomSheet`, `Button`, design tokens). **Never** import from budget, category or transaction code, or from `PRESET_CATEGORIES`.
- Trips tables use the `trip_` prefix and reference only `public.users`.
- Routes are registered via one exported `tripsRoutes` element, so a standalone shell can mount them at `/`.
- Add an ESLint `no-restricted-imports` rule for `src/features/trips/**` to enforce the boundary.

---

## 3. Categories (editable, per trip)

### 3.1 Defaults
When a trip is created, it gets these 8 categories. They're ordinary rows, so all of them can be edited too.

| key | Name | Icon | Colour key |
|---|---|---|---|
| `stay` | Stay | `bed-double` | blue |
| `food` | Food & drinks | `utensils` | rust |
| `transport` | Transport | `train-front` | teal |
| `activity` | Activities | `ticket` | purple |
| `groceries` | Groceries | `shopping-basket` | green |
| `shopping` | Shopping | `shopping-bag` | pink |
| `fees` | Fees & tips | `circle-dollar-sign` | grey |
| `other` | Other | `ellipsis` | grey |

`key` is kept only on seeded rows, so category auto-guessing (§3.4) still works after a rename. Custom categories have `key = null`.

### 3.2 Colour palette (curated, accessible)
Users pick from a fixed palette, not free hex. Each colour has an `fg` value, used for icons and selected chips with white text, and a `bg` value, used for icon tiles. Every `fg` passes 4.5:1 against white and against its `bg`.

| Colour key | fg | bg |
|---|---|---|
| blue | `#1460D8` | `#E3EEFF` |
| rust | `#B8470F` | `#FFF1E6` |
| teal | `#0B7A82` | `#E2F5F6` |
| purple | `#6430E8` | `#F3EDFE` |
| green | `#1F7F0C` | `#EDF7EC` |
| pink | `#C02675` | `#FFEFF7` |
| grey | `#555555` | `#F1F1F1` |

Store the **colour key** (`'pink'`), never the hex value, so the palette can be retuned later, e.g. for dark mode.

### 3.3 Icon set
Offer a curated list of about 40 lucide icon names relevant to travel, in `src/features/trips/lib/categoryIcons.ts`. Show 11 in the grid plus a "More" button that opens the full list. Store the lucide name string, and render it through a map from name to component. Never use dynamic `import()` per icon.

Suggested set: bed-double, hotel, tent, utensils, coffee, wine, beer, pizza, train-front, plane, bus, car, ship, bike, fuel, ticket, landmark, camera, mountain, waves, music, shopping-bag, shopping-basket, shirt, gift, heart-pulse, pill, sparkles (spa), scissors, wifi, smartphone, circle-dollar-sign, receipt, hand-coins, baby, dog, briefcase, graduation-cap, ellipsis, tag.

### 3.4 Rules
- **Who can edit:** any trip member. Changes are shared with everyone on the trip and appear for others via Realtime.
- **Name:** 1–24 characters, trimmed, and unique within the trip, case- and accent-insensitive ("Café" and "cafe" clash). On a clash, show the inline error: "There's already a category called Café".
- **Reorder:** drag handle on the manage screen. The order drives the picker grid, and the order of chips that have the same spend.
- **Hide** (`hidden_at`): the category disappears from the add-expense grid and from filter chips with zero results. Existing expenses keep it and still show it. Hidden categories are listed under "Hidden" with a **Show** button.
- **Delete:**
  - If the category has **0 expenses**, ask "Delete Hammam & spa?" and delete it.
  - If it **has expenses**, show a sheet: "Move its 3 expenses to…" with a category picker (default **Other**), then **Move & delete**. This happens in one RPC (`delete_trip_category(category_id, move_to)`).
  - The last remaining visible category can't be hidden or deleted.
- **Creating from the add-expense form:** the "New" tile opens the same sheet. After saving, the form selects the new category.
- **Auto-guess** (phase 3): keyword match on the title, mapped to `key`, applied only if that seeded category still exists and isn't hidden. Example: `airbnb|hotel|hostel` → stay, `train|uber|taxi|bus|flight|metro|tram` → transport.
- **Default for the next expense:** the category used last by this member on this trip.

### 3.5 Personal defaults (later, not v1)
"Save my categories as default for new trips" is useful once Trips is standalone. The design leaves room for it: a `user_category_presets` table can later seed new trips instead of the 8 built-ins.

---

## 4. Screens

All screens are mobile-first. Content is max-width `md` and centred on desktop. Touch targets are at least 44px.

### 4.1 Trips list (screen 1)
- **Ongoing trips** use the large dark card (`#0B3B3D`). It shows name, dates, members, the default currency, "Day X of Y", spend vs budget, and your balance line.
- **Past trips** use compact cards with "Settled" or "Open balance".
- **Buttons:** "New trip" (primary) and "Join with code" (secondary).
- **Empty state:** an illustration slot, one line of copy, and a "New trip" button.

**Create trip form:**
- Name (required)
- Dates (optional)
- **Default currency** (required): the currency for totals and balances. It defaults to the user's home currency (CAD). Helper text: "Totals and balances are shown in this currency. You can still add expenses in any currency."
- Optional budget, in the default currency
- Members: name-only is fine; people can claim their name later via the invite link.

Settings can change the default currency later. Changing it **re-converts every expense** using cached or fetched rates for each expense's date. Before applying, show a confirmation with the new totals.

### 4.2 Trip expenses: main screen (screen 2)
1. **Header (dark).** Back button, avatars, dates, default currency, trip name. Two stat tiles: **Group spent** (in the default currency, with a budget bar) and **Your balance** (links to Balances).
2. **Search field.** Matches the title, place name and city.
3. **Filter button.** Opens the sheet and shows a count badge when non-chip filters are active.
4. **Category chip row.** Scrolls horizontally. "All" comes first, then **only categories used on this trip**, ordered by spend descending (ties broken by `sort_order`). The chips are multi-select (OR within categories).
5. **Summary line.** "N expenses (· filtered)" on the left, the filtered total in the default currency on the right.
6. **Expense list.**
   - Grouped by day with sticky day headers.
   - Each row has a category icon tile, the title, and a meta line: "{payer} paid · [pin] {place}". The place is left out when there isn't one.
   - The amount on the right is in the **default currency**.
   - **If the expense was in another currency**, a second line shows the original amount, e.g. "240.00 MAD".
   - An expense whose rate is still **pending** (§7.3) shows a small "rate pending" tag instead of the converted amount. It is left out of totals until the rate resolves, and the summary line says "+1 pending".
7. **"Add expense"** floating button.

**States:** loading skeleton, no expenses yet, and no filter results (with "Clear filters").

### 4.3 Filter sheet (screen 3)
- **Category:** multi-select chips with live counts. Hidden categories appear only if they have expenses.
- **Location:** city chips with counts, plus a dashed **"No location"** chip.
- **Paid by:** single-select.
- **"Only expenses I'm part of":** a toggle.
- **Dates:** From/To.
- **Footer CTA:** "Show N expenses · {total in default currency}".

**Filter semantics:**
- Values within one facet combine with **OR**. Facets combine with **AND**.
- Selecting a location excludes expenses that have no location, unless "No location" is also selected.
- When that happens, the results screen shows: "2 expenses without a location are hidden by the Lisbon filter. **Include them**".
- *Later:* a **Currency** facet (expenses paid in MAD). Leave a slot for it in `TripExpenseFilter`.

### 4.4 Filtered results (screen 4)
- Removable pills for active filters, plus "Clear all".
- **Summary card:** the filtered total, its % of the trip total, a stacked bar by category, and "Your share of these".
- The list is grouped by day.

### 4.5 Add / edit expense (screen 5)

| Field | Required | Default | Notes |
|---|---|---|---|
| Amount | yes | — | Large numeric input. Respect the currency's minor units (JPY has 0 decimals, KWD has 3). |
| Currency | yes | the currency **last used by this member on this trip**, else the trip default | A button left of the amount opens the currency picker (screen 9). |
| Converted line | — | — | Shown when the currency differs from the default: "= €22.18 in trip currency · rate 0.0924 · cached 2h ago". When offline with no cached rate: "Rate pending — will convert when online", or tap to type a rate. |
| Title | yes | — | "What was it?" |
| Category | yes | last used by this member on this trip, else **Other** | Grid of visible categories in `sort_order`, plus a **New** tile. An **Edit** link goes to screen 10. |
| Paid by | yes | current member | |
| Split | yes | equally between all members | Equal (choose members) · Exact amounts · Shares. Exact amounts are entered **in the expense's currency** and must sum to its total. |
| Date | yes | today | |
| Location | no | empty | "Use here: {area}, {city}" and "Search" (see §4.6) |
| Note | no | — | Behind "More" |

### 4.6 Location picker (screen 6)
- Search with a 300 ms debounce and a minimum of 2 characters.
- **"Current location"** is the first row.
- **Results:** place name, street, area and city, and distance.
- **"Used on this trip":** chips of places already used on this trip.
- **"Can't find it?":** saves the typed text as a free-text place, with a best-guess city.
- **"Skip — no location".**
- Geolocation is requested only after the user taps.

### 4.7 Insights (screen 7)
- A segmented control: **Group total** / **My share**.
- **Tiles:** Spent, Per day, Left (budget minus spent).
- **By category:** a stacked bar plus rows. Each row links to `?cat=<id>`.
- **By place:** one row per city plus "No location". Each row links to `?place=<city>`.
- **By currency** (small card, v1): "Paid in MAD: 1,840 MAD (= €170)". It helps travellers see cash needs per country.
- All figures are in the default currency.

### 4.8 Balances & settle up (screen 8)
- **Net balance per member**, in the **default currency**. Positive is green ("gets back"). Negative is amber `#B25E00` ("owes").
- **Settle-up list:** the fewest transfers. The current user's own transfer comes first, with **Mark as paid**; others have **Remind**.
- **A settlement is recorded in the default currency.** Paying in another currency is out of scope for v1, but leave a `currency` and `fx_rate` on settlements so it can be added.
- A footnote under the list: "Converted to EUR at the rate saved on each expense."

### 4.9 Currency picker (screen 9)
- **Status banner:**
  - "Rates saved on this phone, updated 2h ago. Works offline." (green)
  - When rates are older than 7 days: "Rates from Oct 1 — connect to refresh" (amber)
- **"On this trip" section:** the trip default (labelled "Trip currency"), then currencies already used on this trip, most recent first. Each row shows the rate against the default ("1 MAD = €0.0924").
- **Search all currencies:** by ISO code, name or country ("dirham", "Morocco"). The list comes from the cached rate table plus a bundled `currencies.json` with code, name, symbol, minor units and countries.
- **"Rate for this expense" editor:**
  - Prefilled from the cache.
  - The user can override it, e.g. to match a card statement or an exchange booth.
  - "Reset" restores the cached rate.
  - Copy: "The rate is locked on the expense so balances never shift later."
- Picking a currency returns to the form.

### 4.10 Manage categories (screen 10) and add/edit category (screen 11)
- **Screen 10:**
  - A short explainer, then the visible categories in `sort_order`. Each row has an icon tile, the name, an expense count, and a drag handle.
  - Custom categories get a "CUSTOM" badge and "Added by {member}".
  - Below that, a **Hidden** section with a **Show** button per category.
  - A primary **"Add category"** button.
  - Tapping a row opens screen 11.
- **Screen 11 (bottom sheet):**
  - A live **preview** (icon tile and chip).
  - **Name** (24 characters max).
  - **Icon** grid (11 icons plus More).
  - **Colour** swatches (7). Each swatch is at least 44px and labelled for screen readers.
  - **Hide** and **Delete** buttons (Delete is styled destructive), following the rules in §3.4.
  - **Save.**
  - In "new" mode: the title is "New category", there's no Hide/Delete, and the default colour is the least-used colour on the trip.

### 4.11 Guest view: read-only share link (screen 12)
**Sharing (trip settings):**
- A "Share view-only link" toggle, **on** by default for new trips.
- Copy link, and **Reset link**, which rotates the token so old links stop working.
- This is separate from the **invite to join** link/code, which needs an account.

**What guests see:**
- A slim amber bar: "View only · shared by {creator}".
- The trip header, then a **"Who are you?"** chip row of all members. Picking a name shows that member's balance and their settle-up line ("Malik owes Sara €146.09").
  - The choice is stored in `localStorage` under `trip-guest:{tripId}`. It's only a viewing preference; it proves nothing about identity.
- The same expense list, category chips, filter sheet, insights and balances, in read-only mode:
  - no Add button
  - no edit on tap (the expense detail opens read-only)
  - no "Mark as paid"
  - no category management
- A sticky footer CTA: **"Join as {picked name} to add expenses"**, or "Join to add expenses" if no name is picked. It goes to sign-up, then `join_trip(code, member_id)` links the account to that member, so their past expenses stay theirs.
- Guests also get the **display currency** toggle (§4.12). Their default comes from the browser locale, and it's stored in `localStorage`.

**What guests never see:**
- account emails, or `user_id`s
- the invite (join) code
- who created or edited each expense
- **exact coordinates.** `place_lat`/`place_lng` are dropped from the public payload; names and cities are kept.

**Empty and error states:**
- A link that is revoked or reset, or a sharing toggle that is off: "This link no longer works. Ask the trip owner for a new one."
- An archived trip still loads, with a "Trip archived" chip.

### 4.12 My display currency (screen 13)
- **Concept:** each viewer can see amounts in their own currency, on top of the trip's default currency. It's **display only**: balances, settlements and stored data stay in the trip default.
- **Where it's set:**
  - A **"Show in"** segmented control on Balances and Insights: "{trip ccy} · trip" | "{my ccy} · mine".
  - Trip settings → "My display currency".
  - **Default:** the user's home currency (`users.currency`, CAD today). For guests, the browser locale's currency. If that equals the trip default, the toggle is hidden.
- **How amounts show when "mine" is on:**
  - The primary figure is "≈ CA$507.12", with the trip-currency figure underneath ("€329.17").
  - The `≈` sign is **always** shown, because the conversion is approximate.
  - A note under the control: "Approximate, at 1 EUR = 1.5406 CAD (saved 2h ago). Balances and payments stay in EUR."
- **Which rate:** the **latest cached** default→display rate, applied to the final figures (totals, balances, transfers). It is *not* applied per expense. The point is "what does this cost me now", and it stays consistent with the settle-up amounts.
- **Offline:** use the cached rate whatever its age, and show its age. With no cached rate, hide the toggle and show the trip currency.
- **Applies to:** the trip header tiles, Balances, settle-up cards (as "≈ CA$9.92 on your card"), Insights tiles, and the category/place rows.
- **Doesn't apply to:** the expense list rows, which keep the trip currency plus the original currency, so there aren't three amounts per row. The filtered total line *does* show the display currency.
- **Who sees it:** the choice is personal. Other members keep seeing their own choice.

---

## 5. Data model (Supabase migration `002_trips.sql`)

```sql
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  default_currency char(3) not null,             -- ISO 4217; totals & balances
  start_date date,
  end_date date,
  budget_amount numeric(14,2),                   -- in default_currency
  invite_code text unique not null default substr(md5(gen_random_uuid()::text), 1, 8),  -- join (needs account)
  share_token text unique not null default encode(gen_random_bytes(18), 'base64'),     -- view-only link; generate URL-safe (replace +/ and strip =) in create_trip; requires pgcrypto
  share_enabled boolean not null default true,
  created_by uuid not null references public.users(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  display_name text not null,
  user_id uuid references public.users(id) on delete set null,   -- null until claimed
  color text not null,
  display_currency char(3),                       -- personal "show in" currency; null = users.currency
  created_at timestamptz not null default now(),
  unique (trip_id, user_id)
);

create table public.trip_categories (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  key text,                                       -- 'stay','food',… for seeded rows; null for custom
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
create extension if not exists unaccent;
create function public.immutable_unaccent(t text) returns text
  language sql immutable parallel safe as $$ select public.unaccent('public.unaccent'::regdictionary, t) $$;
create unique index uq_trip_categories_name
  on public.trip_categories (trip_id, lower(public.immutable_unaccent(btrim(name))));

create table public.trip_expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  category_id uuid not null references public.trip_categories(id),   -- no cascade: delete RPC reassigns first
  title text not null check (length(title) between 1 and 120),
  amount numeric(14,3) not null check (amount > 0),                  -- in original currency (3 dp for KWD etc.)
  currency char(3) not null,
  fx_rate numeric(20,10),                         -- 1 unit of currency -> default_currency; null = pending
  fx_source text check (fx_source in ('cache','api','manual','same')),
  fx_date date,                                   -- date of the rate table used
  amount_default numeric(14,2),                   -- round(amount * fx_rate, 2); null while pending
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

create table public.trip_expense_shares (
  expense_id uuid not null references public.trip_expenses(id) on delete cascade,
  member_id uuid not null references public.trip_members(id) on delete cascade,
  weight numeric(8,3) not null default 1,
  amount numeric(14,3) not null,                  -- share in the expense's original currency (exact)
  primary key (expense_id, member_id)
);

create table public.trip_settlements (
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

create index idx_trip_expenses_trip_date on public.trip_expenses(trip_id, date desc);
create index idx_trip_expenses_trip_cat on public.trip_expenses(trip_id, category_id);
create index idx_trip_expenses_trip_city on public.trip_expenses(trip_id, place_city);
create index idx_trip_categories_trip on public.trip_categories(trip_id, sort_order);
create index idx_trip_members_user on public.trip_members(user_id);
```

**Why the shares are stored in the original currency:** the split stays exact in the currency the bill was actually in. The conversion to the default currency happens once per expense, in `computeBalances` (§6). This means a rate correction on one expense fixes everything that depends on it.

**RLS and write model (hardened).** Members can read everything in their trips; almost every write goes through a validating RPC. Direct table writes are limited to a few harmless columns, by column-level grants plus RLS.
- The helper `is_trip_member(trip_id)` is `security definer` and checks `trip_members.user_id = auth.uid()`. `anon` has no table access at all.
- **SELECT** is allowed on every `trip_*` table for members. `trip_expense_shares` is checked through its parent expense.
- **`trip_expenses`, `trip_expense_shares`, `trip_settlements`:** no direct insert, update or delete. Use `upsert_trip_expense`, `delete_trip_expense` and `record_settlement`.
- **`trips`:** direct UPDATE of `name`, `start_date`, `end_date`, `budget_amount` and `archived_at` only. `default_currency`, `share_token`, `share_enabled` and `invite_code` change only through RPCs. Insert only via `create_trip`; no delete for now.
- **`trip_members`:** direct UPDATE of `display_name`, `color` and `display_currency` only. A trigger lets only the member themself (`user_id = auth.uid()`) change `display_currency`. `user_id` changes only inside `join_trip`. Insert only via `create_trip`, `join_trip` and `add_trip_member` (always `user_id` null). No delete for now.
- **`trip_categories`:** direct UPDATE of `name`, `icon`, `color` and `hidden_at`. A trigger checks the icon against the curated list, refuses to hide the last visible category and maintains `updated_at`. Insert via `create_trip_category`, delete via `delete_trip_category`, reorder via `reorder_trip_categories`.

**RPCs** (`security definer`, `set search_path = public`, transactional, explicit grants; each checks membership through `auth.uid()` except `get_shared_trip` and `join_trip`, which work by token or code):
- `create_trip(name, default_currency, start, end, budget, member_names[])` inserts the trip, the creator's member row, the other members, and the **8 default categories**. Returns the trip id.
- `join_trip(code, member_id default null)` claims an unclaimed member row, or creates a new member. Returns the caller's member id.
- `add_trip_member(trip_id, name)` adds a name-only member.
- `upsert_trip_expense(expense jsonb, shares jsonb)` checks that `sum(shares.amount) = amount`, that the category and members belong to the trip, and computes `amount_default`. It is idempotent on `client_id`. Returns the expense id.
- `delete_trip_expense(expense_id)`
- `record_settlement(trip_id, from, to, amount, client_id default null)` validates both members, `from <> to`, `amount > 0`, and records it in the trip default currency. Idempotent on `client_id`.
- `preview_trip_invite(code)` (authenticated only) returns the trip name, dates, default currency and the unclaimed members (`id`, `display_name`), so someone can see what they are joining and which name is theirs. Nothing else.
- `create_trip_category(trip_id, name, icon, color)` validates the colour key and icon; a duplicate name raises `23505`.
- `delete_trip_category(category_id, move_to uuid default null)` reassigns expenses, then deletes the category. It refuses if expenses exist and `move_to` is null, or if this is the last visible category.
- `reorder_trip_categories(trip_id, ordered_ids uuid[])`
- `get_shared_trip(token text)`: **granted to `anon` and `authenticated`**, `security definer`, read-only.
  - Returns `null` unless `share_enabled` is true and the token matches.
  - Otherwise returns one JSON document: the trip (without `invite_code`, `share_token` and `created_by`), a `shared_by` display name, members (`id`, `display_name`, `color` only), categories, expenses (without `created_by`, `client_id`, `place_lat`, `place_lng`, `place_provider_id`), shares, and settlements.
  - **Rate limiting:** the token has 144 bits of entropy, which makes guessing impossible. Supabase's API rate limits apply on top. Never log the token.
  - Guest pages use only this RPC. They make no direct table reads, and RLS stays closed to `anon`.
- `rotate_share_token(trip_id)` and `set_share_enabled(trip_id, bool)`: members only.
- `set_trip_default_currency(trip_id, currency, rates jsonb)` re-converts every expense with the rates the client supplies (`{ "<CCY>": { "<expense date YYYY-MM-DD>": rate, "latest": rate } }`, to the new default) and updates `default_currency` atomically. Expenses without a rate become pending; settlements and the budget are converted too, which needs the old default's `latest` rate.

Assertions for this model live in `supabase/tests/002_trips_hardening.sql` (run on a scratch Postgres).

**Relation to REQUIREMENTS.md §3.8:** personal budgeting stays CAD-only. Trips is the first multi-currency module.

---

## 6. Business logic (pure functions, Vitest-tested)

These live in `src/features/trips/lib/` and have no Supabase or network imports. All money is handled as **integer minor units**. Use `minorUnits(currency)` from `currencies.json`.

- **`splitAmount(totalMinor, mode, memberIds, weights?, exact?)`** returns shares in the expense's currency. Use floor division, then hand out the leftover units one each in a stable order (sorted by member id). The shares always sum to the total.
- **`toDefault(amountMinor, currency, fxRate, defaultCurrency)`** converts with banker's rounding to the default currency's minor units.
- **`computeBalances(expenses, shares, settlements, defaultCurrency)`** returns a map of member to minor units in the default currency.
  - **Skip** expenses with `fx_rate = null` (pending), and return their ids as `pendingIds` so the UI can flag them.
  - For each expense:
    1. Compute `totalDefault = round(amount × rate)` once.
    2. Compute the shares in the default currency by **re-splitting `totalDefault` in proportion to the original shares**, using the same largest-remainder method.
    3. Add `totalDefault` to the payer.
    4. Subtract each member's converted share from that member.
  - This keeps the invariant that **all balances sum exactly to 0**, even after currency conversion.
  - Then apply settlements.
- **`toDisplay(amountMinorDefault, defaultCurrency, displayCurrency, rate)`** returns `{ minor, approx: true }`. It's used only for rendering; never persist the result.
- **`suggestTransfers(balances)`:** greedy matching of the largest debtor with the largest creditor. The current user's transfers come first.
- **`filterExpenses(expenses, filter, ctx)`:**

```ts
interface TripExpenseFilter {
  categoryIds: string[]         // [] = all
  places: (string | 'none')[]
  payer: string | null
  mine: boolean
  from: string | null
  to: string | null
  q: string                     // title, place_name, place_city; case/accent-insensitive
  // reserved: currencies: string[]
}
```

It returns `{ items, totalDefault, myShareDefault, pendingCount, countByCategory, countByPlace, hiddenNoLocationCount }`. Facet counts are computed with that facet's own filter removed. Also write `parseFilter` and `serializeFilter`, which round-trip with the URL.

Filtering runs on the client over all of a trip's expenses, which are loaded once.

**Tests must cover:**
- Shares sum to the total for JPY (0 decimals), EUR (2) and KWD (3).
- Balances sum to 0 across mixed currencies.
- Pending expenses are excluded and reported.
- Deleting a category reassigns expenses correctly (this test is on the RPC).
- The filter round-trips through the URL.
- A renamed category still filters by id.

---

## 7. Services

### 7.1 Places (`services/placesService.ts`)
- Use **Photon** (`https://photon.komoot.io/api?q=…&lat=…&lon=…&limit=8`) behind the `PlaceResult` interface: `searchPlaces` and `reverseGeocode`.
- Time out after 5 seconds, then fall back to free text.
- Never store a location the user didn't pick.

### 7.2 Exchange rates (`services/fxService.ts`), with an offline cache

**Provider (free, no API key, 150+ currencies including MAD, VND, THB and ARS):**
- Primary: `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/{base}.json` (lowercase codes). The response looks like `{ "date": "2026-10-11", "eur": { "mad": 10.82, … } }`.
- Fallback mirror for the same data: `https://latest.currency-api.pages.dev/v1/currencies/{base}.json`
- Historical rates (for backdated expenses and for changing the default currency): `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{YYYY-MM-DD}/v1/currencies/{base}.json`
- Optional second source, if accuracy complaints arise: Frankfurter (`api.frankfurter.app`). It uses ECB data but covers only about 30 currencies, so it isn't enough on its own for travel.
- **The URLs above couldn't be tested from the design environment because its network blocks them.** Verify them in the first implementation PR.

**Cache:**
- **Store:** IndexedDB via `idb-keyval`, which is tiny. Key: `fx:{base}:{date}`. Value: `{ base, date, fetchedAt, rates: Record<string, number> }`.
- Keep the **latest** table for each trip's default currency.
- Also keep historical tables that were fetched for specific dates, in an LRU of 60 entries.
- **When to refresh:**
  - On app start, and when the device comes back online.
  - When a trip is opened, if the latest table for its default currency is **older than 12h**.
  - Refreshes happen in the background and never block the UI.
- **Getting a rate:** `getRate(from, to, date)`. Rates are stored per base currency, so a cross rate can be computed from any cached table: `from→to = rates[to] / rates[from]`.
  1. If the currencies are the same, the rate is `1` and the source is `same`.
  2. If a cached table exists for that `date`, use it.
  3. If the date is today, or no historical table exists, use the latest cached table, however old. Return `{ rate, source: 'cache', ageHours }` so the UI can show "cached 2h ago". Show an amber note when the age is over 7 days.
  4. If online, fetch the table, cache it, and use it.
  5. Otherwise return `null`, so the expense is **pending**.
- **Pending expenses** are saved with `fx_rate = null`. A reconciler runs when the device comes online or a trip is opened. It fills in the rate for the expense's date and updates the expense. The user can also type a manual rate at any time; that sets `fx_source = 'manual'`, and the reconciler never overwrites a manual rate.
- **Warm the cache:** after creating or opening a trip, prefetch the latest table for its default currency, so the first expense abroad already has a rate.
- **Bundled data:** `currencies.json` (code, name, symbol, minor units, countries) for the picker. It works offline even with no rate table yet.

### 7.3 Writes without network (minimal, v1)
- Writes go through a small **retry queue**, persisted in IndexedDB and holding `{client_id, op, payload}`.
- The expense appears immediately (optimistic) with a "Not synced" tag.
- The queue is flushed when the device comes back online.
- `client_id` makes `upsert_trip_expense` idempotent.
- Full multi-device offline conflict resolution is out of scope.

---

## 8. Components (`src/features/trips/components/`)

| Component | Used on |
|---|---|
| `TripCard` (featured / compact) | Trips list |
| `TripHeader` | Trip main |
| `CategoryChipRow` | Trip main |
| `CategoryIcon` (renders the icon tile from category `icon` + `color`) | Everywhere |
| `ExpenseRow` (with original-currency line, rate-pending tag, not-synced tag) | Lists |
| `DayGroupHeader`, `ActiveFilterPills`, `StackedBar` | Lists, Insights |
| `FilterSheet` (on a shared `BottomSheet`) | Overlay |
| `AmountInput` (currency-aware decimals) and `CurrencyButton` | Add expense |
| `CurrencyPicker`, `RateEditor`, `RateStatusBanner` | Overlay |
| `CategoryGrid` (visible categories + New tile) | Add expense |
| `CategoryList` (sortable with drag handle; use `@dnd-kit/sortable`), `CategoryEditSheet`, `MoveExpensesSheet` | Manage categories |
| `LocationField`, `LocationPicker` | Add expense |
| `SplitEditor` | Add expense |
| `MemberAvatar`, `AvatarStack`, `BalanceRow`, `TransferCard` | Many |

**Store:** `store/tripStore.ts` (Zustand) holds `trip`, `members`, `categories`, `expenses`, `shares`, `settlements`, `currentMemberId` and `syncQueue`. It subscribes to Supabase Realtime on `trip_expenses` and `trip_categories` for the open trip.

---

## 9. Design tokens (additions to `src/index.css`)

```css
--color-text-muted: #6F6F6F;   /* AA-compliant caption grey; existing #929292 fails 4.5:1 */
--color-owe: #B25E00;
--color-sheet-scrim: rgba(24, 16, 40, 0.6);
/* category palette (§3.2) */
--color-cat-blue: #1460D8;   --color-cat-blue-bg: #E3EEFF;
--color-cat-rust: #B8470F;   --color-cat-rust-bg: #FFF1E6;
--color-cat-teal: #0B7A82;   --color-cat-teal-bg: #E2F5F6;
--color-cat-purple: #6430E8; --color-cat-purple-bg: #F3EDFE;
--color-cat-green: #1F7F0C;  --color-cat-green-bg: #EDF7EC;
--color-cat-pink: #C02675;   --color-cat-pink-bg: #FFEFF7;
--color-cat-grey: #555555;   --color-cat-grey-bg: #F1F1F1;
```

The existing `--color-cat-*` tokens are used by personal budgeting. Name the new ones `--color-tripcat-*` if they clash.

---

## 10. Accessibility checklist
- Chips and swatches are `<button aria-pressed>`. Swatches have colour names as `aria-label`s.
- The drag reorder has a keyboard alternative: "Move up" and "Move down" in each row's menu.
- Bottom sheets trap focus, close on Esc and on a scrim tap, and return focus to the button that opened them.
- Amounts are formatted with `Intl.NumberFormat(locale, { style: 'currency', currency })` everywhere. Original and converted amounts are both announced.
- A category is never conveyed by colour alone: there's always an icon plus the name.

---

## 11. Build plan (one PR per phase)

**Phase 1: foundation**
- The migration, RPCs and RLS.
- `types.ts`.
- `lib/` with money (minor units), `splitAmount`, `toDefault`, `computeBalances`, `suggestTransfers`, `filterExpenses`, and parse/serialize for filters.
- `currencies.json`.
- Vitest, and the ESLint module-boundary rule.
- *Acceptance:* all the tests in §6 pass.

**Phase 2: trips and expenses, single currency**
- Trips tab, trips list, create trip (with the default currency), the main screen, and add/edit/delete expense with an equal split.
- The 8 seeded categories appear in the grid.
- *Acceptance:* 3 name-only members and 5 expenses give the correct balances.

**Phase 3: category filtering and editing**
- `CategoryChipRow`, `FilterSheet`, the filtered results screen, URL-synced filters.
- Manage categories: add, rename, change icon and colour, reorder, hide/show, and delete with move-to.
- The New tile in the add-expense form.
- *Acceptance:*
  - Selecting Food + Activities gives the correct list and total.
  - Renaming Food to "Restaurants" updates the chips and the existing expenses.
  - Deleting a category with 3 expenses moves them to the chosen category.
  - A duplicate name is rejected.

**Phase 4: multi-currency and the offline rate cache**
- `fxService` with IndexedDB caching, the currency picker, the rate editor, the converted line, and pending rates with the reconciler.
- The "By currency" card.
- Changing the default currency in Settings.
- *Acceptance:*
  - Turn on airplane mode after one online session, add an expense in MAD, and it converts using the cached rate.
  - Clear the cache while offline: the expense saves as pending and resolves when the device is back online.
  - A manual rate is never overwritten.
  - Balances sum to 0.

**Phase 5: location**
- `placesService`, `LocationField`, `LocationPicker`, the location facet and the hidden-expenses notice.

**Phase 6: balances, insights, joining**
- Settle up, Insights, the invite link with `join_trip`, Realtime, and the retry queue.
- **My display currency:** the "Show in" control, `toDisplay`, and the setting in trip settings.
- *Acceptance:* with an EUR trip and CAD display, all tiles and balances show "≈ CA$" using the cached rate, while stored settlements stay in EUR.

**Phase 7: guest view-only link**
- `get_shared_trip`, `/t/:shareToken` routes outside auth, the read-only variants of the main screen, Balances and Insights, "Who are you?", join-as-member, and share settings (toggle, reset link).
- *Acceptance:*
  - In a private window, the link shows the trip and balances, and no write controls exist.
  - The JSON payload contains no emails, coordinates or invite code.
  - After a reset, the old link shows the "no longer works" state.
  - "Join as Malik" leads to sign-up, then Malik's existing expenses belong to the new account.

---

## 12. Decisions log
| # | Question | Decision |
|---|---|---|
| 1 | Tab or standalone app? | It's a tab for now, and **may become its own app**: it's built as an isolated module (§2.1). |
| 2 | Currency model | Each expense can be in any currency. Each trip has one **default currency**, and totals and balances are converted to it. Balances per currency are a later feature. |
| 3 | Rates | A free API (fawazahmed0 currency-api via jsDelivr, with a mirror), cached on the device in IndexedDB, refreshed every 12h when online, and locked on each expense. |
| 4 | Categories | Per trip, seeded with 8 defaults. Members can add, edit, reorder, hide and delete them (delete reassigns expenses). |
| 5 | Trip expenses → personal budget? | **No.** Trips and personal budgeting stay fully separate. |
| 6 | Guests without an account? | **Yes, read-only** via a share link, using "Who are you?" and join-as-member (§4.11). |
| 7 | Show amounts in my own currency? | **Yes, display only**, using the latest cached rate, marked with "≈" (§4.12). |

---

## 13. Import & export

Import creates a **new trip** from a Splitwise group export. Export writes any trip as a CSV in the same layout, so the two round-trip. Code: `lib/splitwiseCsv.ts` (parser), `lib/splitwiseImport.ts` (mapping, verification, payload), `lib/splitwiseExport.ts`, `pages/ImportPage.tsx`, and the RPC `import_trip` in `supabase/migrations/003_trip_import.sql`.

### 13.1 CSV format

Splitwise: group, Settings, "Export as spreadsheet". The format below is based on public knowledge **and one real export** (`lib/__fixtures__/splitwise-real-export.csv`, two people, one currency). **Verify against more real exports**, especially groups with several currencies, more than two people, and non-English accounts.

```
Date,Description,Category,Cost,Currency,Sara Lopez,Malik B,Inès,Raouf
(blank line: the real export has one right after the header)
2026-10-03,Airbnb Alfama,Hotel,480.00,EUR,360.00,-120.00,-120.00,-120.00
2026-10-09,Malik B paid Sara Lopez,Payment,50.00,EUR,-50.00,50.00,0.00,0.00

2026-10-20,Total balance, , ,EUR,288.40,-91.60,-141.60,-55.20
```

- **Columns are found by name** (case-insensitive). Everything after `Currency` is a person; their names are taken from the header, **never from descriptions** (the real export shortens them: "Alex M. paid Sam").
- A person's cell is that person's **net effect on their balance** for the row: positive means they paid more than their share. Each row sums to about 0.
- **Payments:** Category `Payment`, and also a row whose description is exactly "Settle all balances" (the real export gives that one the category General). The positive person paid the negative one. Without this rule, group spending would be inflated.
- **Total balance rows** (one per currency, the date is the export date, Category and Cost hold a space) are used only to verify; they are never imported.
- Tolerated: UTF-8 BOM, CRLF, quoted fields, blank lines anywhere, spaces and `,`/`.` decimal marks in numbers, `;` or tab delimiters, accents, mixed currencies. Dates: `YYYY-MM-DD` preferred; `DD/MM/YYYY` and `MM/DD/YYYY` are fallbacks, and ambiguous ones are flagged with a warning (read as day/month unless other rows show otherwise). Windows-1252 files are decoded when the bytes are not valid UTF-8.

### 13.2 Mapping

| Splitwise row | Result |
|---|---|
| One positive person P | Expense paid by P, split mode `exact`. Shares are `-n` for every negative person; P's share is the rest (`cost - sum of the others`). If it is 0, P is left out of the shares (P paid it all for someone else). Odd cents land on the payer: cost 6.29, nets 3.14 / -3.14 gives P a share of 3.15. |
| Several positive people | The largest is the payer. Each other payer j adds a **balancing payment** j to P of `n_j`, so everyone ends at their `n`. Warning: "row N had several payers". |
| Nets differ from 0 by 1-2 units | Absorbed into the payer's share. More than 2 units: same, plus a warning. |
| All nets 0, or cost 0 | Skipped with a warning (no effect on balances). |
| Shares that cannot add up | Row refused ("Row N: ...") and counted as skipped. |
| Payment | Settlement from the positive to the negative person; with more than two people, matched greedily. |

Categories use a case-insensitive keyword map on the Splitwise category (for "X - Other" the part before " - "), then on the description, else `other`: stay (hotel, rent, lodging, accommodation, airbnb); food (dining, food and drink, restaurant, liquor, coffee); groceries (groceries, water); transport (transportation, taxi, bus, train, plane, flight, car, gas, fuel, parking, bicycle); activity (entertainment, movies, music, sports, games, tickets); shopping (clothing, electronics, gifts, household, furniture); fees (taxes, insurance, services, utilities, medical, cleaning). The preview shows the summary ("Hotel → Stay · 3").

- **Members:** one per person column. "Which one is you?" is required; that member gets the importer's account and keeps the Splitwise name. Others are name-only and can be claimed from the invite link.
- **Trip name:** from the file name without `splitwise`, `expenses`, `export`, dates and month names; if nothing is left, "Trip · Feb 2024" or "Trip · Feb – Mar 2024" from the expense dates. **Dates** are the first and last expense. **Default currency** is the most frequent row currency. All three are editable in the preview.
- **Currencies:** each expense keeps its currency; `fx_rate` comes from `fxService.getRate(rowCcy, default, date)` at import time. No rate means the expense is saved pending and converts later (the success screen says so). **Payments are stored in the default currency**; if a payment needs a rate that is unavailable, the import is blocked: "Connect to the internet to import payments in other currencies".
- **Verification:** balances are computed with `computeBalances` per currency, in each row's own currency, and compared with the Total balance rows (tolerance 1 minor unit per person). The success screen shows "Balances match Splitwise" or the differences. A file without Total balance rows is reported as not compared.
- Limits: 50 people, 5,000 expenses, 2,000 payments, 5 MB.

### 13.3 `import_trip` RPC

`import_trip(p_trip jsonb, p_members jsonb, p_expenses jsonb, p_settlements jsonb) returns uuid`, `security definer`, `set search_path = public`, granted to `authenticated` only. It runs in one transaction, creates the trip like `create_trip` (same 8 categories; `create_trip` is unchanged), and validates every expense like `upsert_trip_expense` (title, amount, currency, split mode, shares >= 0 with no duplicates summing exactly to the amount, `fx_rate`, `amount_default` with `round_half_even`). Members and categories are referenced by client-side keys (`member_key`, `paid_by_key`, `category_key`). Expenses get the note "Imported from Splitwise", `created_by = auth.uid()` and a null `client_id`. Online only: there is no retry queue for imports. The memory repository mirrors the same rules. Assertions: `supabase/tests/003_trip_import.sql`.

### 13.4 Export

Trip Settings, "Export CSV" (not available to guests). The file has the same columns, one column per member with the net effect of each row, payments as `Payment` rows described "{from} paid {to}", then a blank line and one `Total balance` row per currency present. Expenses keep their own currency; the Category column holds our category name. RFC 4180 quoting with CRLF; cells that start with `=`, `+`, `@` or a minus before a non-digit get a leading apostrophe so a spreadsheet does not run them as formulas. Delivery: the share sheet when it can share files (iPhone home-screen app), otherwise a download. File name: `{trip-name-slug}-fintrack-{YYYY-MM-DD}.csv`.

Known limits of the round trip: balances are preserved exactly; an expense where the payer owes the whole amount (all nets 0) is not re-imported, because it has no effect; and the default currency, budget, places and exchange rates are not part of the file.

