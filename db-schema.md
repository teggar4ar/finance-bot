# Personal Finance Telegram Bot: Database Schema

| | |
|---|---|
| **Version** | 0.2 (draft) |
| **Date** | 2026-11-03 |
| **Database** | PostgreSQL (production: Heroku Postgres, development: local PostgreSQL via Laragon) |
| **Related documents** | FR-NFR.md (v0.3), [CONTEXT.md](./CONTEXT.md), [docs/adr](./docs/adr/) |

---

## 1. Design Principles

1. **Transactions are the single source of truth.** Balances, budget usage, summaries, and running balances are always derived from the `transactions` table. No balance is stored as a standalone number (FR-021, NFR-012).
2. **Money is a whole number.** All amounts are `bigint` Rupiah, always positive. The direction (in or out) comes from the transaction `type` (NFR-010).
3. **Soft delete only.** Undo sets `undone_at`, delete sets `deleted_at`. Rows are never physically removed by normal commands (NFR-014).
4. **Timestamps are UTC.** Day, week, and month boundaries in WIB (`Asia/Jakarta`) are computed in the application and passed to queries as UTC ranges (NFR-040, NFR-042).
5. **Portable SQL.** Constraints use `CHECK` instead of Postgres enums, and queries prefer `CAST(... AS BIGINT)` and `CASE` over Postgres-only syntax where practical. Postgres-specific constructs are listed in section 8 (NFR-051, NFR-052).
6. **Idempotent setup.** `schema.sql` can be run repeatedly without errors (NFR-056).
7. **An opening balance is row zero.** It is always ordered before every other row, because it represents money that existed before all recorded transactions (ADR-0003).

---

## 2. Overview

Two tables and one view. The tables are independent (no foreign keys between them).

| Object | Kind | Purpose |
|---|---|---|
| `transactions` | table | Every financial event: opening balances, expenses, income, transfers |
| `budgets` | table | History of the daily budget amount, with the date each value took effect |
| `ledger_entries` | view | Active transactions expanded into per-account rows (a transfer becomes two rows). Used for balances and CSV export |

Deferred: a `category` column and a `category_keywords` table will be added when automatic categorization is implemented (see section 9).

---

## 3. Table: `transactions`

### 3.1 Columns

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `bigint` identity | no | generated | Primary key. Shown to the user for `/edit` and `/hapus` |
| `occurred_at` | `timestamptz` | no | `now()` | When the transaction was recorded (UTC). No backdating in v1. For `opening` it is only the declaration time (ADR-0003) |
| `type` | `text` | no | | `opening`, `expense`, `income`, or `transfer` |
| `account` | `text` | no | | `tunai` or `bank`. For a transfer, this is the **source** account |
| `to_account` | `text` | yes | | Destination account. Used only when `type = 'transfer'` |
| `amount` | `bigint` | no | | Whole Rupiah, strictly greater than 0 |
| `description` | `text` | no | `''` | Free text. The application requires it for expense/income and fills it for opening and transfer rows |
| `undone_at` | `timestamptz` | yes | | Set by `/undo`, cleared by `/redo` |
| `deleted_at` | `timestamptz` | yes | | Set by `/hapus`, or when redo history is discarded by a new transaction |

**Active transaction:** `undone_at IS NULL AND deleted_at IS NULL`.

### 3.2 Which columns each type uses

| `type` | Meaning | `account` | `to_account` | Effect on balance |
|---|---|---|---|---|
| `opening` | Opening balance | the account | NULL | + `amount` on `account`. Always the first row of the export (ADR-0003) |
| `income` | Income | account receiving money | NULL | + `amount` on `account` |
| `expense` | Expense | account paying | NULL | - `amount` on `account` |
| `transfer` | Move money between accounts | source | destination (must differ from source) | - `amount` on `account`, + `amount` on `to_account`; total unchanged |

### 3.3 Constraints

- `account` and `to_account` must be `tunai` or `bank`.
- `type` must be one of the four values.
- `amount > 0`. Because this covers every type, an opening balance cannot be negative (v1).
- A `transfer` must have `to_account` set and different from `account`. Every other type must have `to_account` NULL.

### 3.4 Indexes

Data volume is tiny (a few thousand rows per year), so indexes are for tidiness more than speed.

| Index | Purpose |
|---|---|
| `idx_transactions_occurred_at (occurred_at, id)` | Range queries for summaries, budget usage, and export |
| `idx_transactions_undone (id) WHERE undone_at IS NOT NULL AND deleted_at IS NULL` | Quickly find redo candidates (partial index, Postgres-specific, can be dropped safely) |

---

## 4. Table: `budgets`

### 4.1 Columns

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `bigint` identity | no | generated | Primary key |
| `amount` | `bigint` | no | | Daily budget in Rupiah, strictly greater than 0 |
| `effective_from` | `date` | no | | First WIB day this budget applies to. **Unique** |
| `created_at` | `timestamptz` | no | `now()` | Audit only |

### 4.2 Rules

- The budget for a given day is the row with the **latest `effective_from` on or before that day**. If no such row exists, no budget applies and no warnings are shown (FR-088).
- Setting the budget with `/budget <amount>` writes a row with `effective_from` = today (WIB). Running it again the same day **replaces** that day's value (upsert on the unique `effective_from`).
- Changing the budget never affects earlier days, because earlier days resolve to earlier rows (FR-083).

---

## 5. Complete `schema.sql`

```sql
-- schema.sql: idempotent, safe to run on every deploy/start.

CREATE TABLE IF NOT EXISTS transactions (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  type         TEXT        NOT NULL,
  account      TEXT        NOT NULL,
  to_account   TEXT,
  amount       BIGINT      NOT NULL,
  description  TEXT        NOT NULL DEFAULT '',
  undone_at    TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ,

  CONSTRAINT chk_tx_type       CHECK (type IN ('opening', 'expense', 'income', 'transfer')),
  CONSTRAINT chk_tx_account    CHECK (account IN ('tunai', 'bank')),
  CONSTRAINT chk_tx_to_account CHECK (to_account IS NULL OR to_account IN ('tunai', 'bank')),
  CONSTRAINT chk_tx_amount     CHECK (amount > 0),
  CONSTRAINT chk_tx_transfer   CHECK (
    (type = 'transfer' AND to_account IS NOT NULL AND to_account <> account)
    OR (type <> 'transfer' AND to_account IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at
  ON transactions (occurred_at, id);

CREATE INDEX IF NOT EXISTS idx_transactions_undone
  ON transactions (id)
  WHERE undone_at IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS budgets (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  amount         BIGINT      NOT NULL,
  effective_from DATE        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_budget_amount CHECK (amount > 0),
  CONSTRAINT uq_budget_effective_from UNIQUE (effective_from)
);

-- Active transactions expanded into one row per affected account.
-- A transfer yields two rows: leg 1 = money out of the source,
-- leg 2 = money into the destination.
CREATE OR REPLACE VIEW ledger_entries AS
SELECT
  id,
  occurred_at,
  type,
  account,
  description,
  CASE WHEN type IN ('opening', 'income') THEN amount ELSE CAST(0 AS BIGINT) END AS money_in,
  CASE WHEN type IN ('expense', 'transfer') THEN amount ELSE CAST(0 AS BIGINT) END AS money_out,
  1 AS leg
FROM transactions
WHERE undone_at IS NULL AND deleted_at IS NULL
UNION ALL
SELECT
  id,
  occurred_at,
  type,
  to_account AS account,
  description,
  amount AS money_in,
  CAST(0 AS BIGINT) AS money_out,
  2 AS leg
FROM transactions
WHERE type = 'transfer' AND undone_at IS NULL AND deleted_at IS NULL;
```

---

## 6. Query Catalog

Parameters use Postgres placeholders (`$1`, `$2`). Time parameters are **UTC instants** computed by the application from WIB boundaries.

> **WIB to UTC example.** The WIB day 2026-11-03 is the range `[2026-11-02T17:00:00Z, 2026-11-03T17:00:00Z)`. Indonesia has no daylight saving time, so the offset is always +7 hours.

> **Driver note.** `pg` returns `bigint`, `SUM()`, and `COUNT()` values as strings. Queries cast to `BIGINT` where useful, and the repository converts to `Number` before returning, after checking the safe-integer range (NFR-011).

> **Date note.** Pass WIB dates as `YYYY-MM-DD` strings. Do not rely on the driver turning a `DATE` column into a `Date` object; that conversion uses the server's local timezone.

### 6.1 Writing transactions

All of these run inside a single database transaction (`BEGIN ... COMMIT`) (NFR-013).

**Record an expense or income (FR-030, FR-031, FR-053)**

```sql
-- Step 1: discard redo history
UPDATE transactions
SET deleted_at = now()
WHERE undone_at IS NOT NULL AND deleted_at IS NULL;

-- Step 2: insert the new transaction
INSERT INTO transactions (type, account, amount, description)
VALUES ($1, $2, $3, $4)
RETURNING id, occurred_at, type, account, amount, description;
```

**Record a transfer (FR-036, FR-037).** One row; the view expands it into two legs.

```sql
-- Step 1: discard redo history (same as above)
UPDATE transactions
SET deleted_at = now()
WHERE undone_at IS NOT NULL AND deleted_at IS NULL;

-- Step 2
INSERT INTO transactions (type, account, to_account, amount, description)
VALUES ('transfer', $1, $2, $3, $4)
RETURNING id, occurred_at;
```

**Set an opening balance (FR-011, FR-013).** The replacement is still row zero in the export; `occurred_at` is only the declaration time (ADR-0003).

```sql
-- Step 1: discard redo history (same as above)

-- Step 2: replace any existing opening balance for this account
UPDATE transactions
SET deleted_at = now()
WHERE type = 'opening' AND account = $1 AND deleted_at IS NULL;

-- Step 3
INSERT INTO transactions (type, account, amount, description)
VALUES ('opening', $1, $2, 'Saldo awal')
RETURNING id;
```

### 6.2 Undo, redo, edit, delete

**Undo: revert the most recent active transaction (FR-050, FR-051)**

```sql
UPDATE transactions
SET undone_at = now()
WHERE id = (
  SELECT id FROM transactions
  WHERE undone_at IS NULL AND deleted_at IS NULL
  ORDER BY id DESC
  LIMIT 1
)
RETURNING id, type, account, to_account, amount, description;
```

**Redo: restore the most recently undone transaction (FR-052)**

```sql
UPDATE transactions
SET undone_at = NULL
WHERE id = (
  SELECT id FROM transactions
  WHERE undone_at IS NOT NULL AND deleted_at IS NULL
  ORDER BY id ASC
  LIMIT 1
)
RETURNING id, type, account, to_account, amount, description;
```

Why the **lowest** id for redo: undo walks backwards from the highest id, so the last row undone is always the lowest id among the undone rows. This avoids depending on timestamp precision. Any new transaction discards the undone rows first, so the order can never be disturbed.

**Edit an expense or income (FR-061, FR-065)**

```sql
UPDATE transactions
SET description = $2,
    amount      = $3,
    account     = COALESCE($4, account)   -- NULL = keep the current account
WHERE id = $1
  AND type IN ('expense', 'income')
  AND undone_at IS NULL AND deleted_at IS NULL
RETURNING id, type, account, amount, description;
```

Zero rows returned means the ID does not exist, is not editable, or is already undone/deleted, and the bot replies with an error (FR-063).

**Delete (FR-062)**

```sql
UPDATE transactions
SET deleted_at = now()
WHERE id = $1 AND undone_at IS NULL AND deleted_at IS NULL
RETURNING id, type, account, to_account, amount, description;
```

### 6.3 Balances (FR-020, FR-021)

```sql
SELECT account,
       CAST(SUM(money_in - money_out) AS BIGINT) AS balance
FROM ledger_entries
GROUP BY account;
```

An account with no entries returns no row, so the application treats a missing account as `0`. The total is the sum of the two balances.

### 6.4 History (FR-060)

```sql
SELECT id, occurred_at, type, account, to_account, amount, description
FROM transactions
WHERE undone_at IS NULL AND deleted_at IS NULL
ORDER BY occurred_at DESC, id DESC
LIMIT 10;
```

### 6.5 Summaries (FR-070 to FR-075)

Transfers and opening balances are excluded, as are undone and deleted rows. `$1` is the inclusive UTC start and `$2` the exclusive UTC end of the WIB period.

```sql
SELECT
  CAST(COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS BIGINT) AS income,
  CAST(COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS BIGINT) AS expense,
  CAST(COUNT(*) AS INTEGER) AS tx_count
FROM transactions
WHERE type IN ('expense', 'income')
  AND undone_at IS NULL AND deleted_at IS NULL
  AND occurred_at >= $1 AND occurred_at < $2;
```

The same query serves today, this week, this month, a specific date, and a specific month. Only the range changes. Net = income - expense, calculated in the application. `tx_count` counts only expense and income rows (FR-070).

### 6.6 Daily budget (FR-081 to FR-088)

**Set or change today's budget**

```sql
INSERT INTO budgets (amount, effective_from)
VALUES ($1, $2)                       -- $2 = today's date in WIB, as a YYYY-MM-DD string
ON CONFLICT (effective_from) DO UPDATE SET amount = EXCLUDED.amount;
```

**Budget in effect for a given WIB day**

```sql
SELECT amount
FROM budgets
WHERE effective_from <= $1            -- $1 = the WIB date, as a YYYY-MM-DD string
ORDER BY effective_from DESC
LIMIT 1;
```

**Expense used on a day**

```sql
SELECT CAST(COALESCE(SUM(amount), 0) AS BIGINT) AS used
FROM transactions
WHERE type = 'expense'
  AND undone_at IS NULL AND deleted_at IS NULL
  AND occurred_at >= $1 AND occurred_at < $2;   -- UTC range of that WIB day
```

The application compares `used` with the budget and applies the warning rules: at least 80% gives a soft warning, above 100% a strong warning (FR-086). Because usage is always recomputed from transactions, undo, redo, edit, and delete are reflected automatically (FR-087).

**Days over budget in a month (FR-076).** Fetch the month's active expense rows and the budget rows up to the month's end, then bucket by WIB day and compare in application code. This avoids timezone functions in SQL and is trivial at this data size.

### 6.7 CSV export (FR-090 to FR-099)

**Full ledger with running balances.** Opening rows sort first regardless of `occurred_at` (ADR-0003).

```sql
SELECT
  id,
  occurred_at,
  account,
  type,
  description,
  money_in,
  money_out,
  CAST(SUM(money_in - money_out) OVER (
    PARTITION BY account
    ORDER BY (type = 'opening') DESC, occurred_at, id
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS BIGINT) AS account_balance,
  CAST(SUM(money_in - money_out) OVER (
    ORDER BY (type = 'opening') DESC, occurred_at, id
    RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS BIGINT) AS total_balance
FROM ledger_entries
ORDER BY (type = 'opening') DESC, occurred_at, id, leg;
```

Why the two windows differ:
- `account_balance` is partitioned per account. A transaction touches each account at most once, so row order is unambiguous.
- `total_balance` uses a `RANGE` frame ordered by `(type = 'opening') DESC, occurred_at, id`. Both legs of a transfer share all these values and are treated as peers, so both rows show the total **after the whole transfer**, which equals the total before it. This matches the rule that a transfer does not change the total.

**Monthly export (FR-091, FR-097).** Run the full query above as a CTE and filter the outer query to the month, so running balances stay correct:

```sql
WITH running AS (
  -- the full ledger query from above
)
SELECT * FROM running
WHERE occurred_at >= $1 AND occurred_at < $2
ORDER BY (type = 'opening') DESC, occurred_at, id, leg;
```

Then build the carry-in rows (accumulated balance before the month):

```sql
SELECT account,
       CAST(SUM(money_in - money_out) AS BIGINT) AS balance
FROM ledger_entries
WHERE occurred_at < $1
GROUP BY account;
```

For each returned account, the application prepends one synthetic row to the CSV: type `opening`, description such as `Saldo awal periode`, a positive balance in `money_in` (a negative balance goes in `money_out` as its absolute value), an empty `id`, and `account_balance` and `total_balance` set from these carry-in values. If no entries exist before the month, no carry-in rows are added.

---

## 7. Mapping to the Data-Access Layer

All SQL lives in one repository module (NFR-051). Suggested functions:

| Function | Section |
|---|---|
| `addExpenseOrIncome(account, type, amount, description)` | 6.1 |
| `addTransfer(from, to, amount, description)` | 6.1 |
| `setOpeningBalance(account, amount)` | 6.1 |
| `undoLast()`, `redoLast()` | 6.2 |
| `editTransaction(id, description, amount, account?)` | 6.2 |
| `deleteTransaction(id)` | 6.2 |
| `getBalances()` | 6.3 |
| `getHistory(limit)` | 6.4 |
| `getSummary(utcStart, utcEnd)` | 6.5 |
| `setBudget(amount, wibDate)`, `getBudgetFor(wibDate)`, `getExpenseUsed(utcStart, utcEnd)` | 6.6 |
| `getLedgerWithBalances()`, `getLedgerForMonth(utcStart, utcEnd)`, `getCarryInBalances(utcStart)` | 6.7 |

---

## 8. Portability Notes

Only PostgreSQL is supported in v1. If the project moves to another database later, these are the Postgres-specific points to revisit:

| Construct | Where | MySQL 8 equivalent |
|---|---|---|
| `GENERATED ALWAYS AS IDENTITY` | table definitions | `AUTO_INCREMENT` |
| `TIMESTAMPTZ` | timestamp columns | `DATETIME` or `TIMESTAMP`, stored as UTC |
| `$1, $2` placeholders | all queries | `?` |
| `RETURNING` | write queries | not available; use `insertId` or a follow-up `SELECT` |
| `ON CONFLICT ... DO UPDATE` | budget upsert | `INSERT ... ON DUPLICATE KEY UPDATE` |
| Partial index (`WHERE ...`) | `idx_transactions_undone` | not supported; drop the index |
| `CREATE INDEX IF NOT EXISTS` | `schema.sql` | not supported; guard separately |
| `CONSTRAINT ... CHECK` | table definitions | supported in MySQL 8.0.16+ |
| Window functions | export query | supported in MySQL 8.0+ |

Already portable by design: `CASE` instead of `FILTER`, `CAST(... AS BIGINT)` instead of `::bigint`, `CHECK` instead of enum types, and application-side timezone boundaries instead of `AT TIME ZONE`.

---

## 9. Schema Change Policy

For a project this size, a migration tool is unnecessary. New changes are **appended** to `schema.sql` as idempotent statements so the file still runs safely on any existing database.

Example, when automatic categorization is added later:

```sql
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS category TEXT;

CREATE TABLE IF NOT EXISTS category_keywords (
  keyword  TEXT PRIMARY KEY,
  category TEXT NOT NULL
);
```

Rules:
- Never edit an existing `CREATE TABLE` in a way that assumes the table is new. Use `ALTER TABLE` for changes to existing tables.
- Existing columns are not dropped or retyped without a deliberate, reviewed migration.
- Export CSV columns are added at the end so existing spreadsheets keep working.

---

## 10. Applying the Schema

- `npm run db:init` reads `schema.sql` and executes it against `DATABASE_URL`. The file is sent as a single multi-statement query with no parameters.
- Run it once after creating the database, and again after any appended change.
- Local development: database `keuangan_dev` on the Laragon PostgreSQL.
- Production: the Heroku Postgres add-on provisions `DATABASE_URL` automatically. The connection requires SSL (`ssl: { rejectUnauthorized: false }` in `pg` options), as noted in the project notes.
- Heroku Postgres has a low connection limit on its entry plans, so keep the `pg` pool small (NFR-032).

---

## 11. Requirement Traceability

| Requirement | Schema element |
|---|---|
| FR-010, FR-011, FR-012, FR-013 | `transactions.type = 'opening'`, `chk_tx_account`, ADR-0003 |
| FR-020, FR-021, FR-022 | `ledger_entries` view, balance query (6.3) |
| FR-030 to FR-037 | `transactions` columns and `chk_tx_transfer`, queries 6.1 |
| FR-040 | `occurred_at DEFAULT now()` |
| FR-050 to FR-055 | `undone_at`, `deleted_at`, queries 6.2 |
| FR-060 to FR-065 | queries 6.2 and 6.4 |
| FR-070 to FR-076 | summary query 6.5 and application-side bucketing |
| FR-080 to FR-088 | `budgets` table, queries 6.6 |
| FR-090 to FR-099 | `ledger_entries` view, export queries 6.7 |
| NFR-010, NFR-011 | `BIGINT` amounts, `CAST` in queries, repository conversion |
| NFR-012, NFR-014 | derived balances, soft-delete columns |
| NFR-013 | `BEGIN ... COMMIT` around multi-statement writes (6.1) |
| NFR-040, NFR-042 | `TIMESTAMPTZ` in UTC, application-computed ranges |
| NFR-051, NFR-052, NFR-056 | section 7, section 8, `schema.sql` (section 5) |
