/**
 * Konfigurasi startup. Gagal cepat bila ada yang kurang (NFR-006, D11).
 */
export interface Config {
  botToken: string;
  allowedUserId: number;
  databaseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const botToken = env.BOT_TOKEN?.trim();
  if (!botToken) throw new Error('env BOT_TOKEN belum diisi');

  const allowedUserId = Number(env.ALLOWED_USER_ID?.trim());
  if (!Number.isInteger(allowedUserId) || allowedUserId <= 0) {
    throw new Error('env ALLOWED_USER_ID harus bilangan bulat positif');
  }

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('env DATABASE_URL belum diisi');

  return { botToken, allowedUserId, databaseUrl };
}