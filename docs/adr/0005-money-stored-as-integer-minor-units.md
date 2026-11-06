# Money is stored as integer minor units (sen)

To support rupiah amounts with cents (`1.321.765,03`), every monetary value is stored as an integer number of **sen** (1 rupiah = 100 sen) in the existing `BIGINT` columns. Balances are derived (ADR-0001), so one cent anywhere forces cents everywhere: `opening`, `expense`, `income`, `transfer`, per-account balances, summaries, and exports all carry the same minor-unit scale. Nothing about the schema changes — only the meaning of the stored integer and the scale used to display it. Application arithmetic stays in exact integer sen; `BIGINT` is still read via `Number`, which is safe for values up to ~9×10¹⁵ sen (~Rp 10 triliun).

## Considered Options

- **`NUMERIC(18,2)`**: stores rupiah-with-2-decimals literally, but `pg` returns `NUMERIC` as a `string`, so every arithmetic site would have to handle decimal strings (never `parseFloat`) — more error-prone across the budget/history/export code.
- **`float`/`double`**: rejected outright; never correct for money.

## Consequences

- Display divides by 100 and shows `,dd` only when sen ≠ 0 (`1.321.765,03` vs `1.321.765`), using the Indonesian convention (dot = thousands, comma = decimal).
- Input accepts a comma decimal with at most 2 digits; more than 2 is rejected (never silently rounded). With a `rb`/`k`/`jt`/`juta` suffix, either `.` or `,` may be the decimal separator.
- Export CSV uses a **dot** decimal (e.g. `1321765.03`) to stay delimiter-safe and spreadsheet-friendly, deliberately different from the chat display.
- `MAX_AMOUNT` is a cap in **sen** (999.999.999.999.999 ≈ Rp 10 triliun); the practical ceiling in rupiah drops by a factor of 100 versus the old whole-rupiah limit.
- Existing whole-rupiah data is interpreted as-is only after a one-time ×100 conversion; this project starts clean (dev/prod/test truncated) instead of migrating.
