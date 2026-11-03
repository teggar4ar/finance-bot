import type { Pool } from 'pg';
import type { Account, Balances, Repo } from '../repo';

/** `pg` mengembalikan BIGINT sebagai string (NFR-011). */
function toSafeNumber(value: string): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new Error(`nilai di luar rentang aman: ${value}`);
  return amount;
}

export function createRepo(pool: Pool): Repo {
  return {
    async setOpeningBalance(account, amount) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'UPDATE transactions SET deleted_at = now() WHERE undone_at IS NOT NULL AND deleted_at IS NULL',
        );
        await client.query(
          "UPDATE transactions SET deleted_at = now() WHERE type = 'opening' AND account = $1 AND deleted_at IS NULL",
          [account],
        );
        const { rows } = await client.query<{ id: string }>(
          "INSERT INTO transactions (type, account, amount, description) VALUES ('opening', $1, $2, 'Saldo awal') RETURNING id",
          [account, amount],
        );
        await client.query('COMMIT');
        return toSafeNumber(rows[0]!.id);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
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