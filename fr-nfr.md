# Personal Finance Telegram Bot: Functional & Non-Functional Requirements

| | |
|---|---|
| **Version** | 0.5 (draft) |
| **Date** | 2026-11-03 |
| **Status** | For review |
| **Owner** | Project author (single user) |

---

## 1. Overview

### 1.1 Purpose
A simple personal finance tracker used through a Telegram chatbot. The user records income and expenses with short slash commands, and the system keeps track of balances in two accounts (cash and bank), supports undo/redo, shows summaries, warns when a daily budget is exceeded, and exports data as a ledger-style CSV.

### 1.2 Scope
- **Single user.** Only one authorized Telegram user ID can use the bot.
- **Single currency.** Indonesian Rupiah (IDR), stored as whole numbers.
- **Command-based input.** No LLM or natural-language understanding. All input is parsed deterministically.
- **Storage.** PostgreSQL. Production starts on Heroku (Heroku Postgres); development runs on a local PostgreSQL (Laragon).

### 1.3 Out of Scope (v1)
- Automatic categorization and category summaries (deferred; the schema should allow adding it later).
- LLM or AI features, receipt photo/OCR.
- Per-category budgets, monthly budgets, recurring transactions.
- Multiple users, multiple currencies.
- Backdated transactions (every transaction is timestamped when it is recorded).
- Scheduled/automatic reports.
- Google Sheets integration (replaced by PostgreSQL + CSV export).
- Negative opening balances.
- Inline keyboards or any UI other than plain text replies.
- Continuous integration (tests run locally).

### 1.4 Glossary

Project terms are defined once in [CONTEXT.md](./CONTEXT.md). The bot UI and command names are Indonesian; code and database identifiers stay English. CSV columns are English (`money_in`, `money_out`) per D2.

---

## 2. Functional Requirements

Priority: **M** = Must have, **S** = Should have.

### 2.1 Access Control

| ID | Requirement | Priority |
|---|---|---|
| FR-001 | The bot shall only process messages from the Telegram user ID configured in `ALLOWED_USER_ID`. | M |
| FR-002 | Messages from any other user shall be ignored without any response and without writing any data. | M |
| FR-003 | The bot shall only respond in private chats. Messages from groups or channels shall be ignored, even when they come from the allowed user. | M |

### 2.2 Accounts and Opening Balances

| ID | Requirement | Priority |
|---|---|---|
| FR-010 | The system shall support exactly two accounts: `tunai` (cash) and `bank`. | M |
| FR-011 | The user shall be able to set the opening balance of an account with `/saldo_awal <account> <amount>`, e.g. `/saldo_awal tunai 200rb`. | M |
| FR-012 | An opening balance shall be stored as a transaction of type `opening`, not in a separate table. It shall not count as income in any summary. | M |
| FR-013 | Setting an opening balance for an account that already has one shall replace the previous one (the previous record is soft-deleted). An opening balance may be declared at any time and is always treated as the ledger's row zero, never as money that arrived at its `occurred_at` time (see ADR-0003). | S |

### 2.3 Balance Inquiry

| ID | Requirement | Priority |
|---|---|---|
| FR-020 | `/saldo` shall show the cash balance, the bank balance, and the total of both. | M |
| FR-021 | Balances shall always be computed from active transactions (opening + income - expenses +/- transfers). No balance value shall be stored as a standalone number. | M |
| FR-022 | Negative balances shall be allowed. When a transaction makes an account negative, the reply shall include a visible warning. | M |

### 2.4 Recording Transactions

| ID | Requirement | Priority |
|---|---|---|
| FR-030 | `/pengeluaran <description> <amount> [@account]` shall record an expense. Example: `/pengeluaran makan siang 25rb`. Short alias: `/k`. | M |
| FR-031 | `/pemasukan <description> <amount> [@account]` shall record an income. Example: `/pemasukan gaji 5jt @bank`. Short alias: `/m`. | M |
| FR-032 | If no account flag is given, the account shall default to `tunai`. Non-cash transactions use the flag `@bank` (and `@tunai` for explicitness). | M |
| FR-033 | The amount shall be the last token of the message before the optional account flag. Everything before it is the description. | M |
| FR-034 | The amount parser shall accept Indonesian formats with these rules: an optional `rp` prefix; suffixes `rb`/`k` = 1,000 and `jt`/`juta` = 1,000,000; with a suffix, a dot or comma is a decimal separator (at most 2 digits, result must be a whole number); without a suffix, a dot or comma is a thousands separator only when followed by exactly 3 digits and may repeat (`1.234.567`). A bare decimal such as `1,5` or `1.5` is invalid, as are zero, negative numbers, and more than 15 digits. Valid examples: `25rb`, `25k`, `1,5jt`, `1.5jt`, `25.000`, `25000`. | M |
| FR-035 | A description shall be required. The amount shall be a positive whole number of Rupiah. Invalid input shall produce a usage hint and write nothing. | M |
| FR-036 | `/transfer <from> <to> <amount>` shall move money between accounts, e.g. `/transfer bank tunai 500rb`. The source and destination must differ. | M |
| FR-037 | A transfer shall change both account balances but shall not change the total balance and shall not count as income or expense. A transfer shall be stored atomically. | M |
| FR-038 | Every successful write shall reply with a confirmation containing: the transaction ID, type, description, amount, account, and the resulting balance of the affected account(s). Example: `Makan siang 25.000 (tunai) tercatat. ID 17. Saldo tunai: 175.000`. | M |
| FR-039 | Amounts in replies shall be formatted with a dot as thousands separator (e.g. `25.000`) and no currency symbol. | M |

### 2.4.1 Transaction timestamp
| ID | Requirement | Priority |
|---|---|---|
| FR-040 | A transaction shall be timestamped with the time it was recorded. Backdating is not supported in v1. | M |

### 2.5 Undo and Redo

| ID | Requirement | Priority |
|---|---|---|
| FR-050 | `/undo` shall revert the most recently recorded active transaction by marking it as undone (soft delete via `undone_at`). The data shall not be physically removed. | M |
| FR-051 | `/undo` may be used repeatedly to step back through earlier transactions, most recent first. | M |
| FR-052 | `/redo` shall restore the most recently undone transaction. | M |
| FR-053 | Any write that creates a transaction (`/pengeluaran`, `/pemasukan`, `/transfer`, `/saldo_awal`) shall permanently discard all currently undone transactions (they become deleted) so that redo is no longer possible for them. `/edit`, `/hapus`, and `/budget` shall not discard redo history. | M |
| FR-054 | `/undo` and `/redo` shall reply with what was reverted or restored and the updated balance. If nothing can be undone or redone, the reply shall say so. | M |
| FR-055 | Undo/redo applies to recording transactions. Edits (FR-061) are not undoable in v1. | S |

### 2.6 History, Edit, and Delete

| ID | Requirement | Priority |
|---|---|---|
| FR-060 | `/riwayat` shall list the 10 most recent active transactions with ID, date/time (WIB), type, account, description, and amount. Transfers are shown as `bank -> tunai` and opening balances as `saldo awal`. | M |
| FR-061 | `/edit <id> <description> <amount> [@account]` shall change an existing active expense or income transaction. | M |
| FR-062 | `/hapus <id>` shall delete an active transaction (sets `deleted_at`). A deleted transaction cannot be restored with `/redo`. | M |
| FR-063 | Editing or deleting a non-existent or already deleted ID shall produce a clear error and change nothing. | M |
| FR-064 | After edit or delete, the reply shall show the updated balance(s). | M |
| FR-065 | Transfers and opening balances are not editable in v1; they can be deleted and recreated. | S |

### 2.7 Summaries

| ID | Requirement | Priority |
|---|---|---|
| FR-070 | `/hari_ini` shall show a summary of today (WIB): total income, total expense, net, and number of transactions. The transaction count includes only active expense and income rows; transfers are excluded. | M |
| FR-071 | `/minggu_ini` shall show the same summary for the current week (see Assumption A1). | M |
| FR-072 | `/bulan_ini` shall show the same summary for the current calendar month (WIB). | M |
| FR-073 | `/ringkasan <date>` (e.g. `2026-10-15`) and `/ringkasan <month>` (e.g. `2026-10`) shall show the summary for that date or month. | M |
| FR-074 | Summaries shall exclude transfers, opening balances, undone transactions, and deleted transactions from income/expense totals. | M |
| FR-075 | Summaries shall be computed using day and month boundaries in `Asia/Jakarta`. | M |
| FR-076 | Monthly summaries should show how many days exceeded the daily budget, when a budget was in effect. | S |

### 2.8 Daily Budget

| ID | Requirement | Priority |
|---|---|---|
| FR-080 | The system shall support a single global daily budget amount (not per category, not per account). | M |
| FR-081 | `/budget` shall show the current daily budget, today's total expense, and the remaining amount (or the overage). If no budget has been set, the reply shall say so and show an example (`/budget 150rb`). | M |
| FR-082 | `/budget <amount>` shall set or change the daily budget, e.g. `/budget 150rb`. | M |
| FR-083 | Each change shall be stored as a new record with an effective date (`effective_from`), so past days are evaluated against the budget that applied on that day. | M |
| FR-084 | Daily expense usage shall count only active `expense` transactions across both accounts. Transfers and opening balances shall not count. | M |
| FR-085 | The confirmation reply of every recorded expense shall include today's budget usage, e.g. `Budget hari ini: 175.000 / 150.000 (sisa -25.000)`. | M |
| FR-086 | A soft warning shall be shown when usage reaches 80% of the budget. A strong warning shall be shown only when usage exceeds 100% (exactly 100% is still the soft warning), and it shall continue to appear on every further expense that day. | M |
| FR-087 | Budget usage shall be recalculated from transactions after undo, redo, edit, and delete, so it is always consistent. | M |
| FR-088 | If no budget has been set, no budget information or warnings shall be shown. | M |

### 2.9 CSV Export

| ID | Requirement | Priority |
|---|---|---|
| FR-090 | `/export` shall send a CSV file to the chat containing all active transactions. | M |
| FR-091 | `/export <month>` (e.g. `/export 2026-10`) shall export only that month. | M |
| FR-092 | The CSV shall be in ledger style with these English column headers: `id, date, account, type, description, money_in, money_out, account_balance, total_balance`. | M |
| FR-093 | `money_in` and `money_out` are the money entering and leaving that row's account. `account_balance` is the balance of that account after the row, and `total_balance` is the combined balance after the row. | M |
| FR-094 | A transfer shall be exported as two rows (type `transfer`): one outgoing row for the source account and one incoming row for the destination account. | M |
| FR-095 | Opening balances shall be exported as the first rows of the ledger, one per account that has one, with type `opening`, regardless of when they were declared. They are row zero (ADR-0003); their `date` is the declaration time. | M |
| FR-096 | Undone and deleted transactions shall not be exported. | M |
| FR-097 | A monthly export shall start with one synthetic `opening` row per account, representing the accumulated balance before the month, so running balances stay correct. | M |
| FR-098 | Timestamps shall be in WIB. Amounts shall be plain integers without thousands separators. | M |
| FR-099 | The file shall be UTF-8 with BOM and use a comma as the field delimiter. Fields containing commas, quotes, or line breaks (e.g. descriptions) shall be quoted and escaped according to standard CSV rules (RFC 4180). | M |
| FR-101 | The export file shall be named `keuangan-YYYY-MM.csv` for a monthly export and `keuangan-semua.csv` for a full export, and shall be sent with a short caption stating the number of rows. | S |
| FR-102 | A month with no transactions shall still produce a valid CSV with the header row and any applicable carry-in rows. | S |

### 2.10 Help and Unknown Input

| ID | Requirement | Priority |
|---|---|---|
| FR-100 | `/start` and `/help` shall list all commands with a short usage example for each, in Indonesian. | S |
| FR-103 | A message that is not a recognized command, including plain text, shall get a short hint reply and shall write nothing. | M |
| FR-104 | If a message contains more than one command, only the first command shall be processed. | S |

### 2.11 Command Summary

| Command | Purpose |
|---|---|
| `/saldo_awal tunai 200rb` | Set opening balance of an account |
| `/saldo` | Show cash, bank, and total balance |
| `/pengeluaran makan siang 25rb` | Record an expense (default: cash) |
| `/pengeluaran spotify 55rb @bank` | Record an expense from bank |
| `/pemasukan gaji 5jt @bank` | Record an income |
| `/k makan siang 25rb`, `/m gaji 5jt` | Short aliases for `/pengeluaran` and `/pemasukan` |
| `/transfer bank tunai 500rb` | Move money between accounts |
| `/undo`, `/redo` | Revert / restore the last transaction |
| `/riwayat` | Show the last 10 transactions with IDs |
| `/edit 12 makan malam 30rb` | Edit a transaction by ID |
| `/hapus 12` | Delete a transaction by ID |
| `/hari_ini`, `/minggu_ini`, `/bulan_ini` | Summaries |
| `/ringkasan 2026-10-15` or `2026-10` | Summary for a specific date or month |
| `/budget`, `/budget 150rb` | View or set the daily budget |
| `/export`, `/export 2026-10` | Export CSV (all data or one month) |
| `/help` | List commands |

---

## 3. Non-Functional Requirements

### 3.1 Security

| ID | Requirement |
|---|---|
| NFR-001 | Access is restricted to one Telegram user ID, enforced as the first middleware, before any command handling or database access. |
| NFR-002 | Secrets (`BOT_TOKEN`, `DATABASE_URL`, `ALLOWED_USER_ID`) shall be supplied only through environment variables. They shall never be committed to the repository or written to logs. |
| NFR-003 | `.env` shall be listed in `.gitignore` before the first commit. A `.env.example` without real values shall be provided. |
| NFR-004 | If a token is ever exposed, it shall be regenerated via BotFather. |
| NFR-005 | Database queries shall use parameterized statements. No SQL is built by string concatenation with user input. |
| NFR-006 | The application shall validate its configuration at startup and exit with a clear error if `BOT_TOKEN`, `ALLOWED_USER_ID`, or `DATABASE_URL` is missing; `ALLOWED_USER_ID` must be a positive integer. |

### 3.2 Data Integrity

| ID | Requirement |
|---|---|
| NFR-010 | Money shall be stored as integer Rupiah in a `bigint` column. Floating-point types shall not be used for money. |
| NFR-011 | Because the database driver returns `bigint` and `SUM()` as strings, values shall be converted to numbers at the repository boundary, after checking they fall within JavaScript's safe integer range. |
| NFR-012 | Balances and budget usage shall be derived from transactions and never stored as separately maintained values. |
| NFR-013 | Operations that touch multiple rows (transfer, discarding redo history on new transaction) shall run inside a database transaction (all-or-nothing). |
| NFR-014 | Undo and delete shall be soft operations (`undone_at`, `deleted_at`). Data shall not be physically removed by normal commands. |

### 3.3 Reliability and Availability

| ID | Requirement |
|---|---|
| NFR-020 | The bot shall handle `SIGTERM` gracefully: stop receiving updates, finish in-flight work, and close the database pool before exit. (Heroku restarts dynos regularly.) |
| NFR-021 | Only one polling instance shall run per bot token at any time. The development and production environments shall use separate bots. |
| NFR-022 | Unexpected errors shall be caught per update, logged, and answered with a short generic error message. One failed command shall not crash the process. |
| NFR-023 | The bot should recover automatically after a restart without manual intervention. |
| NFR-024 | Availability target is best effort. Short downtime is acceptable for a personal tool. |

### 3.4 Performance

| ID | Requirement |
|---|---|
| NFR-030 | Typical commands shall reply within about 2 seconds under normal conditions. |
| NFR-031 | Data volume is small (a few thousand rows per year). Running balances shall be computed with SQL window functions on demand, without caching. |
| NFR-032 | Database access shall use a connection pool with a small, configurable size (Heroku Postgres Essential plans have a low connection limit). |

### 3.5 Time and Locale

| ID | Requirement |
|---|---|
| NFR-040 | Timestamps shall be stored in UTC. |
| NFR-041 | "Today", "this week", and "this month" shall be evaluated in `Asia/Jakarta`. |
| NFR-042 | To remain database-portable, day/week/month boundaries shall be computed in application code and passed to queries as UTC time ranges, rather than relying on database-specific timezone functions. |
| NFR-043 | Bot replies shall use Indonesian-style number formatting (dot as thousands separator). |

### 3.6 Portability and Maintainability

| ID | Requirement |
|---|---|
| NFR-050 | The application shall not contain platform-specific code for Heroku. Platform coupling is limited to the `Procfile` and the `DATABASE_URL` environment variable. |
| NFR-051 | All SQL shall live in a single data-access layer (repository). The rest of the code calls functions such as `addTransaction()` or `getBalances()`. |
| NFR-052 | Only PostgreSQL is supported in v1. Keeping SQL isolated in one layer is intended to make a later move to another database a contained change. |
| NFR-053 | The bot shall use long polling only. No HTTP server, webhook, `MODE`, or `WEBHOOK_URL` exists in v1. |
| NFR-054 | The code shall be written in TypeScript with strict type checking. |
| NFR-055 | The amount/command parser and the budget/balance rules shall be pure functions with no database access, so they can be unit tested in isolation. |
| NFR-056 | The database schema shall be applied by an idempotent `schema.sql` (`CREATE TABLE IF NOT EXISTS`) through an `npm run db:init` script. |

### 3.7 Usability

| ID | Requirement |
|---|---|
| NFR-060 | Everyday input shall be short: one command, a description, and an amount. Cash is the default so common entries need no flag. |
| NFR-061 | Error messages shall explain what was wrong and show the correct usage. |
| NFR-062 | Every state-changing reply shall show the resulting balance so input mistakes are noticed immediately. |

### 3.8 Observability

| ID | Requirement |
|---|---|
| NFR-070 | The application shall write one-line plain-text logs to stdout in the form `timestamp level event key=value` (command received, errors, startup, shutdown). No JSON and no logging library. Tokens and full message contents shall never be logged. |

### 3.9 Testing

| ID | Requirement |
|---|---|
| NFR-080 | Unit tests (Vitest) shall cover the amount parser (all accepted formats and invalid input), the command argument parser, budget threshold logic, and running-balance logic. |
| NFR-081 | Integration checks against a local PostgreSQL shall cover transfer atomicity, undo/redo/new-transaction behavior, and month-boundary handling around midnight WIB. |
| NFR-082 | Integration tests shall run against a separate `keuangan_test` database, reset per run, and shall be skipped unless `TEST_DATABASE_URL` is set. Unit tests shall never require a database. |

### 3.10 Deployment and Cost

| ID | Requirement |
|---|---|
| NFR-090 | Production runs as a single worker process on Heroku (`Procfile`: `worker: node dist/index.js`) with Heroku Postgres attached. |
| NFR-091 | Development runs locally with Node.js LTS, PostgreSQL via Laragon, a separate development bot, and polling mode. |
| NFR-092 | Hosting costs (dyno and database) shall be checked against the available Heroku credit before relying on it, since pricing may change. |
| NFR-093 | `/export` serves as a manual backup path in addition to any provider-level database backups. |

---

## 4. Technology Stack

| Area | Choice |
|---|---|
| Runtime | Node.js (LTS) |
| Language | TypeScript |
| Telegram bot library | grammY |
| Database | PostgreSQL |
| DB driver | `pg` (node-postgres), raw SQL, no ORM |
| Tests | Vitest |
| Dev runner | `tsx` |
| Production host | Heroku (worker dyno + Heroku Postgres) |
| Local dev DB | PostgreSQL via Laragon |

### 4.1 Configuration (environment variables)

| Variable | Purpose |
|---|---|
| `BOT_TOKEN` | Telegram bot token from BotFather |
| `ALLOWED_USER_ID` | The only Telegram user ID allowed to use the bot |
| `DATABASE_URL` | PostgreSQL connection string |
| `TEST_DATABASE_URL` | PostgreSQL connection string for integration tests (optional; tests are skipped when absent) |

### 4.2 npm scripts

`dev`, `build`, `start`, `test`, `db:init`.

---

## 5. Data Model

Storage, constraints, and the query catalog are maintained in [db-schema.md](./db-schema.md), with the reasoning for the non-obvious choices in [docs/adr](./docs/adr/). This document defines behavior; that document defines storage.

---

## 6. Assumptions and Open Questions

### Assumptions (change if wrong)

| ID | Assumption |
|---|---|
| A1 | "This week" starts on Monday (Monday to Sunday, WIB). |
| A2 | The 80% soft-warning threshold is a constant in code and can be changed later. |
| A3 | Unauthorized users are ignored silently rather than receiving a rejection message. |
| A4 | Edits are not part of the undo/redo history in v1. |
| A5 | Re-setting an opening balance replaces the previous one for that account. |
| A6 | Both accounts allow negative balances; the system only warns. |

### Resolved Decisions

| ID | Decision |
|---|---|
| D1 | The CSV delimiter is a comma (see FR-099). If Excel with Indonesian regional settings opens the file as a single column, import it via Data > From Text/CSV, or open it in Google Sheets. |
| D2 | CSV column headers are in English (see FR-092). |
| D3 | Backdating is not needed. Transactions are always timestamped when recorded (see FR-040). |
| D4 | The bot UI and command names are Indonesian; code and database identifiers stay English. `/pengeluaran` and `/pemasukan` replace `/debit` and `/credit`. |
| D5 | Stored transaction types are `opening`, `expense`, `income`, `transfer`. The accounting words `debit`/`credit` are dropped everywhere. |
| D6 | An opening balance is the ledger's row zero and may be declared at any time (ADR-0003). Negative opening balances are not supported in v1. |
| D7 | Only writes that create a transaction discard the redo history. `/edit`, `/hapus`, and `/budget` do not (see FR-053). |
| D8 | Update mode is long polling only; there is no webhook server (see NFR-053). |
| D9 | Duplicate delivery of the same Telegram update is not deduplicated in v1; the risk is accepted because the failure window is tiny for a single-user bot. |
| D10 | The bot responds only in private chats; group and channel messages are ignored (see FR-003). |
| D11 | The process fails fast on missing or invalid configuration (see NFR-006). |
| D12 | Integration tests use a separate `keuangan_test` database, gated by `TEST_DATABASE_URL` (see NFR-082). |
| D13 | Amounts are shown as plain numbers with dot thousands separators and no currency symbol (see FR-039). |
| D14 | Logs are one-line plain text to stdout; no JSON and no logging library (see NFR-070). |
| D15 | There is no CI in v1; tests run locally with `npm test`. |
| D16 | The repository is initialized with git and `.gitignore` before the first line of code (see NFR-003). |

### Open Questions

None at this time.

---

## 7. Future Enhancements (Not in v1)

1. Automatic categorization via a keyword table, with `/kategori` and `/keyword` commands and per-category summaries.
2. Per-category budgets and monthly budgets.
3. Recurring transactions (subscriptions, bills).
4. Scheduled weekly or monthly reports.
5. Backdated transactions.
6. Support for additional databases.
7. Negative opening balances (an overdraft at the start).
8. Webhook mode, if the bot ever needs to run on a web dyno.
9. Inline keyboards for undo/redo and edits.
10. Continuous integration once the repository is remote.
