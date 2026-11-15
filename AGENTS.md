# finance-bot

Telegram bot, TypeScript strict, Node 26, grammY + raw SQL via `pg` (no ORM). UI text is Indonesian; code and DB identifiers are English.

## Commands

- `npm run dev` — tsx watch, bot polling (needs `.env`, see `.env.example`)
- `npm run build` — tsc, emits `dist/`; typechecks **`src/` only**
- `npm test` — `vitest run` (unit tests run with no DB)
- `npm run db:init` — apply `schema.sql` (idempotent, safe to re-run)
- Single file: `npx vitest run test/amount.test.ts` · single test: `npx vitest run -t "name"`

### Verification quirk

`tsconfig.json` includes only `src`, so `npm run build` does not typecheck `test/`. CI does it with a temp config extending `tsconfig.json` (`rootDir: "."`, `noEmit: true`, include `src/**/*.ts` + `test/**/*.ts`) — replicate that before claiming tests compile.

### Integration tests

`test/repo.test.ts` + friends hit real PostgreSQL via `TEST_DATABASE_URL`; skipped when it is empty, and they refuse to run unless the database name ends with `_test`. CI provisions `postgres:18` with db `keuangan_test`.

## Architecture rules

- All behavior goes through the seam `execute(command, deps) → Reply` (`src/execute.ts`); handlers are pure and tested against `test/fake-repo.ts` — no DB needed.
- **All SQL lives only in `src/db/repo.ts`** behind the `Repo` interface (`src/repo.ts`). Everything else calls repo functions.
- Static reply vocabulary (`HELP`, `USAGE_*`, labels/emoji) is centralized in `src/text.ts`; HTML primitives (`esc`, `bold`, `code`, `warning`) in `src/reply.ts`. User text is always escaped (replies use `parse_mode: HTML`).
- Money is integer sen everywhere (`src/amount.ts`); DB stores UTC, WIB day/week/month boundaries are computed in app code (`src/wib.ts`) to keep SQL portable.
- Access control is middleware-first in `createBot()` (`src/telegram.ts`); private chats only, one private book per Pengguna (ADR-0007).

## Domain language

Use the glossary in `CONTEXT.md` exactly (Pengguna, Transaksi, Akun, Nominal, …) in issues, tests, and proposals — don't drift to the avoided synonyms. If your change contradicts an ADR in `docs/adr/`, surface it explicitly.

## Schema changes

No migration tool: append idempotent statements to `schema.sql` (`ALTER TABLE ... IF NOT EXISTS` etc.), never rewrite existing `CREATE TABLE`. See the Schema Change Policy in `db-schema.md`. The `owner` backfill `DO` block only fires when `db:init` sets `app.owner_id` (first `ALLOWED_USER_IDS` entry) — a plain `psql -f schema.sql` skips it.

## Deploy

Push to `master` → CI (build + full test with Postgres service) → auto-deploy to Heroku app `finbyte-v1` (worker dyno). Apply schema changes on Heroku with `node dist/db/init.js` — not `npm run db:init` (tsx is a devDependency, pruned at build). Heroku Postgres needs a small pool (`DB_POOL_SIZE`, default 3) and SSL.

## Agent skills

### Issue tracker

Issues and specs live in this repo's GitHub Issues (`teggar4ar/finance-bot`), managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles with the default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root plus `docs/adr/`. See `docs/agents/domain.md`.
