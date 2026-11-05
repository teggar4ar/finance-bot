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

/** Transaksi aktif plus waktu pencatatannya, untuk /riwayat (FR-060). */
export type HistoryTransaction = Transaction & { occurredAt: Date };

/** Isi Ringkasan satu rentang waktu; Net dihitung pemanggil (FR-070). */
export interface Summary {
  income: number;
  expense: number;
  txCount: number;
}

/** Satu Baris ledger siap ekspor; saldo berjalan sudah dihitung query (FR-092, FR-093). */
export interface LedgerEntry {
  id: number;
  occurredAt: Date;
  account: Account;
  type: 'opening' | 'expense' | 'income' | 'transfer';
  description: string;
  moneyIn: number;
  moneyOut: number;
  accountBalance: number;
  totalBalance: number;
}

/** Saldo akumulasi satu Akun sebelum periode export (FR-097). */
export interface CarryIn {
  account: Account;
  balance: number;
}

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
  /** Daftar Transaksi aktif, terbaru lebih dulu (FR-060). */
  getHistory(limit: number): Promise<HistoryTransaction[]>;
  /** Ubah Pengeluaran/Pemasukan aktif; `account` null = biarkan akun lama (FR-061, FR-065). */
  editTransaction(id: number, description: string, amount: number, account: Account | null): Promise<Transaction | null>;
  /** Hapus Transaksi aktif; `null` bila ID tidak ada atau sudah tidak aktif (FR-062, FR-063). */
  deleteTransaction(id: number): Promise<Transaction | null>;
  /** Total Pemasukan/Pengeluaran aktif pada rentang UTC `[utcStart, utcEnd)` (FR-070–FR-075). */
  getSummary(utcStart: Date, utcEnd: Date): Promise<Summary>;
  /** Tetapkan Budget harian mulai `wibDate` (`YYYY-MM-DD`); tanggal sama menimpa (FR-082, FR-083). */
  setBudget(amount: number, wibDate: string): Promise<void>;
  /** Budget yang berlaku pada `wibDate` (`YYYY-MM-DD`); `null` bila belum pernah ada (FR-081, FR-083). */
  getBudgetFor(wibDate: string): Promise<number | null>;
  /** Total Pengeluaran aktif pada rentang UTC `[utcStart, utcEnd)` (FR-084). */
  getExpenseUsed(utcStart: Date, utcEnd: Date): Promise<number>;
  /** Baris ledger aktif dengan saldo berjalan; `null` = seluruh riwayat (FR-090, FR-091). */
  getLedger(utcStart: Date | null, utcEnd: Date | null): Promise<LedgerEntry[]>;
  /** Saldo tiap Akun sebelum `utcStart`; Akun tanpa Baris ledger tidak muncul (FR-097). */
  getCarryIn(utcStart: Date): Promise<CarryIn[]>;
}

export function isAccount(value: string | undefined): value is Account {
  return value === 'tunai' || value === 'bank';
}