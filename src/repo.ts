/** Seam data-access: satu-satunya tempat SQL (NFR-051). */
export type Account = 'tunai' | 'bank';

export interface Balances {
  tunai: number;
  bank: number;
}

export interface Repo {
  /** Ganti Saldo awal akun, kembalikan ID transaksi baru (FR-011, FR-013). */
  setOpeningBalance(account: Account, amount: number): Promise<number>;
  /** Saldo aktif tiap Akun; akun tanpa transaksi = 0 (FR-020, FR-021). */
  getBalances(): Promise<Balances>;
}

export function isAccount(value: string | undefined): value is Account {
  return value === 'tunai' || value === 'bank';
}