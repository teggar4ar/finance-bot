/** Seam data-access: satu-satunya tempat SQL (NFR-051). */
export type Account = 'tunai' | 'bank';

export interface Balances {
  tunai: number;
  bank: number;
}

export type ExpenseOrIncome = 'expense' | 'income';

/** Satu baris Transaksi; dipakai /undo dan /redo untuk membalas apa yang berubah (FR-054). */
interface TransactionBase {
  id: number;
  account: Account;
  amount: number;
  description: string;
}

/** `chk_tx_transfer` menjamin hanya Transfer punya akun tujuan (ADR-0002). */
export type Transaction =
  | (TransactionBase & { type: 'opening' | ExpenseOrIncome; toAccount: null })
  | (TransactionBase & { type: 'transfer'; toAccount: Account });

export interface Repo {
  /** Ganti Saldo awal akun, kembalikan ID transaksi baru (FR-011, FR-013). */
  setOpeningBalance(account: Account, amount: number): Promise<number>;
  /** Catat Pengeluaran atau Pemasukan, kembalikan ID transaksi baru (FR-030, FR-031). */
  addExpenseOrIncome(account: Account, type: ExpenseOrIncome, amount: number, description: string): Promise<number>;
  /** Catat Transfer antar Akun, kembalikan ID transaksi baru (FR-036, FR-037). */
  addTransfer(from: Account, to: Account, amount: number, description: string): Promise<number>;
  /** Saldo aktif tiap Akun; akun tanpa transaksi = 0 (FR-020, FR-021). */
  getBalances(): Promise<Balances>;
  /** Batalkan Transaksi aktif terakhir; `null` bila tidak ada (FR-050, FR-051). */
  undoLast(): Promise<Transaction | null>;
  /** Pulihkan Transaksi yang terakhir Dibatalkan (LIFO); `null` bila tidak ada (FR-052). */
  redoLast(): Promise<Transaction | null>;
}

export function isAccount(value: string | undefined): value is Account {
  return value === 'tunai' || value === 'bank';
}