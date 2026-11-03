/**
 * Log satu baris teks ke stdout: `timestamp level event key=value` (NFR-070, D14).
 * Tanpa library, tanpa JSON.
 */
type Level = 'info' | 'warn' | 'error';

export function log(level: Level, event: string, fields: Record<string, string | number> = {}): void {
  let line = `${new Date().toISOString()} ${level} ${event}`;
  for (const [key, value] of Object.entries(fields)) {
    const text = String(value).replace(/[\r\n]+/g, ' ');
    line += /\s/.test(text) ? ` ${key}=${JSON.stringify(text)}` : ` ${key}=${text}`;
  }
  process.stdout.write(line + '\n');
}

/** Pesan error tanpa token, supaya secret tidak pernah masuk log (NFR-002). */
export function describeError(error: unknown, secret?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return secret ? message.replaceAll(secret, '<redacted>') : message;
}