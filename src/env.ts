import { existsSync } from 'node:fs';

/**
 * Muat `.env` lokal bila ada, pakai loader bawaan Node (tanpa dependency).
 * Di server tidak ada `.env`, jadi environment asli yang dipakai (NFR-002).
 */
export function loadDotEnv(): void {
  if (existsSync('.env')) process.loadEnvFile();
}