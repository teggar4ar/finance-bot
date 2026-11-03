import type { Pool, PoolClient } from 'pg';
import type { Account, Balances, Repo } from '../repo';

/** `pg` mengembalikan BIGINT sebagai string (NFR-011). */
function toSafeNumber(value: string): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new Error(`nilai di luar rentang aman: ${value}`);
  return amount;
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
  };
}
