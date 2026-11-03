import { formatAmount, parseAmount } from './amount';
import type { Command } from './command';
import type { Account, Balances, ExpenseOrIncome, Repo } from './repo';
import { isAccount } from './repo';

/**
 * Seam perilaku: Telegram → `execute` → teks balasan.
 * `deps` diisi dari luar supaya bisa diganti fake di tes.
 */
export interface Deps {
  now: () => Date;
  repo: Repo;
}

export const HELP = [
  'Command yang tersedia:',
  '',
  '/saldo — saldo tunai, bank, dan total',
  '/saldo_awal tunai 200rb — tetapkan saldo awal satu akun',
  '/pengeluaran makan siang 25rb — catat pengeluaran, default tunai (alias /k)',
  '/pengeluaran spotify 55rb @bank — pengeluaran dari bank',
  '/pemasukan gaji 5jt @bank — catat pemasukan (alias /m)',
  '/transfer bank tunai 500rb — pindah uang antar akun',
  '/undo atau /redo — batalkan atau pulihkan transaksi terakhir',
  '/riwayat — 10 transaksi terakhir',
  '/edit 12 makan malam 30rb — ubah transaksi',
  '/hapus 12 — hapus transaksi',
  '/hari_ini, /minggu_ini, /bulan_ini — ringkasan',
  '/ringkasan 2026-10-15 atau /ringkasan 2026-10 — ringkasan tanggal atau bulan',
  '/budget atau /budget 150rb — lihat atau ubah budget harian',
  '/export atau /export 2026-10 — ekspor CSV',
  '/help — daftar command ini',
].join('\n');

export const HINT = 'Command tidak dikenal. Kirim /help untuk daftar command.';

const USAGE_SALDO_AWAL = 'Format: /saldo_awal <tunai|bank> <nominal>, contoh /saldo_awal tunai 200rb';
const USAGE_PENGELUARAN =
  'Format: /pengeluaran <deskripsi> <nominal> [@bank|@tunai], contoh /pengeluaran makan siang 25rb';
const USAGE_PEMASUKAN =
  'Format: /pemasukan <deskripsi> <nominal> [@bank|@tunai], contoh /pemasukan gaji 5jt @bank';
const USAGE_TRANSFER = 'Format: /transfer <dari> <ke> <nominal>, contoh /transfer bank tunai 500rb';

function negativeWarning(negative: readonly Account[]): string {
  return negative.length > 0 ? `Peringatan: saldo ${negative.join(' dan ')} negatif.` : '';
}

/** FR-022: peringatan bila tulisan meninggalkan saldo Akun negatif. */
function balanceWarning(accounts: readonly Account[], balances: Balances): string {
  const negative = accounts.filter((account) => balances[account] < 0);
  return negative.length > 0 ? ` ${negativeWarning(negative)}` : '';
}

function saldoText(balances: Balances): string {
  const lines = [
    `Saldo tunai: ${formatAmount(balances.tunai)}`,
    `Saldo bank: ${formatAmount(balances.bank)}`,
    `Total: ${formatAmount(balances.tunai + balances.bank)}`,
  ];
  const warning = negativeWarning((['tunai', 'bank'] as const).filter((account) => balances[account] < 0));
  if (warning) lines.push(warning);
  return lines.join('\n');
}

async function setOpeningBalance(args: string, deps: Deps): Promise<string> {
  const [account, ...rest] = args.trim().split(/\s+/);
  const amount = parseAmount(rest.join(' '));
  if (!isAccount(account) || amount === null) return USAGE_SALDO_AWAL;

  const id = await deps.repo.setOpeningBalance(account, amount);
  const balances = await deps.repo.getBalances();
  return `Saldo awal ${account} ${formatAmount(amount)} dicatat. ID ${id}. Saldo ${account}: ${formatAmount(balances[account])}.${balanceWarning([account], balances)}`;
}

interface NewTransaction {
  account: Account;
  amount: number;
  description: string;
}

/**
 * FR-033: Nominal adalah token terakhir sebelum flag Akun, sisanya deskripsi.
 * FR-032: tanpa flag, Akun = tunai.
 */
function parseTransaction(args: string): NewTransaction | null {
  const tokens = args.trim().split(/\s+/).filter(Boolean);

  let account: Account = 'tunai';
  const flag = tokens.at(-1);
  if (flag?.startsWith('@')) {
    const name = flag.slice(1).toLowerCase();
    if (!isAccount(name)) return null;
    account = name;
    tokens.pop();
  }
  if (tokens.some((token) => token.startsWith('@'))) return null;

  const amount = parseAmount(tokens.pop() ?? '');
  // "Rp 25.000" terpecah dua token; sisanya jangan ikut jadi deskripsi (FR-034).
  const description = tokens.join(' ').replace(/\s*\brp$/i, '');
  if (amount === null || !description) return null;

  return { account, amount, description };
}

async function recordTransaction(args: string, type: ExpenseOrIncome, deps: Deps): Promise<string> {
  const transaction = parseTransaction(args);
  if (!transaction) return type === 'expense' ? USAGE_PENGELUARAN : USAGE_PEMASUKAN;

  const id = await deps.repo.addExpenseOrIncome(
    transaction.account,
    type,
    transaction.amount,
    transaction.description,
  );
  const balances = await deps.repo.getBalances();
  const label = type === 'expense' ? 'Pengeluaran' : 'Pemasukan';
  const { account, amount, description } = transaction;
  return `${label} ${description} ${formatAmount(amount)} (${account}) tercatat. ID ${id}. Saldo ${account}: ${formatAmount(balances[account])}.${balanceWarning([account], balances)}`;
}

/** FR-036: urutan argumen <from> <to> <amount>, tanpa deskripsi dari pengguna. */
async function recordTransfer(args: string, deps: Deps): Promise<string> {
  const [from, to, ...rest] = args.trim().split(/\s+/);
  const amount = parseAmount(rest.join(' '));
  if (!isAccount(from) || !isAccount(to) || amount === null) return USAGE_TRANSFER;
  if (from === to) return `Tidak bisa transfer ke akun yang sama. ${USAGE_TRANSFER}`;

  const description = `Transfer ${from} ke ${to}`;
  const id = await deps.repo.addTransfer(from, to, amount, description);
  const balances = await deps.repo.getBalances();
  return `${description} ${formatAmount(amount)} tercatat. ID ${id}. Saldo ${from}: ${formatAmount(balances[from])}. Saldo ${to}: ${formatAmount(balances[to])}.${balanceWarning([from, to], balances)}`;
}

type Handler = (command: Command, deps: Deps) => Promise<string>;

/** ADR-0004: /k dan /m nama lain dari handler yang sudah ada, bukan jalur terpisah. */
const ALIASES: Record<string, string> = { k: 'pengeluaran', m: 'pemasukan' };

const handlers: Record<string, Handler> = {
  help: async () => HELP,
  start: async () => HELP,
  saldo: async (_command, deps) => saldoText(await deps.repo.getBalances()),
  saldo_awal: async (command, deps) => setOpeningBalance(command.args, deps),
  pengeluaran: async (command, deps) => recordTransaction(command.args, 'expense', deps),
  pemasukan: async (command, deps) => recordTransaction(command.args, 'income', deps),
  transfer: async (command, deps) => recordTransfer(command.args, deps),
};

export async function execute(command: Command | null, deps: Deps): Promise<string> {
  if (!command) return HINT;
  const handler = handlers[ALIASES[command.name] ?? command.name];
  return handler ? handler(command, deps) : HINT;
}