import { formatAmount, parseAmount } from './amount';
import type { Command } from './command';
import type { CsvFile } from './csv';
import { buildCsv } from './csv';
import type { Account, Balances, ExpenseOrIncome, HistoryTransaction, Repo, Transaction } from './repo';
import { isAccount } from './repo';
import { WIB_DAY_MS, WIB_OFFSET_MS, dayLabel, daysInMonth, pad, wibDate, wibDay, wibIsoDay, wibTimestamp } from './wib';

/**
 * Seam perilaku: Telegram → `execute` → balasan.
 * Hampir semua command menghasilkan teks; `/export` menghasilkan file CSV.
 * `deps` diisi dari luar supaya bisa diganti fake di tes.
 */
export interface Deps {
  now: () => Date;
  repo: Repo;
}

export type Reply = string | CsvFile;

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
const USAGE_EDIT = 'Format: /edit <id> <deskripsi> <nominal> [@bank|@tunai], contoh /edit 12 makan malam 30rb';
const USAGE_HAPUS = 'Format: /hapus <id>, contoh /hapus 12';
const USAGE_RINGKASAN =
  'Format: /ringkasan <tanggal|bulan>, contoh /ringkasan 2026-10-15 atau /ringkasan 2026-10';
const USAGE_BUDGET = 'Format: /budget <nominal>, contoh /budget 150rb';
const USAGE_EXPORT = 'Format: /export atau /export 2026-10, contoh /export 2026-10';

/** FR-086, A2: ambang peringatan lembut, satu konstanta supaya mudah diubah. */
const SOFT_WARNING_PERCENT = 80;

const HISTORY_LIMIT = 10;

/** Nama jenis yang tampil ke pengguna; satu tempat supaya balasan tidak berbeda kata. */
const TYPE_LABELS: Record<ExpenseOrIncome, string> = { expense: 'Pengeluaran', income: 'Pemasukan' };

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
  /** null = flag Akun tidak diberikan. */
  account: Account | null;
  amount: number;
  description: string;
}

/**
 * FR-033: Nominal adalah token terakhir sebelum flag Akun, sisanya deskripsi.
 * FR-032: tanpa flag, Akun = tunai. `/edit` mengirim null agar akun lama dipertahankan.
 */
function parseTransaction(args: string, defaultAccount: Account | null = 'tunai'): NewTransaction | null {
  const tokens = args.trim().split(/\s+/).filter(Boolean);

  let account = defaultAccount;
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

  const account = transaction.account ?? 'tunai';
  const id = await deps.repo.addExpenseOrIncome(account, type, transaction.amount, transaction.description);
  const balances = await deps.repo.getBalances();
  const label = TYPE_LABELS[type];
  const { amount, description } = transaction;
  const reply = `${label} ${description} ${formatAmount(amount)} (${account}) tercatat. ID ${id}. Saldo ${account}: ${formatAmount(balances[account])}.${balanceWarning([account], balances)}`;

  if (type !== 'expense') return reply;
  const usage = await budgetUsage(deps);
  return usage ? `${reply}\n${budgetLine(usage)}` : reply;
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

type Handler = (command: Command, deps: Deps) => Promise<Reply>;

/** FR-054: balasan menyebut Transaksi yang berubah dan saldo Akun yang terdampak. */
function transactionLabel(transaction: Transaction): string {
  const { type, account, amount, description } = transaction;
  if (type === 'transfer') return `${description} ${formatAmount(amount)}`;
  if (type === 'opening') return `Saldo awal ${account} ${formatAmount(amount)}`;
  return `${TYPE_LABELS[type]} ${description} ${formatAmount(amount)} (${account})`;
}

/** Akun yang saldonya tersentuh Transaksi ini. */
function affectedAccounts(transaction: Transaction): Account[] {
  return transaction.type === 'transfer' ? [transaction.account, transaction.toAccount] : [transaction.account];
}

async function undoOrRedo(action: 'undo' | 'redo', deps: Deps): Promise<string> {
  const transaction = action === 'undo' ? await deps.repo.undoLast() : await deps.repo.redoLast();
  if (!transaction) {
    return action === 'undo' ? 'Tidak ada transaksi yang bisa dibatalkan.' : 'Tidak ada transaksi yang bisa dipulihkan.';
  }

  const accounts = affectedAccounts(transaction);
  const balances = await deps.repo.getBalances();
  const verb = action === 'undo' ? 'Dibatalkan' : 'Dipulihkan';
  return `${verb}: ${transactionLabel(transaction)}, ID ${transaction.id}. ${saldoSummary(accounts, balances)}`;
}

function saldoSummary(accounts: readonly Account[], balances: Balances): string {
  return accounts.map((account) => `Saldo ${account}: ${formatAmount(balances[account])}.`).join(' ');
}

/** FR-060: Transfer tampil `bank -> tunai`, Saldo awal tampil `saldo awal`. */
function historyLine(transaction: HistoryTransaction): string {
  const head = `#${transaction.id} ${wibTimestamp(transaction.occurredAt)}`;
  if (transaction.type === 'opening') return `${head} saldo awal ${transaction.account} ${formatAmount(transaction.amount)}`;
  if (transaction.type === 'transfer') {
    return `${head} Transfer ${formatAmount(transaction.amount)} ${transaction.account} -> ${transaction.toAccount}`;
  }
  const label = TYPE_LABELS[transaction.type];
  return `${head} ${label} ${transaction.account} ${formatAmount(transaction.amount)} ${transaction.description}`;
}

async function history(deps: Deps): Promise<string> {
  const transactions = await deps.repo.getHistory(HISTORY_LIMIT);
  if (transactions.length === 0) return 'Belum ada transaksi.';
  return ['Riwayat transaksi terakhir:', ...transactions.map(historyLine)].join('\n');
}

interface Period {
  label: string;
  start: Date;
  end: Date;
}

/** Rentang UTC `[start, end)` untuk `days` hari WIB mulai `dayMs` (NFR-042). */
function period(label: string, dayMs: number, days: number): Period {
  return { label, start: new Date(dayMs - WIB_OFFSET_MS), end: new Date(dayMs + days * WIB_DAY_MS - WIB_OFFSET_MS) };
}

function todayPeriod(now: Date): Period {
  const { year, month, day } = wibDate(now);
  const dayMs = wibDay(year, month, day);
  return period(`hari ini (${dayLabel(dayMs)})`, dayMs, 1);
}

/** FR-071: minggu Senin sampai Minggu WIB. */
function weekPeriod(now: Date): Period {
  const { year, month, day } = wibDate(now);
  const today = wibDay(year, month, day);
  const sinceMonday = (new Date(today).getUTCDay() + 6) % 7;
  const start = today - sinceMonday * WIB_DAY_MS;
  return period(`minggu ini (${dayLabel(start)} - ${dayLabel(start + 6 * WIB_DAY_MS)})`, start, 7);
}

function monthPeriod(label: string, year: number, month: number): Period {
  return period(label, wibDay(year, month, 1), daysInMonth(year, month));
}

/** FR-072: bulan kalender WIB. */
function thisMonthPeriod(now: Date): Period {
  const { year, month } = wibDate(now);
  return monthPeriod(`bulan ini (${pad(month)}/${year})`, year, month);
}

/** FR-073: hanya `YYYY-MM-DD` atau `YYYY-MM`; tanggal mustahil seperti 31 Februari ditolak. */
function summaryPeriod(args: string): Period | null {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(args.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  // Date.UTC memetakan tahun 0–99 ke 19xx, jadi tahun dua digit ditolak.
  if (year < 100 || month < 1 || month > 12) return null;

  if (match[3] === undefined) return monthPeriod(`${pad(month)}/${year}`, year, month);

  const day = Number(match[3]);
  const dayMs = wibDay(year, month, day);
  const date = new Date(dayMs);
  if (date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return period(dayLabel(dayMs), dayMs, 1);
}

/** FR-070–FR-075: Net dihitung di sini, jumlah Transaksi datang dari query 6.5. */
async function summary(target: Period | null, deps: Deps): Promise<string> {
  if (!target) return USAGE_RINGKASAN;
  const { income, expense, txCount } = await deps.repo.getSummary(target.start, target.end);
  return [
    `Ringkasan ${target.label}:`,
    `Pemasukan: ${formatAmount(income)}`,
    `Pengeluaran: ${formatAmount(expense)}`,
    `Net: ${formatAmount(income - expense)}`,
    `Transaksi: ${txCount}`,
  ].join('\n');
}

interface BudgetUsage {
  budget: number;
  used: number;
}

/** FR-081/FR-084: pemakaian hari ini; `null` bila belum ada Budget (FR-088). */
async function budgetUsage(deps: Deps): Promise<BudgetUsage | null> {
  const now = deps.now();
  const budget = await deps.repo.getBudgetFor(wibIsoDay(now));
  if (budget === null) return null;
  const today = todayPeriod(now);
  return { budget, used: await deps.repo.getExpenseUsed(today.start, today.end) };
}

/** FR-085, FR-086: baris pemakaian di setiap konfirmasi Pengeluaran; tepat 100% masih lembut. */
function budgetLine({ budget, used }: BudgetUsage): string {
  const line = `Budget hari ini: ${formatAmount(used)} / ${formatAmount(budget)} (sisa ${formatAmount(budget - used)})`;
  // Dibagi dulu supaya perkaliannya tidak melewati batas bilangan aman di Nominal besar.
  if ((used / budget) * 100 < SOFT_WARNING_PERCENT) return line;

  const percent = Math.floor((used / budget) * 100);
  const over = used > budget ? ' — budget harian terlampaui' : '';
  return `${line} Peringatan: pemakaian budget hari ini ${percent}%${over}.`;
}

/** FR-081/FR-082: tanpa argumen menampilkan, dengan Nominal menetapkan mulai hari ini. */
async function dailyBudget(args: string, deps: Deps): Promise<string> {
  if (!args.trim()) {
    const usage = await budgetUsage(deps);
    if (!usage) return 'Belum ada budget harian. Tetapkan dengan /budget 150rb.';
    const left = usage.budget - usage.used;
    return [
      `Budget harian: ${formatAmount(usage.budget)}`,
      `Pemakaian hari ini: ${formatAmount(usage.used)}`,
      left < 0 ? `Kelebihan: ${formatAmount(-left)}` : `Sisa: ${formatAmount(left)}`,
    ].join('\n');
  }

  const amount = parseAmount(args);
  if (amount === null) return USAGE_BUDGET;
  const now = deps.now();
  await deps.repo.setBudget(amount, wibIsoDay(now));
  return `Budget harian ${formatAmount(amount)} berlaku ${todayPeriod(now).label}.`;
}

/** FR-090/FR-091: tanpa argumen seluruh data, `YYYY-MM` satu bulan. */
async function exportCsv(args: string, deps: Deps): Promise<CsvFile | string> {
  const arg = args.trim();
  if (!arg) return buildCsv(await deps.repo.getLedger(null, null));

  const match = /^(\d{4})-(\d{2})$/.exec(arg);
  if (!match) return USAGE_EXPORT;
  const year = Number(match[1]);
  const month = Number(match[2]);
  // Date.UTC memetakan tahun 0–99 ke 19xx, sama seperti summaryPeriod.
  if (year < 100 || month < 1 || month > 12) return USAGE_EXPORT;

  const target = monthPeriod(`${pad(month)}/${year}`, year, month);
  const entries = await deps.repo.getLedger(target.start, target.end);
  const carryIn = await deps.repo.getCarryIn(target.start);
  return buildCsv(entries, carryIn, target.start);
}

/** ID dari pengguna; hanya bilangan bulat positif (FR-061, FR-062). */
function parseId(token: string | undefined): number | null {
  if (!token || !/^\d+$/.test(token)) return null;
  const id = Number(token);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** FR-061/FR-065: hanya Pengeluaran dan Pemasukan yang bisa diedit. */
async function editTransaction(args: string, deps: Deps): Promise<string> {
  const [idToken, ...rest] = args.trim().split(/\s+/);
  const id = parseId(idToken);
  const transaction = parseTransaction(rest.join(' '), null);
  if (id === null || !transaction) return USAGE_EDIT;

  const edited = await deps.repo.editTransaction(id, transaction.description, transaction.amount, transaction.account);
  if (!edited) {
    return `Tidak bisa mengedit ID ${id}: Transaksi tidak ada, sudah Dihapus, atau bukan Pengeluaran/Pemasukan. ${USAGE_EDIT}`;
  }

  // Akun bisa berpindah, dan kita tidak tahu akun lama; tampilkan keduanya (FR-064).
  const accounts: Account[] = ['tunai', 'bank'];
  const balances = await deps.repo.getBalances();
  return `Diubah: ${transactionLabel(edited)}, ID ${edited.id}. ${saldoSummary(accounts, balances)}${balanceWarning(accounts, balances)}`;
}

/** FR-062: hapus berlaku untuk Transaksi aktif apa pun, tidak membuang Riwayat undo (FR-053). */
async function deleteTransaction(args: string, deps: Deps): Promise<string> {
  const [idToken, ...rest] = args.trim().split(/\s+/);
  const id = parseId(idToken);
  if (id === null || rest.length > 0) return USAGE_HAPUS;

  const deleted = await deps.repo.deleteTransaction(id);
  if (!deleted) return `Tidak ada Transaksi aktif dengan ID ${id}. ${USAGE_HAPUS}`;

  const accounts = affectedAccounts(deleted);
  const balances = await deps.repo.getBalances();
  return `Dihapus: ${transactionLabel(deleted)}, ID ${deleted.id}. ${saldoSummary(accounts, balances)}${balanceWarning(accounts, balances)}`;
}

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
  undo: async (_command, deps) => undoOrRedo('undo', deps),
  redo: async (_command, deps) => undoOrRedo('redo', deps),
  riwayat: async (_command, deps) => history(deps),
  edit: async (command, deps) => editTransaction(command.args, deps),
  hapus: async (command, deps) => deleteTransaction(command.args, deps),
  hari_ini: async (_command, deps) => summary(todayPeriod(deps.now()), deps),
  minggu_ini: async (_command, deps) => summary(weekPeriod(deps.now()), deps),
  bulan_ini: async (_command, deps) => summary(thisMonthPeriod(deps.now()), deps),
  ringkasan: async (command, deps) => summary(summaryPeriod(command.args), deps),
  budget: async (command, deps) => dailyBudget(command.args, deps),
  export: async (command, deps) => exportCsv(command.args, deps),
};

export async function execute(command: Command | null, deps: Deps): Promise<Reply> {
  if (!command) return HINT;
  const handler = handlers[ALIASES[command.name] ?? command.name];
  return handler ? handler(command, deps) : HINT;
}