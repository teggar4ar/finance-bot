import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/command';
import type { Deps } from '../src/execute';
import { execute } from '../src/execute';
import type { Repo, Transaction } from '../src/repo';
import { fakeRepo } from './fake-repo';

const deps = (repo: Repo): Deps => ({ now: () => new Date('2026-11-03T01:00:00Z'), repo });
const run = async (text: string, repo: Repo): Promise<string> =>
  (await execute(parseCommand(text), deps(repo))) as string;

const expense: Transaction = {
  id: 12,
  type: 'expense',
  account: 'tunai',
  toAccount: null,
  amount: 25_000,
  description: 'makan siang',
};

describe('/undo', () => {
  it('membalas Transaksi yang dibatalkan beserta saldo terbaru (FR-050, FR-054)', async () => {
    const repo = fakeRepo({
      undoLast: async () => expense,
      getBalances: async () => ({ tunai: 175_000, bank: 0 }),
    });
    const text = await run('/undo', repo);

    expect(text).toContain('Transaksi dibatalkan');
    expect(text).toContain('makan siang');
    expect(text).toContain('25.000');
    expect(text).toContain('tunai');
    expect(text).toContain('ID 12');
    expect(text).toContain('Saldo tunai: 175.000');
  });

  it('menyebut Akun Pemasukan yang dibatalkan (FR-031)', async () => {
    const repo = fakeRepo({
      undoLast: async () => ({
        id: 13,
        type: 'income',
        account: 'bank',
        toAccount: null,
        amount: 5_000_000,
        description: 'gaji',
      }),
      getBalances: async () => ({ tunai: 0, bank: 100_000 }),
    });
    const text = await run('/undo', repo);

    expect(text).toContain('Pemasukan gaji');
    expect(text).toContain('bank');
    expect(text).toContain('Saldo bank: 100.000');
  });

  it('menyebut kedua Akun saat Transfer dibatalkan (FR-036)', async () => {
    const repo = fakeRepo({
      undoLast: async () => ({
        id: 14,
        type: 'transfer',
        account: 'bank',
        toAccount: 'tunai',
        amount: 500_000,
        description: 'Transfer bank ke tunai',
      }),
      getBalances: async () => ({ tunai: 200_000, bank: 5_000_000 }),
    });
    const text = await run('/undo', repo);

    expect(text).toContain('Transfer bank ke tunai');
    expect(text).toContain('Saldo bank: 5.000.000');
    expect(text).toContain('Saldo tunai: 200.000');
  });

  it('berlaku untuk Saldo awal (FR-050)', async () => {
    const repo = fakeRepo({
      undoLast: async () => ({
        id: 1,
        type: 'opening',
        account: 'tunai',
        toAccount: null,
        amount: 200_000,
        description: 'Saldo awal',
      }),
    });
    const text = await run('/undo', repo);

    expect(text).toContain('Saldo awal tunai · 200.000');
    expect(text).toContain('Saldo tunai: 0');
  });

  it('mengatakan tidak ada yang bisa dibatalkan (FR-054)', async () => {
    expect(await run('/undo', fakeRepo())).toBe(
      ['Tidak ada transaksi yang bisa dibatalkan.', 'Lihat /riwayat untuk transaksi aktif.'].join('\n'),
    );
  });

  it('membalas status, Transaksi, ID, dan saldo dalam baris terpisah (FR-054)', async () => {
    const repo = fakeRepo({
      undoLast: async () => expense,
      getBalances: async () => ({ tunai: 175_000, bank: 0 }),
    });

    expect((await run('/undo', repo)).split('\n')).toEqual([
      '✅ Transaksi dibatalkan',
      '💸 Pengeluaran makan siang · 25.000 · tunai',
      'ID 12',
      'Saldo tunai: 175.000',
    ]);
  });
});

describe('/redo', () => {
  it('membalas Transaksi yang dipulihkan beserta saldo terbaru (FR-052, FR-054)', async () => {
    const repo = fakeRepo({
      redoLast: async () => expense,
      getBalances: async () => ({ tunai: 175_000, bank: 0 }),
    });
    const text = await run('/redo', repo);

    expect(text).toContain('Transaksi dipulihkan');
    expect(text).toContain('makan siang');
    expect(text).toContain('ID 12');
    expect(text).toContain('Saldo tunai: 175.000');
  });

  it('mengatakan tidak ada yang bisa dipulihkan (FR-054)', async () => {
    expect(await run('/redo', fakeRepo())).toBe(
      ['Tidak ada transaksi yang bisa dipulihkan.', 'Lihat /riwayat untuk transaksi aktif.'].join('\n'),
    );
  });

  it('/undo dan /redo memakai operasi yang berbeda', async () => {
    const repo = fakeRepo({
      undoLast: async () => ({ ...expense, description: 'dibatalkan' }),
      redoLast: async () => ({ ...expense, description: 'dipulihkan' }),
    });

    expect(await run('/undo', repo)).toContain('dibatalkan');
    expect(await run('/redo', repo)).toContain('dipulihkan');
  });
});
