# Balances are derived, never stored

Balances, budget usage, summaries, and running balances are computed from `transactions` on every read; no balance column or cache exists. A stored balance would be a second source of truth that drifts after undo, redo, edit, delete, or opening-balance replacement, and a few thousand rows per year makes recomputation cheap.

## Consequences

- Every read path must go through the repository queries that derive the value.
- Write paths need no balance bookkeeping, so undo/redo/delete stay simple.
