export interface Command {
  name: string;
  args: string;
}

/**
 * Hanya token pertama yang dianggap command; sisanya argumen (FR-104).
 * "/help@finance_dev_bot" → "help": Telegram menambahkan suffix di grup,
 * yang tetap diabaikan sesuai FR-003.
 */
export function parseCommand(text: string): Command | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  const [token, ...rest] = trimmed.split(/\s+/);
  const name = (token?.slice(1).split('@')[0] ?? '').toLowerCase();
  if (!name) return null;

  return { name, args: rest.join(' ') };
}