# Replies are formatted as Telegram HTML

Bot replies are rendered as Telegram HTML (`parse_mode: 'HTML'`) instead of plain text: `<b>` for headings and totals, `<code>` for amounts, IDs, and dates, and `<blockquote>` for warnings. Formatting is presentation only — the same information stays readable as plain text — and it makes the multi-line labelled cards scannable on a phone. Two rules follow from how Telegram parses HTML: every piece of user-supplied text is escaped (`&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`) before it enters a reply, and `<br>` is never emitted because Telegram does not support it — blank lines are literal `\n\n`, which render identically.

## Considered Options

- **MarkdownV2**: almost every punctuation character in user text (`_`, `*`, `[`, `]`, `(`, `)`, `~`, backtick, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!`) must be escaped, far more error-prone than HTML's three characters; a missed escape drops the whole message.
- **Plain text (status quo)**: no escaping risk at all, but no emphasis for totals and warnings, which the #13 format work already pushed toward labelled blocks.
- **`<br>` for blank lines**: rejected outright; it is not a supported tag, so it triggers `can't parse entities` and the entire reply fails.

## Consequences

- One escaping boundary: user text passes through `esc()` in `src/reply.ts`. `bold()` and `warning()` do not escape their input, so they are only ever given static text or already-escaped output.
- The adapter contract changes: `src/telegram.ts` sends `parse_mode: 'HTML'` on every reply and on the `/export` document caption. The CSV file body stays plain, with no tags.
- Warnings are `<blockquote>⚠️ <i>…</i></blockquote>`, deliberately different from errors, which stay `⚠️ <b>…</b>`.
- Blank lines between blocks are literal `\n\n`.
- Presentation only: no behaviour, SQL, or schema change.

## Supersedes

This partially supersedes #13 ("Rapikan format balasan"):

- **Kept**: the labelled multi-line cards, the emoji set (`✅` `⚠️` `💸` `📥` `🔁`), the unified `Sisa:`/`Kelebihan:` lines, and hiding `Hari melewati budget` when it would be `0`.
- **Dropped**: #13's plain-text rule (`Tidak ada parse_mode`) and the byte-identical output guard around it — replies are re-rendered with HTML tags, so their bytes change.
