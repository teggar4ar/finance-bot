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
});