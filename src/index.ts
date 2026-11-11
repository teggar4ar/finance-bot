import type { Config } from './config';
import { loadConfig } from './config';
import { createPool } from './db/pool';
import { createRepo } from './db/repo';
import { loadDotEnv } from './env';
import { describeError, log } from './log';
import { createBot } from './telegram';

async function main(): Promise<void> {
  loadDotEnv();

  let config: Config;
  try {
    config = loadConfig();
  } catch (error) {
    log('error', 'config_invalid', { error: describeError(error) });
    process.exit(1);
  }

  const pool = createPool(config.databaseUrl);
  const bot = createBot(config.botToken, config.allowedUserIds, (owner) => ({
    now: () => new Date(),
    repo: createRepo(pool, owner),
  }));

  let stopping = false;
  let running: Promise<void> | undefined;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log('info', 'shutdown', { signal });
    try {
      // bot.stop() berhenti menarik update baru tapi tidak menunggu middleware
      // yang sedang jalan; `running` (promise bot.start()) selesai setelah
      // middleware in-flight tuntas (dokumentasi grammY). Lalu tutup pool.
      await bot.stop();
      await running;
    } catch (error) {
      log('error', 'shutdown_stop_failed', { error: describeError(error, config.botToken) });
    }
    try {
      await pool.end();
    } catch (error) {
      log('error', 'shutdown_pool_failed', { error: describeError(error, config.botToken) });
    }
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  try {
    await pool.query('SELECT 1');
    log('info', 'db_connected');
  } catch (error) {
    log('error', 'db_connect_failed', { error: describeError(error, config.botToken) });
    await pool.end();
    process.exit(1);
  }

  try {
    await bot.api.getMe();
  } catch (error) {
    log('error', 'startup_failed', { error: describeError(error, config.botToken) });
    await pool.end();
    process.exit(1);
  }

  log('info', 'startup', { mode: 'polling' });
  running = bot.start();
  await running;
}

void main();