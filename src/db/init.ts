import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createPool } from './pool';
import { loadDotEnv } from '../env';
import { describeError, log } from '../log';

/** `npm run db:init`: jalankan schema.sql (idempoten) lalu migrasi kepemilikan. */
async function main(): Promise<void> {
  loadDotEnv();

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    log('error', 'config_invalid', { error: 'env DATABASE_URL belum diisi' });
    process.exitCode = 1;
    return;
  }

  // Elemen pertama `ALLOWED_USER_IDS` = pemilik data lama (ADR-0007).
  const ownerId = Number(process.env.ALLOWED_USER_IDS?.split(',')[0]?.trim());
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) {
    log('error', 'config_invalid', {
      error: 'env ALLOWED_USER_IDS harus memuat setidaknya satu Telegram user id positif',
    });
    process.exitCode = 1;
    return;
  }

  const sql = await readFile(path.join(process.cwd(), 'schema.sql'), 'utf8');
  const pool = createPool(databaseUrl);
  try {
    // Migrasi kepemilikan di dalam schema.sql membaca GUC ini pada sesi yang sama.
    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.owner_id', $1, false)", [String(ownerId)]);
      await client.query(sql);
    } finally {
      client.release();
    }
    log('info', 'db_init', { status: 'ok' });
  } catch (error) {
    log('error', 'db_init_failed', { error: describeError(error, process.env.BOT_TOKEN) });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();