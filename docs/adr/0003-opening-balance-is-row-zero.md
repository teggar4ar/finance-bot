# An opening balance is row zero of the ledger

An opening balance may be declared at any time, but it represents money that existed before every recorded transaction. Exports therefore order it before all other rows regardless of its `occurred_at`, which is kept only as a declaration timestamp. Chronological placement would make a late or replaced opening balance look like money that arrived mid-history, contradicting "saldo awal".

## Consequences

- Export ordering uses `(type = 'opening') DESC, occurred_at, id`, not `occurred_at` alone.
- Negative opening balances are rejected in v1; supporting an overdraft would be a separate model change.
- Re-setting an opening balance soft-deletes the previous row; the replacement is still row zero.
