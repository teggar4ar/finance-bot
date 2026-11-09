/**
 * Konfigurasi startup. Gagal cepat bila ada yang kurang (NFR-006, D11).
 */
export interface Config {
  botToken: string;
  /** Allowlist Pengguna; elemen pertama = pemilik data lama (ADR-0007). */
  allowedUserIds: number[];
  databaseUrl: string;
}

/** Satu sumber parsing allowlist (dipakai `loadConfig` dan `db:init`): koma-pemisah, integer positif, unik (NFR-006). */
export function parseAllowedUserIds(raw: string | undefined): number[] {
  const parts = (raw ?? '').split(',').map((part) => part.trim());
  const ids = parts.map(Number);
  // Tolak juga bentuk yang lolos `Number` tapi bukan digit: `0x2A`, `1e3`, `+42`, `42.0`.
  if (!parts.every((part) => /^\d+$/.test(part)) || !ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
    throw new Error('env ALLOWED_USER_IDS harus daftar Telegram user id positif dipisah koma');
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error('env ALLOWED_USER_IDS tidak boleh memuat user id ganda');
  }
  return ids;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const botToken = env.BOT_TOKEN?.trim();
  if (!botToken) throw new Error('env BOT_TOKEN belum diisi');

  const allowedUserIds = parseAllowedUserIds(env.ALLOWED_USER_IDS);

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('env DATABASE_URL belum diisi');

  return { botToken, allowedUserIds, databaseUrl };
}
