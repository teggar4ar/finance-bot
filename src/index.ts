import type { Config } from './config';
import { loadConfig } from './config';
import { createPool } from './db/pool';
import { loadDotEnv } from './env';
import type { Deps } from './execute';
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
  const deps: Deps = { now: () => new Date() };
  const bot = createBot(config.botToken, config.allowedUserId, deps);

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log('info', 'shutdown', { signal });
    await bot.stop();
    await pool.end();
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

  await bot.api.getMe();
  log('info', 'startup', { mode: 'polling' });
  await bot.start();
}

void main();