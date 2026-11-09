import { Pool } from 'pg';
import { describeError, log } from '../log';

/** Heroku Postgres butuh SSL; PostgreSQL lokal tidak (NFR-032, bagian 10 db-schema). */
export function createPool(databaseUrl: string): Pool {
  const host = new URL(databaseUrl).hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';

  const pool = new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DB_POOL_SIZE ?? 3),
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });

  pool.on('error', (error) => log('error', 'pool_error', { error: describeError(error) }));
  return pool;
}