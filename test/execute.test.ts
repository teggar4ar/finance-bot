import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/command';
import type { Deps } from '../src/execute';
import { HELP, HINT, execute } from '../src/execute';

const deps: Deps = {
  now: () => new Date('2026-11-03T01:00:00Z'),
  repo: {
    setOpeningBalance: async () => 1,
    addExpenseOrIncome: async () => 1,
    addTransfer: async () => 1,
    getBalances: async () => ({ tunai: 0, bank: 0 }),
  },
};

describe('execute', () => {
  it('/help dan /start memberi daftar command yang sama', async () => {
    const help = await execute(parseCommand('/help'), deps);
    const start = await execute(parseCommand('/start'), deps);
    expect(help).toBe(HELP);
    expect(start).toBe(HELP);
  });

  it('daftar command memuat semua command v1 (FR-100)', () => {
    for (const command of [
      '/saldo',
      '/saldo_awal',
      '/pengeluaran',
      '/pemasukan',
      '/transfer',
      '/undo',
      '/redo',
      '/riwayat',
      '/edit',
      '/hapus',
      '/hari_ini',
      '/minggu_ini',
      '/bulan_ini',
      '/ringkasan',
      '/budget',
      '/export',
      '/help',
    ]) {
      expect(HELP).toContain(command);
    }
  });

  it('daftar command memuat alias /k dan /m (FR-030, FR-031)', () => {
    expect(HELP).toContain('(alias /k)');
    expect(HELP).toContain('(alias /m)');
  });

  it('teks biasa dibalas petunjuk singkat (FR-103)', async () => {
    expect(await execute(parseCommand('halo bot'), deps)).toBe(HINT);
  });

  it('command tak dikenal dibalas petunjuk singkat', async () => {
    expect(await execute(parseCommand('/tidak_ada'), deps)).toBe(HINT);
  });

  it('pesan kosong tanpa command dibalas petunjuk', async () => {
    expect(await execute(parseCommand(''), deps)).toBe(HINT);
  });
});