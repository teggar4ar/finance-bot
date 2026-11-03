# Command aliases are single letters

`/k` and `/m` are aliases for `/pengeluaran` and `/pemasukan`. Those two commands are typed by hand many times a day, and the Telegram command menu sends a tapped command immediately instead of filling the input box, so the menu saves no typing at all. A hand-typed alias is the only shortcut that works. D4 ("command names are Indonesian") still holds: `/k` and `/m` are the initials of *keluar* and *masuk*, not English abbreviations.

## Considered Options

- `/p` and `/m`: rejected because `/p` is also the start of `/pemasukan`, so the client's command suggestions become ambiguous exactly where speed matters.
- `/keluar` and `/masuk`: rejected because they save only 5-6 keystrokes over the canonical names, and the point of the alias is speed.
- No alias at all: rejected because the Telegram menu saves no typing, leaving the user to type the full command name every time.

## Consequences

- An alias is a shortcut, not a term: `CONTEXT.md` keeps `Pengeluaran` and `Pemasukan` as the only names, and every reply uses them regardless of which command was typed.
- Aliases are resolved in `ALIASES` before a handler is chosen, so their behaviour cannot drift from the canonical command. Aliases are not registered in the Telegram command menu, and no other command gets one.
