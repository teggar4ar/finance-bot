import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/pool';
import { createRepo } from '../src/db/repo';
import { loadDotEnv } from '../src/env';
import type { Repo } from '../src/repo';

loadDotEnv();

const url = process.env.TEST_DATABASE_URL?.trim();
const suite = url ? describe : describe.skip;

suite('repo Postgres (integrasi, NFR-081/082)', () => {
  let pool: Pool;
  let repo: Repo;

  beforeAll(async () => {
    pool = createPool(url!);
    const { rows } = await pool.query<{ name: string }>('SELECT current_database() AS name');
    const name = rows[0]?.name ?? '';
    // Tes ini men-TRUNCATE; jangan pernah biarkan menembak database non-test.
    if (!name.endsWith('_test')) {
      throw new Error(`TEST_DATABASE_URL harus menunjuk database *_test, bukan ${name}`);
    }
    await pool.query(await readFile(path.join(process.cwd(), 'schema.sql'), 'utf8'));
    repo = createRepo(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE transactions RESTART IDENTITY');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('akun tanpa transaksi bersaldo 0', async () => {
    expect(await repo.getBalances()).toEqual({ tunai: 0, bank: 0 });
  });

  it('menyimpan saldo awal dan membalikkan ID', async () => {
    const id = await repo.setOpeningBalance('tunai', 200_000);
    expect(id).toBeGreaterThan(0);
    expect(await repo.getBalances()).toEqual({ tunai: 200_000, bank: 0 });
  });

  it('menetapkan ulang mengganti nilai lama (FR-013)', async () => {
    const first = await repo.setOpeningBalance('tunai', 200_000);
    const second = await repo.setOpeningBalance('tunai', 300_000);

    expect(second).not.toBe(first);
    expect(await repo.getBalances()).toEqual({ tunai: 300_000, bank: 0 });

    const { rows } = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM transactions WHERE type = 'opening' AND deleted_at IS NULL",
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('kedua akun berdiri sendiri', async () => {
    await repo.setOpeningBalance('tunai', 200_000);
    await repo.setOpeningBalance('bank', 5_000_000);
    expect(await repo.getBalances()).toEqual({ tunai: 200_000, bank: 5_000_000 });
  });

  it('menyimpan Pengeluaran dan Pemasukan lengkap dengan occurred_at (FR-030, FR-031, FR-040)', async () => {
    const before = Date.now();
    const id = await repo.addExpenseOrIncome('tunai', 'expense', 25_000, 'makan siang');
    await repo.addExpenseOrIncome('bank', 'income', 5_000_000, 'gaji');

    const { rows } = await pool.query<{
      type: string;
      account: string;
      amount: string;
      description: string;
      occurred_at: Date;
    }>('SELECT type, account, amount::text AS amount, description, occurred_at FROM transactions WHERE id = $1', [id]);

    expect(rows[0]).toEqual({
      type: 'expense',
      account: 'tunai',
      amount: '25000',
      description: 'makan siang',
      occurred_at: expect.any(Date),
    });
    expect(rows[0]!.occurred_at.getTime()).toBeGreaterThanOrEqual(before - 60_000);
    expect(await repo.getBalances()).toEqual({ tunai: -25_000, bank: 5_000_000 });
  });

  it('menulis Transaksi baru membuang seluruh Riwayat undo (FR-053)', async () => {
    await repo.setOpeningBalance('tunai', 200_000);
    // /undo belum ada (#6); status dibatalkan disiapkan langsung di sini.
    await pool.query("UPDATE transactions SET undone_at = now() WHERE type = 'opening'");

    await repo.addExpenseOrIncome('tunai', 'expense', 25_000, 'makan siang');

    const { rows } = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM transactions WHERE undone_at IS NOT NULL AND deleted_at IS NULL',
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('menyimpan Transfer sebagai satu baris dengan akun asal dan tujuan (FR-036, FR-037)', async () => {
    await repo.setOpeningBalance('tunai', 200_000);
    await repo.setOpeningBalance('bank', 5_000_000);

    const id = await repo.addTransfer('bank', 'tunai', 500_000, 'Transfer bank ke tunai');

    const { rows } = await pool.query<{ type: string; account: string; to_account: string; amount: string }>(
      'SELECT type, account, to_account, amount::text AS amount FROM transactions WHERE id = $1',
      [id],
    );
    expect(rows).toEqual([{ type: 'transfer', account: 'bank', to_account: 'tunai', amount: '500000' }]);
    expect(await repo.getBalances()).toEqual({ tunai: 700_000, bank: 4_500_000 });
  });

  it('Transfer muncul sebagai dua Baris ledger dan totalnya tetap (FR-037)', async () => {
    await repo.setOpeningBalance('bank', 1_000_000);
    const id = await repo.addTransfer('bank', 'tunai', 250_000, 'Transfer bank ke tunai');

    const { rows } = await pool.query<{ account: string; money_in: string; money_out: string }>(
      'SELECT account, money_in::text AS money_in, money_out::text AS money_out FROM ledger_entries WHERE id = $1 ORDER BY leg',
      [id],
    );
    expect(rows).toEqual([
      { account: 'bank', money_in: '0', money_out: '250000' },
      { account: 'tunai', money_in: '250000', money_out: '0' },
    ]);
    expect(await repo.getBalances()).toEqual({ tunai: 250_000, bank: 750_000 });
  });

  it('Transfer yang ditolak database tidak menulis apa pun (FR-037, NFR-013)', async () => {
    await repo.setOpeningBalance('tunai', 200_000);
    await pool.query("UPDATE transactions SET undone_at = now() WHERE type = 'opening'");

    // Akun asal = tujuan melanggar chk_tx_transfer; tidak ada baris Transfer yang tersisa.
    await expect(repo.addTransfer('tunai', 'tunai', 50_000, 'Transfer tunai ke tunai')).rejects.toThrow();

    const { rows } = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM transactions WHERE type = 'transfer'",
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('Transfer membuang seluruh Riwayat undo (FR-053)', async () => {
    await repo.setOpeningBalance('bank', 1_000_000);
    // /undo belum ada (#6); status dibatalkan disiapkan langsung di sini.
    await pool.query("UPDATE transactions SET undone_at = now() WHERE type = 'opening'");

    await repo.addTransfer('bank', 'tunai', 100_000, 'Transfer bank ke tunai');

    const { rows } = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM transactions WHERE undone_at IS NOT NULL AND deleted_at IS NULL',
    );
    expect(rows[0]?.count).toBe('0');
  });
});