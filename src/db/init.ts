import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createPool } from './pool';
import { loadDotEnv } from '../env';
import { describeError, log } from '../log';

/** `npm run db:init`: jalankan schema.sql (idempoten) terhadap DATABASE_URL. */
async function main(): Promise<void> {
  loadDotEnv();

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    log('error', 'config_invalid', { error: 'env DATABASE_URL belum diisi' });
    process.exitCode = 1;
    return;
  }

  const sql = await readFile(path.join(process.cwd(), 'schema.sql'), 'utf8');
  const pool = createPool(databaseUrl);
  try {
    await pool.query(sql);
    log('info', 'db_init', { status: 'ok' });
  } catch (error) {
    log('error', 'db_init_failed', { error: describeError(error, process.env.BOT_TOKEN) });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();