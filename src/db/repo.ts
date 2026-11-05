import type { Pool, PoolClient } from 'pg';
import type { Account, Balances, HistoryTransaction, LedgerEntry, Repo, Transaction } from '../repo';

/** `pg` mengembalikan BIGINT sebagai string (NFR-011). */
function toSafeNumber(value: string): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new Error(`nilai di luar rentang aman: ${value}`);
  return amount;
}

interface TransactionRow {
  id: string;
  type: Transaction['type'];
  account: Account;
  to_account: Account | null;
  amount: string;
  description: string;
}

const TX_COLUMNS = 'id, type, account, to_account, amount, description';

interface HistoryRow extends TransactionRow {
  occurred_at: Date;
}

/** `SUM` dan `COUNT` kembali sebagai string/integer dari `pg` (NFR-011). */
interface SummaryRow {
  income: string;
  expense: string;
  tx_count: number;
}

interface LedgerRow {
  id: string;
  occurred_at: Date;
  account: Account;
  type: LedgerEntry['type'];
  description: string;
  money_in: string;
  money_out: string;
  account_balance: string;
  total_balance: string;
}

function toLedgerEntry(row: LedgerRow): LedgerEntry {
  return {
    id: toSafeNumber(row.id),
    occurredAt: row.occurred_at,
    account: row.account,
    type: row.type,
    description: row.description,
    moneyIn: toSafeNumber(row.money_in),
    moneyOut: toSafeNumber(row.money_out),
    accountBalance: toSafeNumber(row.account_balance),
    totalBalance: toSafeNumber(row.total_balance),
  };
}

function toTransaction(row: TransactionRow): Transaction {
  const base = {
    id: toSafeNumber(row.id),
    account: row.account,
    amount: toSafeNumber(row.amount),
    description: row.description,
  };
  if (row.type !== 'transfer') return { ...base, type: row.type, toAccount: null };
  if (!row.to_account) throw new Error(`Transfer ${base.id} tanpa akun tujuan`);
  return { ...base, type: 'transfer', toAccount: row.to_account };
}

const DISCARD_REDO_HISTORY =
  'UPDATE transactions SET deleted_at = now() WHERE undone_at IS NOT NULL AND deleted_at IS NULL';

/** Semua tulis multi-baris all-or-nothing (NFR-013). */
async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function createRepo(pool: Pool): Repo {
  return {
    async setOpeningBalance(account, amount) {
      return inTransaction(pool, async (client) => {
        await client.query(DISCARD_REDO_HISTORY);
        await client.query(
          "UPDATE transactions SET deleted_at = now() WHERE type = 'opening' AND account = $1 AND deleted_at IS NULL",
          [account],
        );
        const { rows } = await client.query<{ id: string }>(
          "INSERT INTO transactions (type, account, amount, description) VALUES ('opening', $1, $2, 'Saldo awal') RETURNING id",
          [account, amount],
        );
        return toSafeNumber(rows[0]!.id);
      });
    },

    async addExpenseOrIncome(account, type, amount, description) {
      return inTransaction(pool, async (client) => {
        await client.query(DISCARD_REDO_HISTORY);
        const { rows } = await client.query<{ id: string }>(
          'INSERT INTO transactions (type, account, amount, description) VALUES ($1, $2, $3, $4) RETURNING id',
          [type, account, amount, description],
        );
        return toSafeNumber(rows[0]!.id);
      });
    },

    async addTransfer(from, to, amount, description) {
      return inTransaction(pool, async (client) => {
        await client.query(DISCARD_REDO_HISTORY);
        const { rows } = await client.query<{ id: string }>(
          "INSERT INTO transactions (type, account, to_account, amount, description) VALUES ('transfer', $1, $2, $3, $4) RETURNING id",
          [from, to, amount, description],
        );
        return toSafeNumber(rows[0]!.id);
      });
    },

    async getBalances() {
      const { rows } = await pool.query<{ account: Account; balance: string }>(
        'SELECT account, CAST(SUM(money_in - money_out) AS BIGINT) AS balance FROM ledger_entries GROUP BY account',
      );
      const balances: Balances = { tunai: 0, bank: 0 };
      for (const row of rows) balances[row.account] = toSafeNumber(row.balance);
      return balances;
    },

    // Satu pernyataan = satu transaksi; tidak perlu `inTransaction` (NFR-013).
    async undoLast() {
      const { rows } = await pool.query<TransactionRow>(
        `UPDATE transactions
         SET undone_at = now()
         WHERE id = (
           SELECT id FROM transactions
           WHERE undone_at IS NULL AND deleted_at IS NULL
           ORDER BY id DESC
           LIMIT 1
         )
         RETURNING ${TX_COLUMNS}`,
      );
      return rows[0] ? toTransaction(rows[0]) : null;
    },

    async redoLast() {
      const { rows } = await pool.query<TransactionRow>(
        `UPDATE transactions
         SET undone_at = NULL
         WHERE id = (
           SELECT id FROM transactions
           WHERE undone_at IS NOT NULL AND deleted_at IS NULL
           ORDER BY id ASC
           LIMIT 1
         )
         RETURNING ${TX_COLUMNS}`,
      );
      return rows[0] ? toTransaction(rows[0]) : null;
    },

    async getHistory(limit) {
      const { rows } = await pool.query<HistoryRow>(
        `SELECT ${TX_COLUMNS}, occurred_at
         FROM transactions
         WHERE undone_at IS NULL AND deleted_at IS NULL
         ORDER BY occurred_at DESC, id DESC
         LIMIT $1`,
        [limit],
      );
      return rows.map((row): HistoryTransaction => ({ ...toTransaction(row), occurredAt: row.occurred_at }));
    },

    // Tanpa DISCARD_REDO_HISTORY: edit dan hapus tidak membuang Riwayat undo (FR-053).
    async editTransaction(id, description, amount, account) {
      const { rows } = await pool.query<TransactionRow>(
        `UPDATE transactions
         SET description = $2, amount = $3, account = COALESCE($4, account)
         WHERE id = $1 AND type IN ('expense', 'income') AND undone_at IS NULL AND deleted_at IS NULL
         RETURNING ${TX_COLUMNS}`,
        [id, description, amount, account],
      );
      return rows[0] ? toTransaction(rows[0]) : null;
    },

    async deleteTransaction(id) {
      const { rows } = await pool.query<TransactionRow>(
        `UPDATE transactions
         SET deleted_at = now()
         WHERE id = $1 AND undone_at IS NULL AND deleted_at IS NULL
         RETURNING ${TX_COLUMNS}`,
        [id],
      );
      return rows[0] ? toTransaction(rows[0]) : null;
    },

    async getSummary(utcStart, utcEnd) {
      const { rows } = await pool.query<SummaryRow>(
        `SELECT
           CAST(COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS BIGINT) AS income,
           CAST(COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS BIGINT) AS expense,
           CAST(COUNT(*) AS INTEGER) AS tx_count
         FROM transactions
         WHERE type IN ('expense', 'income')
           AND undone_at IS NULL AND deleted_at IS NULL
           AND occurred_at >= $1 AND occurred_at < $2`,
        [utcStart, utcEnd],
      );
      const row = rows[0]!;
      return { income: toSafeNumber(row.income), expense: toSafeNumber(row.expense), txCount: row.tx_count };
    },

    // Satu pernyataan = satu transaksi; tidak perlu `inTransaction` (NFR-013).
    async setBudget(amount, wibDate) {
      await pool.query(
        `INSERT INTO budgets (amount, effective_from)
         VALUES ($1, $2)
         ON CONFLICT (effective_from) DO UPDATE SET amount = EXCLUDED.amount`,
        [amount, wibDate],
      );
    },

    async getBudgetFor(wibDate) {
      const { rows } = await pool.query<{ amount: string }>(
        `SELECT amount
         FROM budgets
         WHERE effective_from <= $1
         ORDER BY effective_from DESC
         LIMIT 1`,
        [wibDate],
      );
      return rows[0] ? toSafeNumber(rows[0].amount) : null;
    },

    async getExpenseUsed(utcStart, utcEnd) {
      const { rows } = await pool.query<{ used: string }>(
        `SELECT CAST(COALESCE(SUM(amount), 0) AS BIGINT) AS used
         FROM transactions
         WHERE type = 'expense'
           AND undone_at IS NULL AND deleted_at IS NULL
           AND occurred_at >= $1 AND occurred_at < $2`,
        [utcStart, utcEnd],
      );
      return toSafeNumber(rows[0]!.used);
    },

    async getLedger(utcStart, utcEnd) {
      const { rows } = await pool.query<LedgerRow>(
        `WITH running AS (
           SELECT id, occurred_at, account, type, description, money_in, money_out, leg,
             CAST(SUM(money_in - money_out) OVER (
               PARTITION BY account
               ORDER BY (type = 'opening') DESC, occurred_at, id
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS BIGINT) AS account_balance,
             CAST(SUM(money_in - money_out) OVER (
               ORDER BY (type = 'opening') DESC, occurred_at, id
               RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS BIGINT) AS total_balance
           FROM ledger_entries
         )
         SELECT id, occurred_at, account, type, description, money_in, money_out, account_balance, total_balance
         FROM running
         -- Export bulanan: Saldo awal diwakili Baris pembuka periode, jangan digandakan (FR-095, FR-097).
         WHERE ($1::timestamptz IS NULL OR (type <> 'opening' AND occurred_at >= $1::timestamptz))
           AND ($2::timestamptz IS NULL OR occurred_at < $2::timestamptz)
         ORDER BY (type = 'opening') DESC, occurred_at, id, leg`,
        [utcStart, utcEnd],
      );
      return rows.map(toLedgerEntry);
    },

    async getCarryIn(utcStart) {
      const { rows } = await pool.query<{ account: Account; balance: string }>(
        // Saldo awal adalah baris nol: ikut terhitung walau ditetapkan setelah periode (FR-095, FR-097).
        `SELECT account, CAST(SUM(money_in - money_out) AS BIGINT) AS balance
         FROM ledger_entries
         WHERE type = 'opening' OR occurred_at < $1
         GROUP BY account`,
        [utcStart],
      );
      return rows.map((row) => ({ account: row.account, balance: toSafeNumber(row.balance) }));
    },
  };
}
