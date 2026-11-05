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

  /** Menaruh Transaksi pada jam tertentu tanpa bergantung jam dinding. */
  async function setOccurredAt(id: number, iso: string): Promise<void> {
    await pool.query('UPDATE transactions SET occurred_at = $2 WHERE id = $1', [id, iso]);
  }

  beforeEach(async () => {
    await pool.query('TRUNCATE transactions, budgets RESTART IDENTITY');
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
    await repo.undoLast();

    await repo.addTransfer('bank', 'tunai', 100_000, 'Transfer bank ke tunai');

    const { rows } = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM transactions WHERE undone_at IS NOT NULL AND deleted_at IS NULL',
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('undoLast membatalkan Transaksi aktif terakhir dan mengembalikan saldo (FR-050)', async () => {
    await repo.setOpeningBalance('tunai', 200_000);
    const id = await repo.addExpenseOrIncome('tunai', 'expense', 25_000, 'makan siang');

    expect(await repo.undoLast()).toEqual({
      id,
      type: 'expense',
      account: 'tunai',
      toAccount: null,
      amount: 25_000,
      description: 'makan siang',
    });
    expect(await repo.getBalances()).toEqual({ tunai: 200_000, bank: 0 });

    const { rows } = await pool.query<{ undone_at: Date | null }>('SELECT undone_at FROM transactions WHERE id = $1', [id]);
    expect(rows[0]?.undone_at).toBeInstanceOf(Date);
  });

  it('undoLast berulang mundur ke Transaksi sebelumnya, terbaru lebih dulu (FR-051)', async () => {
    await repo.setOpeningBalance('tunai', 200_000);
    await repo.addExpenseOrIncome('tunai', 'expense', 25_000, 'makan siang');
    await repo.addExpenseOrIncome('tunai', 'expense', 5_000, 'parkir');

    expect((await repo.undoLast())?.description).toBe('parkir');
    expect((await repo.undoLast())?.description).toBe('makan siang');
    expect((await repo.undoLast())?.type).toBe('opening');
    expect(await repo.undoLast()).toBeNull();
    expect(await repo.getBalances()).toEqual({ tunai: 0, bank: 0 });
  });

  it('redoLast memulihkan dengan urutan LIFO (FR-052)', async () => {
    await repo.setOpeningBalance('tunai', 200_000);
    await repo.addExpenseOrIncome('tunai', 'expense', 25_000, 'makan siang');
    await repo.addExpenseOrIncome('tunai', 'expense', 5_000, 'parkir');
    await repo.undoLast();
    await repo.undoLast();

    expect((await repo.redoLast())?.description).toBe('makan siang');
    expect((await repo.redoLast())?.description).toBe('parkir');
    expect(await repo.redoLast()).toBeNull();
    expect(await repo.getBalances()).toEqual({ tunai: 170_000, bank: 0 });
  });

  it('menulis Transaksi baru membuang seluruh Riwayat undo (FR-053)', async () => {
    await repo.setOpeningBalance('tunai', 200_000);
    await repo.addExpenseOrIncome('tunai', 'expense', 5_000, 'parkir');
    await repo.undoLast();
    await repo.undoLast();

    await repo.addExpenseOrIncome('tunai', 'expense', 25_000, 'makan siang');

    expect(await repo.redoLast()).toBeNull();
    const { rows } = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM transactions WHERE undone_at IS NOT NULL AND deleted_at IS NOT NULL',
    );
    expect(rows[0]?.count).toBe('2');
  });

  it('undoLast berlaku untuk Transfer sebagai satu baris (FR-036, FR-050)', async () => {
    await repo.setOpeningBalance('tunai', 200_000);
    await repo.setOpeningBalance('bank', 5_000_000);
    await repo.addTransfer('bank', 'tunai', 500_000, 'Transfer bank ke tunai');

    expect(await repo.undoLast()).toEqual({
      id: expect.any(Number),
      type: 'transfer',
      account: 'bank',
      toAccount: 'tunai',
      amount: 500_000,
      description: 'Transfer bank ke tunai',
    });
    expect(await repo.getBalances()).toEqual({ tunai: 200_000, bank: 5_000_000 });
  });

  it('redoLast memulihkan Transfer sebagai satu baris (FR-036, FR-052)', async () => {
    await repo.setOpeningBalance('tunai', 200_000);
    await repo.setOpeningBalance('bank', 5_000_000);
    await repo.addTransfer('bank', 'tunai', 500_000, 'Transfer bank ke tunai');
    await repo.undoLast();

    expect((await repo.redoLast())?.type).toBe('transfer');
    expect(await repo.getBalances()).toEqual({ tunai: 700_000, bank: 4_500_000 });
  });

  it('redoLast memulihkan Saldo awal (FR-052)', async () => {
    await repo.setOpeningBalance('tunai', 200_000);
    await repo.undoLast();
    expect(await repo.getBalances()).toEqual({ tunai: 0, bank: 0 });

    expect((await repo.redoLast())?.type).toBe('opening');
    expect(await repo.getBalances()).toEqual({ tunai: 200_000, bank: 0 });
  });

  it('getHistory hanya Transaksi aktif, terbaru lebih dulu (FR-060)', async () => {
    const older = await repo.addExpenseOrIncome('tunai', 'expense', 25_000, 'makan siang');
    const newer = await repo.addExpenseOrIncome('bank', 'income', 5_000_000, 'gaji');
    await repo.addExpenseOrIncome('tunai', 'expense', 5_000, 'parkir');
    await repo.undoLast();
    await pool.query("UPDATE transactions SET occurred_at = '2026-11-01T02:00:00Z' WHERE id = $1", [older]);

    const history = await repo.getHistory(10);

    expect(history.map((entry) => entry.id)).toEqual([newer, older]);
    expect(history[0]?.occurredAt).toBeInstanceOf(Date);
    expect(history[1]?.occurredAt.toISOString()).toBe('2026-11-01T02:00:00.000Z');
    expect((await repo.getHistory(1)).map((entry) => entry.id)).toEqual([newer]);
  });

  it('editTransaction mengubah deskripsi, Nominal, dan akun (FR-061)', async () => {
    const id = await repo.addExpenseOrIncome('tunai', 'expense', 25_000, 'makan siang');

    expect(await repo.editTransaction(id, 'makan malam', 30_000, 'bank')).toEqual({
      id,
      type: 'expense',
      account: 'bank',
      toAccount: null,
      amount: 30_000,
      description: 'makan malam',
    });
    expect(await repo.getBalances()).toEqual({ tunai: 0, bank: -30_000 });
  });

  it('editTransaction tanpa akun mempertahankan akun lama (FR-061)', async () => {
    const id = await repo.addExpenseOrIncome('bank', 'income', 5_000_000, 'gaji');
    await repo.editTransaction(id, 'gaji november', 6_000_000, null);

    expect(await repo.getBalances()).toEqual({ tunai: 0, bank: 6_000_000 });
    expect((await repo.getHistory(10))[0]?.account).toBe('bank');
  });

  it('editTransaction menolak Transfer, Saldo awal, dan ID tak dikenal (FR-063, FR-065)', async () => {
    const opening = await repo.setOpeningBalance('bank', 1_000_000);
    const transfer = await repo.addTransfer('bank', 'tunai', 100_000, 'Transfer bank ke tunai');

    expect(await repo.editTransaction(opening, 'saldo', 1, null)).toBeNull();
    expect(await repo.editTransaction(transfer, 'pindah', 1, null)).toBeNull();
    expect(await repo.editTransaction(9_999, 'apa saja', 1, null)).toBeNull();
    expect(await repo.getBalances()).toEqual({ tunai: 100_000, bank: 900_000 });
  });

  it('editTransaction menolak Transaksi Dibatalkan dan Dihapus (FR-063)', async () => {
    const undone = await repo.addExpenseOrIncome('tunai', 'expense', 25_000, 'makan siang');
    await repo.undoLast();
    const deleted = await repo.addExpenseOrIncome('tunai', 'expense', 5_000, 'parkir');
    await repo.deleteTransaction(deleted);

    expect(await repo.editTransaction(undone, 'makan malam', 30_000, null)).toBeNull();
    expect(await repo.editTransaction(deleted, 'parkir motor', 10_000, null)).toBeNull();
    expect(await repo.getBalances()).toEqual({ tunai: 0, bank: 0 });
  });

  it('deleteTransaction menghapus Transaksi aktif beserta efeknya di saldo (FR-062)', async () => {
    const id = await repo.addExpenseOrIncome('tunai', 'expense', 25_000, 'makan siang');

    expect(await repo.deleteTransaction(id)).toEqual({
      id,
      type: 'expense',
      account: 'tunai',
      toAccount: null,
      amount: 25_000,
      description: 'makan siang',
    });
    expect(await repo.getBalances()).toEqual({ tunai: 0, bank: 0 });
    expect(await repo.getHistory(10)).toEqual([]);
    expect(await repo.deleteTransaction(id)).toBeNull();
  });

  it('deleteTransaction pada Transfer menghapus kedua Baris ledger (FR-062)', async () => {
    await repo.setOpeningBalance('bank', 1_000_000);
    const id = await repo.addTransfer('bank', 'tunai', 250_000, 'Transfer bank ke tunai');

    expect((await repo.deleteTransaction(id))?.type).toBe('transfer');
    expect(await repo.getBalances()).toEqual({ tunai: 0, bank: 1_000_000 });
  });

  it('Transaksi yang Dihapus tidak bisa dipulihkan dengan redo (FR-062)', async () => {
    await repo.setOpeningBalance('tunai', 200_000);
    const id = await repo.addExpenseOrIncome('tunai', 'expense', 25_000, 'makan siang');
    await repo.deleteTransaction(id);

    expect(await repo.redoLast()).toBeNull();
    expect(await repo.getBalances()).toEqual({ tunai: 200_000, bank: 0 });
  });

  it('edit dan hapus tidak membuang Riwayat undo (FR-053)', async () => {
    await repo.setOpeningBalance('tunai', 200_000);
    const edited = await repo.addExpenseOrIncome('tunai', 'expense', 25_000, 'makan siang');
    const removed = await repo.addExpenseOrIncome('tunai', 'expense', 5_000, 'parkir');
    const undone = await repo.addExpenseOrIncome('tunai', 'expense', 10_000, 'kopi');
    await repo.undoLast();

    await repo.editTransaction(edited, 'makan malam', 30_000, null);
    await repo.deleteTransaction(removed);

    expect((await repo.redoLast())?.id).toBe(undone);
  });

  it('getSummary hanya menghitung Pengeluaran dan Pemasukan aktif (FR-074)', async () => {
    await repo.setOpeningBalance('tunai', 200_000);
    await repo.addTransfer('tunai', 'bank', 50_000, 'Transfer tunai ke bank');
    const expense = await repo.addExpenseOrIncome('tunai', 'expense', 25_000, 'makan siang');
    const income = await repo.addExpenseOrIncome('bank', 'income', 5_000_000, 'gaji');
    await repo.addExpenseOrIncome('tunai', 'expense', 10_000, 'kopi');
    await repo.undoLast();
    const deleted = await repo.addExpenseOrIncome('tunai', 'expense', 5_000, 'parkir');
    await repo.deleteTransaction(deleted);
    await pool.query("UPDATE transactions SET occurred_at = '2020-01-15T03:00:00Z' WHERE id IN ($1, $2)", [
      expense,
      income,
    ]);

    expect(await repo.getSummary(new Date('2020-01-01T00:00:00Z'), new Date('2020-02-01T00:00:00Z'))).toEqual({
      income: 5_000_000,
      expense: 25_000,
      txCount: 2,
    });
  });

  it('getSummary memakai batas awal inklusif dan batas akhir eksklusif (FR-075)', async () => {
    const start = '2026-11-02T17:00:00Z'; // 00:00 WIB 03/11
    const end = '2026-11-03T17:00:00Z'; // 00:00 WIB 04/11
    const atStart = await repo.addExpenseOrIncome('tunai', 'expense', 10_000, 'tepat awal');
    const atEnd = await repo.addExpenseOrIncome('tunai', 'expense', 20_000, 'tepat akhir');
    await pool.query('UPDATE transactions SET occurred_at = $2 WHERE id = $1', [atStart, start]);
    await pool.query('UPDATE transactions SET occurred_at = $2 WHERE id = $1', [atEnd, end]);

    expect(await repo.getSummary(new Date(start), new Date(end))).toEqual({
      income: 0,
      expense: 10_000,
      txCount: 1,
    });
    expect(await repo.getSummary(new Date('2000-01-01T00:00:00Z'), new Date('2000-02-01T00:00:00Z'))).toEqual({
      income: 0,
      expense: 0,
      txCount: 0,
    });
  });

  it('setBudget menetapkan Budget mulai tanggal itu dan menimpa tanggal yang sama (FR-082, FR-083)', async () => {
    await repo.setBudget(150_000, '2026-11-04');
    expect(await repo.getBudgetFor('2026-11-04')).toBe(150_000);

    await repo.setBudget(200_000, '2026-11-04');
    expect(await repo.getBudgetFor('2026-11-04')).toBe(200_000);

    const { rows } = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM budgets');
    expect(rows[0]?.count).toBe('1');
  });

  it('getBudgetFor memakai Budget terakhir yang berlaku pada hari itu (FR-081, FR-083)', async () => {
    expect(await repo.getBudgetFor('2026-11-04')).toBeNull();

    await repo.setBudget(100_000, '2026-11-04');
    await repo.setBudget(150_000, '2026-11-10');

    expect(await repo.getBudgetFor('2026-11-03')).toBeNull();
    expect(await repo.getBudgetFor('2026-11-04')).toBe(100_000);
    expect(await repo.getBudgetFor('2026-11-09')).toBe(100_000);
    expect(await repo.getBudgetFor('2026-11-10')).toBe(150_000);
  });

  it('getExpenseUsed hanya menghitung Pengeluaran aktif dalam rentang (FR-084, FR-087)', async () => {
    const opening = await repo.setOpeningBalance('tunai', 1_000_000);
    const transfer = await repo.addTransfer('tunai', 'bank', 50_000, 'Transfer tunai ke bank');
    const income = await repo.addExpenseOrIncome('bank', 'income', 500_000, 'gaji');
    const expense = await repo.addExpenseOrIncome('tunai', 'expense', 25_000, 'makan siang');
    const atEnd = await repo.addExpenseOrIncome('tunai', 'expense', 10_000, 'parkir');

    // Baris non-expense ditaruh di dalam rentang supaya yang diuji benar-benar pengecualian jenisnya.
    for (const id of [opening, transfer, income]) await setOccurredAt(id, '2026-11-03T18:00:00Z');
    await setOccurredAt(expense, '2026-11-03T17:00:00Z'); // batas awal inklusif
    await setOccurredAt(atEnd, '2026-11-04T17:00:00Z'); // batas akhir eksklusif

    const undone = await repo.addExpenseOrIncome('tunai', 'expense', 5_000, 'kopi');
    await setOccurredAt(undone, '2026-11-03T19:00:00Z');
    await repo.undoLast();

    const deleted = await repo.addExpenseOrIncome('tunai', 'expense', 7_000, 'batal');
    await setOccurredAt(deleted, '2026-11-03T20:00:00Z');
    await repo.deleteTransaction(deleted);

    const start = new Date('2026-11-03T17:00:00Z'); // 00:00 WIB 04/11
    const end = new Date('2026-11-04T17:00:00Z'); // 00:00 WIB 05/11
    expect(await repo.getExpenseUsed(start, end)).toBe(25_000);

    // Edit langsung tercermin karena pemakaian selalu dihitung ulang dari Transaksi (FR-087).
    await repo.editTransaction(expense, 'makan malam', 30_000, null);
    expect(await repo.getExpenseUsed(start, end)).toBe(30_000);
  });

  it('getLedger menghitung saldo berjalan per akun dan total, Saldo awal lebih dulu (FR-092, FR-093, FR-095)', async () => {
    const openingTunai = await repo.setOpeningBalance('tunai', 200_000);
    const openingBank = await repo.setOpeningBalance('bank', 1_000_000);
    const transfer = await repo.addTransfer('bank', 'tunai', 250_000, 'Transfer bank ke tunai');
    const expense = await repo.addExpenseOrIncome('tunai', 'expense', 50_000, 'makan siang');
    // Saldo awal ditetapkan paling akhir tapi harus tampil lebih dulu (ADR-0003).
    await setOccurredAt(openingTunai, '2026-11-05T02:00:00Z');
    await setOccurredAt(openingBank, '2026-11-05T03:00:00Z');
    await setOccurredAt(transfer, '2026-11-01T02:00:00Z');
    await setOccurredAt(expense, '2026-11-02T02:00:00Z');

    const ledger = await repo.getLedger(null, null);

    expect(ledger.map((row) => [row.id, row.account, row.moneyIn, row.moneyOut, row.accountBalance, row.totalBalance])).toEqual([
      [openingTunai, 'tunai', 200_000, 0, 200_000, 200_000],
      [openingBank, 'bank', 1_000_000, 0, 1_000_000, 1_200_000],
      [transfer, 'bank', 0, 250_000, 750_000, 1_200_000],
      [transfer, 'tunai', 250_000, 0, 450_000, 1_200_000],
      [expense, 'tunai', 0, 50_000, 400_000, 1_150_000],
    ]);
    expect(ledger[0]?.occurredAt).toBeInstanceOf(Date);
  });

  it('getLedger bulanan hanya rentang itu, saldo berjalan tetap menyambung riwayat (FR-091)', async () => {
    const opening = await repo.setOpeningBalance('tunai', 200_000);
    const october = await repo.addExpenseOrIncome('tunai', 'expense', 50_000, 'oktober');
    const november = await repo.addExpenseOrIncome('tunai', 'income', 100_000, 'gaji');
    await setOccurredAt(opening, '2026-10-05T02:00:00Z');
    await setOccurredAt(october, '2026-10-20T02:00:00Z');
    await setOccurredAt(november, '2026-11-10T02:00:00Z');

    const start = new Date('2026-10-31T17:00:00Z'); // 00:00 WIB 01/11
    const end = new Date('2026-11-30T17:00:00Z'); // 00:00 WIB 01/12
    expect(await repo.getLedger(start, end)).toEqual([
      expect.objectContaining({ id: november, accountBalance: 250_000, totalBalance: 250_000, moneyIn: 100_000 }),
    ]);
  });

  it('getCarryIn hanya menjumlahkan Baris sebelum rentang dan melewatkan yang non-aktif (FR-096, FR-097)', async () => {
    const opening = await repo.setOpeningBalance('tunai', 200_000);
    const undone = await repo.addExpenseOrIncome('tunai', 'expense', 25_000, 'kopi');
    await repo.undoLast();
    const deleted = await repo.addExpenseOrIncome('tunai', 'expense', 5_000, 'parkir');
    await repo.deleteTransaction(deleted);
    await setOccurredAt(opening, '2026-10-05T02:00:00Z');
    await setOccurredAt(undone, '2026-10-06T02:00:00Z');
    await setOccurredAt(deleted, '2026-10-07T02:00:00Z');

    const start = new Date('2026-10-31T17:00:00Z');
    expect(await repo.getCarryIn(start)).toEqual([{ account: 'tunai', balance: 200_000 }]);

    const future = new Date('2026-11-30T17:00:00Z');
    expect(await repo.getCarryIn(future)).toEqual([{ account: 'tunai', balance: 200_000 }]);

    // Saldo awal adalah baris nol, jadi ia ikut walau periode yang diekspor lebih awal (FR-095).
    const earlier = new Date('2026-10-01T00:00:00Z');
    expect(await repo.getCarryIn(earlier)).toEqual([{ account: 'tunai', balance: 200_000 }]);
  });

  it('getCarryIn kosong bila belum ada Saldo awal maupun Transaksi lama (FR-097)', async () => {
    expect(await repo.getCarryIn(new Date('2026-10-01T00:00:00Z'))).toEqual([]);
  });

  it('Saldo awal dalam bulan export jadi Baris pembuka periode, bukan baris biasa (FR-095, FR-097)', async () => {
    const opening = await repo.setOpeningBalance('tunai', 200_000);
    const expense = await repo.addExpenseOrIncome('tunai', 'expense', 50_000, 'setelah saldo awal');
    await setOccurredAt(opening, '2026-11-05T02:00:00Z');
    await setOccurredAt(expense, '2026-11-10T02:00:00Z');

    const start = new Date('2026-10-31T17:00:00Z');
    const end = new Date('2026-11-30T17:00:00Z');
    expect(await repo.getCarryIn(start)).toEqual([{ account: 'tunai', balance: 200_000 }]);
    expect(await repo.getLedger(start, end)).toEqual([
      expect.objectContaining({ id: expense, moneyOut: 50_000, accountBalance: 150_000, totalBalance: 150_000 }),
    ]);
  });

  it('Saldo awal yang ditetapkan setelah bulan export tetap terbawa sebagai Baris pembuka periode (FR-095, FR-097)', async () => {
    const opening = await repo.setOpeningBalance('tunai', 200_000);
    const expense = await repo.addExpenseOrIncome('tunai', 'expense', 50_000, 'oktober');
    await setOccurredAt(opening, '2026-11-20T02:00:00Z'); // ditetapkan setelah bulan yang diekspor
    await setOccurredAt(expense, '2026-10-20T02:00:00Z');

    const start = new Date('2026-09-30T17:00:00Z');
    const end = new Date('2026-10-31T17:00:00Z');
    expect(await repo.getCarryIn(start)).toEqual([{ account: 'tunai', balance: 200_000 }]);
    expect(await repo.getLedger(start, end)).toEqual([
      expect.objectContaining({ id: expense, accountBalance: 150_000, totalBalance: 150_000 }),
    ]);
  });

  it('getLedger melewatkan Transaksi Dibatalkan dan Dihapus (FR-096)', async () => {
    const kept = await repo.addExpenseOrIncome('tunai', 'expense', 25_000, 'makan siang');
    await repo.addExpenseOrIncome('tunai', 'expense', 5_000, 'kopi');
    await repo.undoLast();
    const deleted = await repo.addExpenseOrIncome('tunai', 'expense', 7_000, 'batal');
    await repo.deleteTransaction(deleted);

    expect((await repo.getLedger(null, null)).map((row) => row.id)).toEqual([kept]);
  });
});