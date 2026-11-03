# A transfer is one row, expanded by a view

A transfer is stored as one `transactions` row with `account` (source) and `to_account` (destination); the `ledger_entries` view expands it into two legs. One row makes a transfer atomic: one insert, one undo, one delete, and no way to half-apply it. The cost is that every balance and export query reads the view instead of the table.

## Considered Options

- Two independent rows linked by a group ID: more ledger-pure, but undo, redo, delete, and edit would have to keep both rows in sync.
