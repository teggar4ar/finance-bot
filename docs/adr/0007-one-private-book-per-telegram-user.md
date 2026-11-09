# One private book per Telegram user

The bot serves an allowlist of Telegram user IDs, and each ID gets its own private book: balances, history, budget, and export are separate. One bot and one database hold every book; each `transactions` and `budgets` row carries an `owner` (the Telegram user id), and every read and write is filtered by it. Because balances, summaries, and budget usage are derived per query (ADR-0001), isolation costs one ownership predicate per query — not a separate deployment, database, or schema per person.

## Considered Options

- **Shared book (one ledger for every admitted user)**: everyone sees and edits the same balances, history, and budget. Rejected: a typo by one user shows up in another user's report, and any new transaction discards a single shared redo history, so one person's entry breaks another's undo.
- **One bot per person (separate bot token, dyno, and database each)**: the strongest isolation, but it multiplies secrets, deployments, and databases per user and leaves no single place to add or remove a person. Rejected: isolation the requirement does not need, at several times the cost.

## Consequences

- `transactions` and `budgets` gain an `owner` column; the `ledger_entries` view carries it through; budget uniqueness becomes per owner, not global.
- Admission is an env allowlist, `ALLOWED_USER_IDS`; the first entry owns data recorded before this change. There is no admin table or command.
- The data-access seam is unchanged: `Repo` and `execute(command, deps)` keep their signatures; ownership is bound when a repository is created for a user, not passed through every call.
- Undo/redo is per book (LIFO within one user); `/edit` and `/hapus` cannot reach a transaction id that belongs to another user — it reads as "not found".
- Transaction ids stay global across books, so one user's history may show gaps in its own ids. Removing a user from the allowlist keeps their rows; they are simply never served again.
