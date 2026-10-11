# Fintrack Trips — Design Spec

**Status:** Ready for implementation
**Date:** 2026-10-11
**Mockups:** https://claude.ai/artifact/3P8TtTUbNBC6ts25AStqkF (8 phone screens, 390×844. Screen 2 is interactive: tap the type chips.)

---

## 1. What we're building and why

Trips is a group expense tracker for travellers, built as a new module of Fintrack. It covers the same core job as Tricount and Splitwise: log who paid for what, split it, and settle up. It also fixes two gaps in Tricount:

| Gap in Tricount | Our answer |
|---|---|
| You can't filter expenses by type | **Type chips** sit on the trip's main screen and filter in one tap. A **filter sheet** combines type, location, payer and dates. Totals always follow the active filter. |
| Expenses have no location | Every expense has an **optional location**. It's one tap to attach ("Use here: Ribeira, Porto"), it's never required, and it powers filtering and spending by place. |

### Design principles
1. **Adding an expense takes under 10 seconds.** Only amount and title are required. Everything else has a smart default (payer = you, split = everyone equally, date = today, type = last used or guessed from the title).
2. **Filtering is always one tap away.** Type chips stay visible above the list. No filter is hidden behind a menu.
3. **A total always matches what's on screen.** When a filter is active, the header total, the count and "your share" are recalculated for the filtered set.
4. **Location is optional and private by default.** We suggest a location but never attach one silently.
5. **Reuse the Fintrack design system.** Use the same tokens, Manrope and radii, so Trips feels native.

### Out of scope for v1
- Receipt photos and OCR
- Live map view
- Bank sync
- Itemised bills (splitting line items)
- Push notifications (the "Remind" button copies a share message instead)
- Offline-first sync (we use optimistic UI only)

---

## 2. Information architecture

Add a **Trips** tab to `AppLayout` between Home and Insights. Use the lucide icon `Plane`.

```
/trips                          Trips list                (screen 1)
/trips/new                      Create trip               (form; see §4.1)
/trips/join/:code               Join via invite code/link
/trips/:tripId                  Trip expenses (main)      (screen 2)
   ?type=food,activity&place=Lisbon&payer=<memberId>&from=2026-10-03&to=2026-10-10&mine=1
/trips/:tripId/filters          Filter sheet (overlay)    (screen 3; filtered result is screen 4)
/trips/:tripId/expenses/new     Add expense               (screen 5)
/trips/:tripId/expenses/:id     Expense detail / edit     (reuse the add form, prefilled)
/trips/:tripId/location         Location picker (overlay) (screen 6)
/trips/:tripId/insights         Insights by type & place  (screen 7)
/trips/:tripId/balances         Balances & settle up      (screen 8)
/trips/:tripId/settings         Members, currency, budget, invite link, archive
```

Keep the **filter state in the URL query**. The Insights screen links into a filtered list, the back button works, and a filtered view can be shared.

The trip header gets three icon buttons (44×44) on the right: **Insights** (`PieChart`), **Balances** (`Scale`) and **Settings** (`Settings`). The mockup only shows the avatars and the balance card, which links to Balances.

---

## 3. Expense types (the filterable dimension)

The types are a fixed, travel-specific list in v1. They are separate from the 15 personal budgeting categories. Store them as a Postgres enum-like `text` with a check constraint, and keep the metadata in `src/lib/tripConstants.ts`.

| id | Label | Lucide icon | Foreground | Background |
|---|---|---|---|---|
| `stay` | Stay | `BedDouble` | `#1460D8` | `#E3EEFF` |
| `food` | Food & drinks | `Utensils` | `#B8470F` | `#FFF1E6` |
| `transport` | Transport | `TrainFront` | `#0B7A82` | `#E2F5F6` |
| `activity` | Activities | `Ticket` | `#6430E8` | `#F3EDFE` |
| `groceries` | Groceries | `ShoppingBasket` | `#1F7F0C` | `#EDF7EC` |
| `shopping` | Shopping | `ShoppingBag` | `#C02675` | `#FFEFF7` |
| `fees` | Fees & tips | `CircleDollarSign` | `#555555` | `#F1F1F1` |
| `other` | Other | `Ellipsis` | `#555555` | `#F1F1F1` |

All foreground colours meet 4.5:1 contrast on their backgrounds and on white. A selected chip uses white text on the foreground colour.

**Type auto-guess** (nice to have, phase 3): match keywords in the title case-insensitively. For example: `airbnb|hotel|hostel` → stay, `train|uber|taxi|bus|flight|metro|tram` → transport, `lunch|dinner|cafe|bar|restaurant|beer` → food. Only pre-select the guess; the user can always change it.

---

## 4. Screens

All screens are mobile-first. Content is max-width `md` and centred on desktop. Touch targets are at least 44px.

### 4.1 Trips list (screen 1)
- **Ongoing trips** use the large dark card (`primary-dark` `#2F1D4F`). It shows name, dates, member count, currency, a "Day X of Y" badge, spend vs budget with a progress bar, and your balance line ("You owe Sara €6.44" or "You're owed €12.00" or "All settled").
- **Upcoming and past trips** use compact white cards. Past trips show "Settled" (green) or "Open balance".
- **Primary CTA:** "New trip". **Secondary:** "Join with code".
- **Empty state:** an illustration slot, the line "Track a trip with friends. Everyone adds what they paid, Fintrack does the maths.", and a "New trip" button.

**Create trip form:** name (required), dates (optional), trip currency (default from locale), optional budget, and members. Members can be added by name only, Tricount-style. A member doesn't need an account; they can claim their name later via the invite link.

### 4.2 Trip expenses: main screen (screen 2)
Top to bottom:
1. **Header (dark).** Back button, member avatars, dates and currency, trip name. Two stat tiles: **Group spent** (with a budget bar if a budget is set) and **Your balance** (links to Balances).
2. **Search field.** Matches title, place name and city.
3. **Filter button.** Opens the sheet and shows a count badge when non-chip filters are active.
4. **Type chip row.** Scrolls horizontally. "All" comes first, then only the types used on this trip, ordered by spend descending. The chips are **multi-select** (OR within types). Tapping "All" clears the type filter.
5. **Summary line.** "7 expenses" or "3 expenses · filtered" on the left, the filtered total on the right.
6. **Expense list.** Grouped by day with sticky day headers (shown in screen 4). Each row has a type icon tile, a title, and a meta line with "{payer} paid · [pin] {place}". The place is omitted when there's no location. Amount is on the right in trip currency. If the expense was in another currency, show a second line in the original currency, e.g. "¥2,400".
7. **"Add expense" floating button.** Bottom right.

**States:**
- **Loading:** skeleton rows.
- **No expenses:** "No expenses yet" plus a CTA.
- **Filter returns nothing:** "Nothing matches these filters" and a "Clear filters" button.

### 4.3 Filter sheet (screen 3)
A bottom sheet. Sections:
- **Type.** Multi-select chips, each with a live count.
- **Location.** Chips grouped by **city**, each with a count, plus a dashed **"No location"** chip. Tapping a selected city again expands it into neighbourhood chips (v2; v1 has cities only).
- **Paid by.** Single-select: Anyone or a member.
- **"Only expenses I'm part of".** A toggle that keeps expenses where the current member has a share.
- **Dates.** From/To, clamped to the trip dates.
- **Footer CTA.** Shows the live result: "Show N expenses · €X". "Reset" sits in the header.

**Filter semantics (important):**
- Values within one facet combine with **OR**. Facets combine with **AND**.
- Selecting a location excludes expenses with no location, unless "No location" is also selected.
- When this happens, the results screen shows the amber notice: "2 expenses without a location are hidden by the Lisbon filter. **Include them**". The link adds `none` to the place filter.

### 4.4 Filtered results (screen 4)
- Active filters appear as removable pills: tinted with the type colour for types, neutral with a pin for places. A "Clear all" link follows them.
- **Summary card:** filtered total, % of trip total, a stacked bar by type within the filter, and **"Your share of these"**.
- The list is grouped by day.

### 4.5 Add / edit expense (screen 5)
**Fields, in order:**

| Field | Required | Default | Notes |
|---|---|---|---|
| Amount | yes | — | Large numeric input. A currency selector sits to its left. |
| Currency | yes | trip currency | If it differs from the trip currency, show "≈ {trip ccy} X at today's rate". The rate is editable in "More". |
| Title | yes | — | "What was it?" |
| Type | yes | last used on this trip, else `other` | 4×2 grid of icon tiles |
| Paid by | yes | current member | Picker sheet |
| Split | yes | equally between all members | Modes: Equally (choose members) · Exact amounts · Shares/weights. Exact amounts must sum to the total, or the Save button is disabled with an inline error. |
| Date | yes | today (clamped to trip dates) | |
| Location | **no** | empty | See below |
| Note | no | — | Behind a "More" disclosure |

**Location field behaviour:**
- **Empty state.** Two buttons: **"Use here: {neighbourhood}, {city}"** and **"Search"**.
- The "Use here" button appears only after the browser grants geolocation and reverse geocoding succeeds. Never prompt for geolocation on screen load. Ask on the first tap of a "Use current location" button, then remember the choice per device.
- **Filled state.** A chip shows the pin, place name, and city, with an × to clear it.
- **Saving without a location is normal**, not an error.

**Footer:** "Save expense" is a full-width primary button. It's disabled until amount > 0 and a title is entered.

### 4.6 Location picker (screen 6)
- A search field with autofocus. Debounce 300 ms, with a minimum of 2 characters.
- **"Current location"** is the first row.
- **Results:** place name (the matched part in bold), street, neighbourhood and city, and distance.
- **"Used on this trip":** chips of places already used on this trip. They're one tap, work offline, and are the most common case.
- **"Can't find it?"** saves the typed text as a free-text place. It still gets a `city`: the city of the user's current location if known, else the city of the trip's most recent located expense, else none.
- **"Skip — no location"** sits at the bottom.

### 4.7 Insights (screen 7)
- A segmented control switches between **Group total** and **My share**.
- **Stat tiles:** Spent, Per day (spent ÷ days elapsed, capped at the trip length), and Left (budget minus spent, shown only if a budget is set).
- **By type:** a stacked bar plus rows. Each row links to `/trips/:id?type=<id>`.
- **By place:** one bar per city plus a "No location" row (grey). Each row links to `/trips/:id?place=<city>`.
- **v2:** spend per day (bar chart), and spend by member.

### 4.8 Balances & settle up (screen 8)
- **Net balance per member.** Positive is green ("gets back"). Negative is shown with the warning colour `#B25E00` ("owes"), not red, because owing money isn't an error.
- **"How to settle up":** the minimal transfer list. The current user's own transfer comes first, highlighted, with **"Mark as paid"**. Other transfers have **"Remind"**, which uses the share sheet with a prefilled message.
- "Mark as paid" creates a `settlement` record. Balances recompute and the transfer disappears.

---

## 5. Data model (Supabase migration `002_trips.sql`)

```sql
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  currency char(3) not null,                     -- ISO 4217, the trip/settlement currency
  start_date date,
  end_date date,
  budget_amount numeric(12,2),                   -- optional, in trip currency
  invite_code text unique not null default substr(md5(gen_random_uuid()::text), 1, 8),
  created_by uuid not null references public.users(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

-- Members can exist without an account (Tricount-style); user_id links when someone claims the name.
create table public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  display_name text not null,
  user_id uuid references public.users(id) on delete set null,
  color text not null,                           -- avatar colour
  created_at timestamptz not null default now(),
  unique (trip_id, user_id)
);

create table public.trip_expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  type text not null default 'other'
    check (type in ('stay','food','transport','activity','groceries','shopping','fees','other')),
  amount numeric(12,2) not null check (amount > 0),        -- in original currency
  currency char(3) not null,
  fx_rate numeric(18,8) not null default 1,                -- original -> trip currency, frozen at entry
  amount_trip numeric(12,2) generated always as (round(amount * fx_rate, 2)) stored,
  paid_by uuid not null references public.trip_members(id),
  split_mode text not null default 'equal' check (split_mode in ('equal','exact','shares')),
  date date not null default current_date,
  note text,
  -- Optional location (all nullable; place_name null = no location)
  place_name text,                -- "Café Santiago" or free text
  place_address text,             -- "R. de Passos Manuel 226"
  place_area text,                -- neighbourhood: "Bolhão"
  place_city text,                -- "Porto"  (the filter/group key)
  place_country char(2),          -- ISO 3166-1 alpha-2
  place_lat double precision,
  place_lng double precision,
  place_provider_id text,         -- provider's place id, for dedupe
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((place_lat is null) = (place_lng is null))
);

-- Who shares each expense and how much (in trip currency, cents-exact; sum = amount_trip)
create table public.trip_expense_shares (
  expense_id uuid not null references public.trip_expenses(id) on delete cascade,
  member_id uuid not null references public.trip_members(id) on delete cascade,
  weight numeric(8,3) not null default 1,         -- used when split_mode = 'shares'
  amount_trip numeric(12,2) not null,             -- resolved share
  primary key (expense_id, member_id)
);

create table public.trip_settlements (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  from_member uuid not null references public.trip_members(id),
  to_member uuid not null references public.trip_members(id),
  amount_trip numeric(12,2) not null check (amount_trip > 0),
  created_at timestamptz not null default now(),
  check (from_member <> to_member)
);

create index idx_trip_expenses_trip_date on public.trip_expenses(trip_id, date desc);
create index idx_trip_expenses_trip_type on public.trip_expenses(trip_id, type);
create index idx_trip_expenses_trip_city on public.trip_expenses(trip_id, place_city);
create index idx_trip_members_user on public.trip_members(user_id);
```

**RLS.** A user can access a trip if they are linked to one of its members. Use a `security definer` helper to avoid recursive policies:

```sql
create function public.is_trip_member(t uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from trip_members where trip_id = t and user_id = auth.uid())
$$;
```

- `trips`: select/update/delete where `is_trip_member(id)`. Insert where `created_by = auth.uid()`.
- `trip_members`, `trip_expenses`, `trip_settlements`: all operations where `is_trip_member(trip_id)`.
- `trip_expense_shares`: access through the parent expense's `trip_id`.
- **Joining.** An RPC `join_trip(code text, member_id uuid default null)`, `security definer`, does one of two things. With a `member_id`, it links `auth.uid()` to that unclaimed member. Without one, it creates a new member. It returns the trip id.
- **Creating a trip.** An RPC `create_trip(...)` inserts the trip and the creator's member row in one transaction. Otherwise the creator can't see their own trip under RLS.
- **Saving an expense with shares.** An RPC `upsert_trip_expense(expense jsonb, shares jsonb)` saves both atomically and checks `sum(shares) = amount_trip`.

**Currency note.** REQUIREMENTS.md §3.8 says the app is CAD only in Phase 1. Trips needs per-trip currency, so this module is the first place multi-currency appears. The personal budget stays CAD.

**FX rates.** Fetch the rate when the currency changes on the form. Use `https://api.frankfurter.app/latest?from=X&to=Y` (free, no key) behind `src/services/fxService.ts`. Cache rates for 12h in memory. The user can override the rate. Store the rate on the expense so balances never change afterwards.

---

## 6. Business logic (pure functions, unit-tested)

Put these in `src/lib/trips/`. They have no Supabase imports.

### 6.1 `splitAmount(totalCents, mode, members[], weights?, exact?) → Map<memberId, cents>`
- Work in **integer cents** only.
- **Equal or shares mode:** use floor division, then hand out the leftover cents one each to members in a stable order (sorted by member id). The result always sums exactly to the total.
- **Exact mode:** validate that the parts sum to the total; throw if not.

### 6.2 `computeBalances(expenses, shares, settlements) → Map<memberId, cents>`
- Start everyone at 0.
- For each expense: add `amount_trip` to the payer, and subtract each member's share from that member.
- For each settlement: add the amount to `from_member` and subtract it from `to_member`.
- Invariant: all balances sum to 0.

### 6.3 `suggestTransfers(balances) → {from, to, cents}[]`
- Use a greedy algorithm: repeatedly match the largest debtor with the largest creditor and transfer the smaller of the two amounts.
- This produces at most n−1 transfers, which is good enough. The theoretical minimum is NP-hard and not worth it.
- Sort the output so transfers involving the current user come first.

### 6.4 `filterExpenses(expenses, filter, currentMemberId)`
```ts
interface TripExpenseFilter {
  types: ExpenseType[]          // [] = all
  places: (string | 'none')[]   // city names, or 'none' for no location; [] = all
  payer: string | null          // member id
  mine: boolean                 // only where current member has a share
  from: string | null           // ISO date
  to: string | null
  q: string                     // matches title, place_name, place_city (case/accent-insensitive)
}
```
- Also write `parseFilter(searchParams)` and `serializeFilter(filter)`, which round-trip with the URL.
- Return `{ items, total, myShare, countByType, countByPlace, hiddenNoLocationCount }`. The facet counts in the filter sheet are computed with **that facet's own filter removed**, so each count shows what you'd get by toggling it.

Filtering happens **on the client**. A trip has hundreds of expenses, not tens of thousands, so load all of them once per trip and filter in memory. This keeps filtering instant and lets it work offline-ish. Revisit if a trip ever exceeds 2,000 expenses.

---

## 7. Location service

Put this behind an interface so the provider can be swapped:

```ts
// src/services/placesService.ts
export interface PlaceResult {
  name: string; address?: string; area?: string; city?: string; country?: string
  lat: number; lng: number; providerId: string; distanceM?: number
}
export function searchPlaces(query: string, near?: {lat: number; lng: number}): Promise<PlaceResult[]>
export function reverseGeocode(lat: number, lng: number): Promise<PlaceResult | null>
```

- **v1 provider: Photon** (`https://photon.komoot.io/api?q=...&lat=..&lon=..&limit=8`). It's free, needs no API key, and is built on OpenStreetMap. Map its `name`, `street`/`housenumber`, `district`/`locality` → area, `city`, `countrycode`.
- **Later:** swap in Mapbox or Google Places if quality isn't good enough. Nothing else changes.
- **Failures must not block saving.** If search errors or times out (5s), show "Search unavailable — save as text" and fall back to free text.
- **Privacy.** Store only what the user picked; never record a trail of locations. Request geolocation only after a tap.

---

## 8. Components to build (`src/components/trips/`)

| Component | Used on |
|---|---|
| `TripCard` (variants `featured` and `compact`) | Trips list |
| `TripHeader` (dark header with stat tiles) | Trip main |
| `TypeChipRow` (multi-select, horizontal scroll, `aria-pressed`) | Trip main |
| `ExpenseRow` (type tile, title, payer · place, amount, optional original currency) | Main, filtered results |
| `DayGroupHeader` | Lists |
| `ActiveFilterPills` | Filtered results |
| `FilterSheet` (reusable `BottomSheet` + facet sections) | Overlay |
| `TypeGrid` (4×2 selectable tiles) | Add expense |
| `LocationField` (empty / suggesting / filled states) | Add expense |
| `LocationPicker` | Overlay |
| `SplitEditor` (equal / exact / shares) | Add expense |
| `MemberAvatar`, `AvatarStack` | Many |
| `BalanceRow`, `TransferCard` | Balances |
| `StackedBar` (plain divs, no chart library needed) | Filtered results, Insights |

Store: `src/stores/tripStore.ts` (Zustand). It holds `trip`, `members`, `expenses`, `shares`, `settlements` and `currentMemberId`, plus actions for load/add/update/delete with optimistic updates. Subscribe to Supabase Realtime on `trip_expenses` for the open trip, so friends' expenses appear live.

---

## 9. Design tokens (additions to `src/index.css`)

Reuse the existing tokens, and add:

```css
--color-text-muted: #6F6F6F;      /* AA-compliant secondary text; #929292 fails 4.5:1 on white */
--color-owe: #B25E00;              /* "owes" amounts: amber, not error red */
--color-sheet-scrim: rgba(24, 16, 40, 0.6);
/* + the 8 type fg/bg pairs from §3 as --color-type-<id> / --color-type-<id>-bg */
```

Use `text-muted` for every caption in Trips. Accessibility note for the wider app: `text-secondary #929292` fails WCAG AA for body text. Consider swapping it app-wide later.

---

## 10. Accessibility checklist
- Chips are `<button aria-pressed>`. The chip row has `role="group" aria-label="Filter by type"`.
- The bottom sheet traps focus, closes on Esc and on a scrim tap, and returns focus to the button that opened it.
- Amounts are announced with their currency: use `Intl.NumberFormat` with `style: 'currency'` everywhere. Never concatenate "€" by hand.
- Type is never conveyed by colour alone: there's always an icon plus a label (in chips and grid) or an icon plus a row title.
- Every icon-only button has an `aria-label`.

---

## 11. Build plan (one PR per phase)

**Phase 1: foundation**
- Migration `002_trips.sql`, the RPCs, RLS, and TS types in `src/types/trips.ts`.
- `src/lib/trips/` with `splitAmount`, `computeBalances`, `suggestTransfers`, `filterExpenses`, `parseFilter` and `serializeFilter`, plus **Vitest** unit tests. Add `vitest` as a dev dependency and a `test` script.
- *Acceptance:* tests pass. Shares and balances always sum exactly. A filter round-trips through the URL.

**Phase 2: trips and expenses (no location)**
- Trips tab, the trips list, create trip, the trip main screen, and add/edit/delete expense with equal split.
- *Acceptance:* create a trip with 3 name-only members, add 5 expenses, and see the correct "Your balance" figure.

**Phase 3: type filtering (gap #1)**
- `TypeChipRow`, `FilterSheet` with type, payer, mine and dates, the filtered results screen, URL-synced filters, and the empty filter state.
- *Acceptance:* selecting Food + Activities shows only those, with the correct total and count. The back button restores the previous filter.

**Phase 4: location (gap #2)**
- `placesService`, `LocationField`, `LocationPicker`, the location facet with "No location", and the hidden-expenses notice.
- *Acceptance:* save expenses with a searched place, a current-location place, a free-text place, and no place. Filter by city. Expenses with no location are counted correctly.

**Phase 5: balances, insights, multi-currency, sharing**
- Balances and settle-up, Insights, `fxService` with currency on the expense, the invite code/link with `join_trip`, and Realtime.
- *Acceptance:* a second account joins via link, claims "Malik", adds an expense, and it appears live for the first account. "Mark as paid" brings the balances to zero.

---

## 12. Open questions for the product owner
1. Should Trips stay a tab inside Fintrack, or become a standalone app later? This spec assumes a tab.
2. Should trip expenses that **you** paid also flow into your personal monthly budget (e.g. as a "Travel" transaction for your share)? This is useful, but it's out of scope for v1.
3. Can guests (no account) view a trip read-only via the link, like Tricount, or must everyone sign up?
