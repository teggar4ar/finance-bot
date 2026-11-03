import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const env = {
  BOT_TOKEN: 'token-uji',
  ALLOWED_USER_ID: '42',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/keuangan_dev',
};

describe('loadConfig', () => {
  it('membaca konfigurasi yang lengkap', () => {
    expect(loadConfig(env)).toEqual({
      botToken: 'token-uji',
      allowedUserId: 42,
      databaseUrl: env.DATABASE_URL,
    });
  });

  it('gagal bila BOT_TOKEN kosong', () => {
    expect(() => loadConfig({ ...env, BOT_TOKEN: '  ' })).toThrow(/BOT_TOKEN/);
  });

  it('gagal bila DATABASE_URL kosong', () => {
    expect(() => loadConfig({ ...env, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('gagal bila ALLOWED_USER_ID bukan bilangan bulat positif', () => {
    for (const value of [undefined, '', 'abc', '0', '-5', '1.5']) {
      expect(() => loadConfig({ ...env, ALLOWED_USER_ID: value })).toThrow(/ALLOWED_USER_ID/);
    }
  });
});