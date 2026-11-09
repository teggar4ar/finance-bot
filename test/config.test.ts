import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const env = {
  BOT_TOKEN: 'token-uji',
  ALLOWED_USER_IDS: '42',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/keuangan_dev',
};

describe('loadConfig', () => {
  it('membaca konfigurasi yang lengkap', () => {
    expect(loadConfig(env)).toEqual({
      botToken: 'token-uji',
      allowedUserIds: [42],
      databaseUrl: env.DATABASE_URL,
    });
  });

  it('membaca beberapa id, mengabaikan spasi, urutan dijaga (elemen pertama = pemilik)', () => {
    expect(loadConfig({ ...env, ALLOWED_USER_IDS: ' 42, 99 ,7' }).allowedUserIds).toEqual([42, 99, 7]);
  });

  it('gagal bila BOT_TOKEN kosong', () => {
    expect(() => loadConfig({ ...env, BOT_TOKEN: '  ' })).toThrow(/BOT_TOKEN/);
  });

  it('gagal bila DATABASE_URL kosong', () => {
    expect(() => loadConfig({ ...env, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('gagal bila ALLOWED_USER_IDS kosong atau bukan id positif (NFR-006)', () => {
    for (const value of [undefined, '', '   ', 'abc', '0', '-5', '1.5', '42,abc', '42,0', '0x2A', '1e3', '+42']) {
      expect(() => loadConfig({ ...env, ALLOWED_USER_IDS: value })).toThrow(/ALLOWED_USER_IDS/);
    }
  });

  it('gagal bila ALLOWED_USER_IDS memuat id ganda (NFR-006)', () => {
    expect(() => loadConfig({ ...env, ALLOWED_USER_IDS: '42,42' })).toThrow(/ALLOWED_USER_IDS/);
  });
});
