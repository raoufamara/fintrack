# Fintrack - Personal Budgeting App

## Product Requirements Document (PRD)

**Version:** 1.0
**Date:** 2026-03-28
**Status:** Final

---

## 1. Vision & Purpose

Fintrack helps individuals gain full visibility into their personal finances. No more guessing where money goes — every dollar is accounted for and broken down by category.

The app guides users in choosing a budgeting strategy that fits their lifestyle and provides clear, actionable insights on their spending.

---

## 2. Target Users

### Phase 1 (MVP)
- **Individuals** wanting better insight into personal spending
- **Low financial literacy** — the app should be approachable, guided, and jargon-free

### Future Phases
- Couples and families (shared expenses, joint budgets)
- Travel groups (expense splitting)
- Expert mode for advanced users (custom rules, deeper analytics)

---

## 3. Core Features — MVP (Phase 1)

### 3.1 User Authentication & Account Management
- Email/password sign-up and login
- OAuth (Google, Apple) via Supabase Auth
- User profile management
- Secure session handling
- Password reset flow

### 3.2 Dashboard (Home Screen)
The main screen users see after login. Includes:
- **Greeting** with user's name
- **Total balance** display (with privacy toggle to hide amount)
- **Budget prompt** (if no budget set) — card prompting user to set up a budget
- **Spending insight widget** (if budget is set) — shows amount spent vs. remaining for the current month
- **Recent transactions** list with category icons, merchant name, and amounts

### 3.3 Budget Setup & Strategy Selection

#### Budget Strategy Wizard (Onboarding)
Users are guided to pick a budgeting approach:

| Strategy | Description |
|----------|-------------|
| **Envelope / Category-based** | Allocate fixed amounts per category. Track spending against those limits. |
| **50/30/20 Rule** | 50% needs, 30% wants, 20% savings. High-level, simple. |
| **Zero-based** | Every dollar of income gets assigned a purpose until $0 is unallocated. |
| **Tracking only** | No preset limits. Just categorize and see where money went. |

- Wizard is shown on first use or when no budget exists
- Wizard asks a few questions about spending habits and recommends a strategy
- **Skip option** available ("I'll set this up later")
- Strategy can be changed anytime from settings

#### Budget Creation
- Set total monthly budget amount
- Quick-select preset amounts ($100, $200, $500, $1,000) or custom entry
- Assign amounts to categories
- Shows "amount left to allocate" in real time
- Success confirmation screen after creation

### 3.4 Categories

#### Preset Categories (Owner-managed)
The app ships with a curated set of categories. Users cannot create custom categories in Phase 1.

Suggested preset list:
- Housing / Rent
- Groceries
- Transportation
- Dining Out
- Entertainment
- Health / Medical
- Fitness
- Shopping
- Education
- Utilities & Bills
- Subscriptions
- Charity / Donations
- Self Care
- Personal
- General / Other

Each category has:
- Name
- Icon (from Vuesax icon set)
- Color (from the design system palette)
- Budget allocation amount (user-configurable)

### 3.5 Manual Transaction Entry
- Add income or expense transactions
- Fields:
  - **Amount** (numeric keypad input)
  - **Category** (select from preset list)
  - **Description / Merchant name** (free text)
  - **Date** (defaults to today, can backdate)
  - **Type** (income / expense)
- Recurring transaction support:
  - Mark a transaction as recurring (daily, weekly, bi-weekly, monthly)
  - Auto-generates future entries only (no backfill)
  - Examples: salary, rent, Netflix subscription

### 3.6 Spending Insights & Reports

#### Monthly Budget Overview
- Month selector (navigate between months)
- Total budget vs. total spent vs. remaining
- Progress bar (visual fill)
- "Adjust" option to modify budget mid-month

#### Category Breakdown
- List of all categories with:
  - Spent amount / Budget limit
  - Progress bar (color-coded)
  - Over-budget warning (red) when limit exceeded
  - Transaction count per category

#### Category Detail View
- Drill into a single category
- Donut/progress visualization of usage
- Over-budget indicator with exact overage amount
- Transaction list filtered to that category

#### Dashboard Charts
- Pie chart: spending distribution by category
- Bar chart: month-over-month comparison
- Trend line: spending over time

### 3.7 Budget Management

#### Adjust Category Limits
- Custom numeric keypad for entering new limit
- Shows current limit for reference
- Apply timing options:
  - Apply immediately (current month)
  - Apply next month (next billing cycle)
- Success confirmation

#### Category Management
- Rename category
- Adjust limit
- Delete category (with confirmation)

### 3.8 Currency
- **CAD only** in Phase 1
- All amounts displayed in Canadian Dollars
- No currency conversion

---

## 4. Screens (from Figma Design)

| # | Screen | Route | Description |
|---|--------|-------|-------------|
| 1 | Dashboard (Home) | `/` | Main screen — balance, actions, budget prompt or insight widget, recent transactions |
| 2 | Dashboard (Post-budget) | `/` | Same as above but with spending insight widget replacing budget prompt |
| 3 | Budget Strategy Wizard | `/onboarding/strategy` | Choose budgeting approach (envelope, 50/30/20, zero-based, tracking) |
| 4 | Create Budget | `/budget/create` | Set total amount, allocate to categories |
| 5 | New Category (Bottom Sheet) | `/budget/create` (overlay) | Create new category with icon, name, color |
| 6 | Budget Created Success | `/budget/success` | Confirmation with category summary |
| 7 | Spending Allocation | `/insights` | Monthly overview with category progress bars |
| 8 | Category Detail | `/insights/:categoryId` | Single category breakdown with transactions |
| 9 | Manage Category (Bottom Sheet) | `/insights/:categoryId` (overlay) | Rename, adjust limit, delete |
| 10 | Adjust Limit | `/insights/:categoryId/adjust` | Numeric keypad to set new limit |
| 11 | Set Billing Cycle (Bottom Sheet) | `/insights/:categoryId/adjust` (overlay) | Choose when adjustment applies |
| 12 | Budget Adjusted Success | `/insights/:categoryId/adjusted` | Confirmation of adjustment |

### Screens NOT in Figma (to be designed)
- Sign up / Login
- Budget Strategy Wizard
- Add Transaction form
- Transaction history (full list)
- Profile / Settings

---

## 5. Navigation Structure

### Bottom Tab Bar
| Tab | Icon | Phase 1 Status |
|-----|------|----------------|
| **Home** | Home | Active — full functionality |
| **Profile** | User | Settings, account management, strategy selection |

### Navigation Flows
```
Auth (Login/Signup)
  |
  +--> Budget Strategy Wizard (first time only, skippable)
  |
  +--> Dashboard (Home)
         |-- [Set up now] --> Create Budget
         |       |-- [Add category] --> New Category (sheet)
         |       |-- [Get Started] --> Budget Created Success
         |               |-- [View dashboard] --> Dashboard (with insight)
         |
         |-- [Spending widget] --> Spending Allocation
         |       |-- [Category tap] --> Category Detail
         |               |-- [Three dots] --> Manage Category (sheet)
         |               |-- [Adjust] --> Adjust Limit
         |                       |-- [Timing] --> Billing Cycle (sheet)
         |                       |-- [Confirm] --> Adjusted Success
         |
         |-- [+ Add transaction] --> Add Transaction form
         |-- [View all transactions] --> Transaction History
```

---

## 6. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Frontend (Web)** | React + TypeScript | Widely supported, large ecosystem |
| **Frontend (Mobile)** | React Native (Expo) | Code sharing with web, cross-platform iOS/Android |
| **Styling** | Tailwind CSS (web), NativeWind (mobile) | Utility-first, fast development |
| **Backend** | Supabase | Auth, Postgres DB, Row-Level Security, Realtime — all-in-one |
| **Database** | PostgreSQL (Supabase) | Relational, strong typing, RLS for security |
| **Hosting (Web)** | Vercel | Zero-config React deployment, edge functions |
| **State Management** | Zustand or React Context | Lightweight, minimal boilerplate |
| **Charts** | Recharts (web) / react-native-chart-kit (mobile) | Popular, well-maintained |
| **Icons** | Vuesax / Lucide | Matches Figma designs |

---

## 7. Data Model (Core Entities)

### Users
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Supabase auth user ID |
| email | string | Unique |
| display_name | string | |
| budget_strategy | enum | envelope, 50_30_20, zero_based, tracking_only |
| currency | string | "CAD" (hardcoded Phase 1) |
| created_at | timestamp | |
| onboarding_completed | boolean | Has user completed wizard |

### Categories
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | |
| name | string | "Groceries", "Transport", etc. |
| icon | string | Icon identifier |
| color | string | Hex color code |
| sort_order | int | Display ordering |
| is_active | boolean | Soft delete |

### Budgets
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | |
| user_id | UUID | FK to users |
| month | date | First day of budget month (2026-03-01) |
| total_amount | decimal | Total monthly budget |
| created_at | timestamp | |

### Budget Allocations
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | |
| budget_id | UUID | FK to budgets |
| category_id | UUID | FK to categories |
| allocated_amount | decimal | Amount budgeted for this category |

### Transactions
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | |
| user_id | UUID | FK to users |
| category_id | UUID | FK to categories |
| amount | decimal | Positive value always |
| type | enum | income, expense |
| description | string | Merchant/description |
| date | date | Transaction date |
| is_recurring | boolean | |
| recurrence_rule | string | daily, weekly, biweekly, monthly (nullable) |
| parent_transaction_id | UUID | If generated from recurring, points to template |
| created_at | timestamp | |

---

## 8. Design System Tokens

### Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `primary` | `#7340FE` | Buttons, CTAs, accents |
| `primary-dark` | `#2F1D4F` | Headings on light purple bg |
| `primary-light` | `#F3EDFE` | Category icon backgrounds |
| `primary-tint` | `#F4F0FF` | Light background sections |
| `surface` | `#FFFFFF` | Card backgrounds |
| `background` | `#F8F9FA` | Page background |
| `text-primary` | `#181818` | Main text |
| `text-secondary` | `#929292` | Secondary text |
| `text-tertiary` | `#BABABA` | Labels, placeholders |
| `success` | `#249A0E` | Income, positive |
| `error` | `#FE3428` | Over-budget, errors |
| `warning` | `#EF9700` | Caution states |

### Typography
| Style | Font | Weight | Size |
|-------|------|--------|------|
| Display | Manrope | 700 | 40px |
| H1 | Manrope | 700 | 32px |
| H2 | Manrope | 600 | 28px |
| H3 | Manrope | 700 | 20px |
| H4 | Manrope | 700 | 18px |
| Body | Manrope | 500 | 14px |
| Body Bold | Manrope | 600 | 14px |
| Caption | Manrope | 500 | 12px |
| Button | Manrope | 600 | 16px |

### Border Radius
| Token | Value | Usage |
|-------|-------|-------|
| `radius-xl` | 28px | CTAs, large buttons |
| `radius-lg` | 18px | Cards |
| `radius-md` | 13px | Small buttons |
| `radius-sm` | 8px | Pills, tags |
| `radius-xs` | 4px | Progress bars |

---

## 9. Non-Functional Requirements

### Security
- All data encrypted in transit (HTTPS)
- Supabase Row-Level Security (RLS) — users can only access their own data
- No plaintext storage of sensitive information
- Balance privacy toggle (eye icon to hide amounts)

### Performance
- Dashboard loads in < 2 seconds
- Transaction list supports pagination (50 per page)
- Charts render within 1 second

### Accessibility
- Minimum AA contrast ratios
- Screen reader support for key flows
- Touch targets minimum 44x44px (mobile)

### Data Privacy
- Users can export their data (CSV)
- Users can delete their account and all associated data
- No data sold or shared with third parties

---

## 10. Phasing Roadmap

### Phase 1 — MVP (Current)
- User auth (email, Google, Apple)
- Budget strategy wizard (skippable)
- Dashboard with balance, insight widget, recent transactions
- Budget creation with category allocation
- Manual transaction entry (income + expense)
- Recurring transactions
- Spending insights (monthly overview, category breakdown)
- Category detail with transaction list
- Budget adjustment (immediate or next month)
- Charts (pie, bar, trend)
- CAD only
- Web app (React) — ship first

### Phase 2 — Enhanced
- React Native mobile app (shared codebase with web)
- Bank sync via Plaid API (auto-import transactions)
- Payment method tagging (cash, credit, debit, cheque)
- Multiple accounts (checking, savings, credit card)
- Push notifications & alerts ("80% of grocery budget used")
- Transaction search & filters
- Data export (CSV)

### Phase 3 — Social & Advanced
- Couples/family mode (shared budgets, joint categories)
- Travel group expense splitting
- Expert mode (custom rules, advanced analytics, forecasting)
- Multi-currency support
- Bill reminders & calendar view
- Savings goals with progress tracking
- Debt payoff tracker

---

## 11. Open Questions

All resolved. See git history for original questions and decisions.

| # | Question | Resolution |
|---|----------|------------|
| 1 | Preset categories | 15 categories finalized — Health & Fitness split into Health/Medical and Fitness |
| 2 | Wizard approach | Ask questions about habits, then recommend a strategy |
| 3 | Missing screen designs | Auth, wizard, add transaction, history, profile — to be designed during build |
| 4 | Cards & Rewards tabs | Removed — not in MVP |
| 5 | Quick actions (Deposit/Transfer) | Removed — replaced by floating + button for transactions |
| 6 | Recurring transactions | Future entries only, no backfill |

---

## 12. References

- **Figma Designs:** [Fintrack Figma](https://www.figma.com/design/KsKG6Vz8WKIo2CmUjeXHIA/Fintrack-app---budgetting-app--Community-?node-id=0-3098)
- **Supabase Docs:** https://supabase.com/docs
- **React Docs:** https://react.dev
- **Expo Docs:** https://docs.expo.dev
