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

/** FR-100: per kategori; setiap command v1 tetap muncul dengan contoh singkat. */
export const HELP = [
  'Command yang tersedia',
  '',
  'Catat',
  '/saldo_awal tunai 200rb — tetapkan saldo awal satu akun',
  '/pengeluaran makan siang 25rb — catat pengeluaran dari tunai (alias /k)',
  '/pengeluaran spotify 55rb @bank — catat pengeluaran dari bank',
  '/pemasukan gaji 5jt @bank — catat pemasukan ke bank (alias /m)',
  '/transfer bank tunai 500rb — pindah uang antar akun',
  '',
  'Lihat',
  '/saldo — saldo tunai, bank, dan total',
  '/riwayat — 10 transaksi terakhir',
  '/hari_ini — ringkasan hari ini',
  '/minggu_ini — ringkasan minggu ini',
  '/bulan_ini — ringkasan bulan ini',
  '/ringkasan 2026-10-15 — ringkasan satu tanggal',
  '/ringkasan 2026-10 — ringkasan satu bulan',
  '',
  'Ubah',
  '/undo — batalkan transaksi terakhir',
  '/redo — pulihkan transaksi terakhir',
  '/edit 12 makan malam 30rb — ubah transaksi',
  '/hapus 12 — hapus transaksi',
  '',
  'Budget dan export',
  '/budget — lihat budget harian',
  '/budget 150rb — tetapkan budget harian',
  '/export — ekspor semua transaksi ke CSV',
  '/export 2026-10 — ekspor satu bulan',
  '',
  '/help — daftar command ini',
  '/start — daftar command ini',
].join('\n');

export const HINT = ['Command tidak dikenal.', 'Ketik /help untuk daftar command.'].join('\n');

const usage = (format: string, example: string) => ['Format: ' + format, 'Contoh: ' + example].join('\n');

const USAGE_SALDO_AWAL = usage('/saldo_awal <tunai|bank> <nominal>', '/saldo_awal tunai 200rb');
const USAGE_PENGELUARAN = usage(
  '/pengeluaran <deskripsi> <nominal> [@bank|@tunai]',
  '/pengeluaran makan siang 25rb',
);
const USAGE_PEMASUKAN = usage(
  '/pemasukan <deskripsi> <nominal> [@bank|@tunai]',
  '/pemasukan gaji 5jt @bank',
);
const USAGE_TRANSFER = usage('/transfer <dari> <ke> <nominal>', '/transfer bank tunai 500rb');
const USAGE_EDIT = usage('/edit <id> <deskripsi> <nominal> [@bank|@tunai]', '/edit 12 makan malam 30rb');
const USAGE_HAPUS = usage('/hapus <id>', '/hapus 12');
const USAGE_RINGKASAN = usage('/ringkasan <tanggal|bulan>', '/ringkasan 2026-10-15 atau /ringkasan 2026-10');
const USAGE_BUDGET = usage('/budget <nominal>', '/budget 150rb');
const USAGE_EXPORT = usage('/export [YYYY-MM]', '/export 2026-10');

/** FR-086, A2: ambang peringatan lembut, satu konstanta supaya mudah diubah. */
const SOFT_WARNING_PERCENT = 80;

const HISTORY_LIMIT = 10;

/** Nama jenis yang tampil ke pengguna; satu tempat supaya balasan tidak berbeda kata. */
const TYPE_LABELS: Record<ExpenseOrIncome, string> = { expense: 'Pengeluaran', income: 'Pemasukan' };
const TYPE_EMOJI: Record<ExpenseOrIncome, string> = { expense: '💸', income: '📥' };
const TRANSFER_EMOJI = '🔁';

/** Pemisah antar bagian di satu baris detail. */
const SEP = ' · ';

/** Baris detail Transfer; satu tempat untuk konfirmasi dan `/undo`/`/redo` transaksi transfer. */
function transferDetail(description: string, amount: number): string {
  return `${TRANSFER_EMOJI} ${description}${SEP}${formatAmount(amount)}`;
}

/** Balasan multi-baris; baris `null` (mis. peringatan yang tidak berlaku) dibuang. */
function replyLines(...lines: (string | null)[]): string {
  return lines.filter((line): line is string => line !== null).join('\n');
}

/** FR-022: peringatan selalu baris sendiri dengan penanda ⚠️; `null` bila tidak ada saldo negatif. */
function negativeWarning(accounts: readonly Account[], balances: Balances): string | null {
  const negative = accounts.filter((account) => balances[account] < 0);
  return negative.length > 0 ? `⚠️ Peringatan: saldo ${negative.join(' dan ')} negatif.` : null;
}

/** NFR-062: saldo Akun yang tersentuh, plus peringatan bila ada yang negatif. */
function balanceLines(accounts: readonly Account[], balances: Balances): (string | null)[] {
  return [
    ...accounts.map((account) => `Saldo ${account}: ${formatAmount(balances[account])}`),
    negativeWarning(accounts, balances),
  ];
}

function saldoText(balances: Balances): string {
  return replyLines(
    `Saldo tunai: ${formatAmount(balances.tunai)}`,
    `Saldo bank: ${formatAmount(balances.bank)}`,
    `Total: ${formatAmount(balances.tunai + balances.bank)}`,
    negativeWarning(['tunai', 'bank'], balances),
  );
}

async function setOpeningBalance(args: string, deps: Deps): Promise<string> {
  const [account, ...rest] = args.trim().split(/\s+/);
  const amount = parseAmount(rest.join(' '));
  if (!isAccount(account) || amount === null) return USAGE_SALDO_AWAL;

  const id = await deps.repo.setOpeningBalance(account, amount);
  const balances = await deps.repo.getBalances();
  return replyLines(
    '✅ Saldo awal tercatat',
    `${account}${SEP}${formatAmount(amount)}`,
    `ID ${id}`,
    ...balanceLines([account], balances),
  );
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
  const { amount, description } = transaction;
  const lines = [
    `✅ ${TYPE_LABELS[type]} tercatat`,
    `${description}${SEP}${formatAmount(amount)}${SEP}${account}`,
    `ID ${id}`,
    ...balanceLines([account], balances),
  ];

  if (type !== 'expense') return replyLines(...lines);
  const usage = await budgetUsage(deps);
  return replyLines(...lines, ...(usage ? budgetLines(usage) : []));
}

/** FR-036: urutan argumen <from> <to> <amount>, tanpa deskripsi dari pengguna. */
async function recordTransfer(args: string, deps: Deps): Promise<string> {
  const [from, to, ...rest] = args.trim().split(/\s+/);
  const amount = parseAmount(rest.join(' '));
  if (!isAccount(from) || !isAccount(to) || amount === null) return USAGE_TRANSFER;
  if (from === to) return replyLines('Tidak bisa transfer ke akun yang sama.', USAGE_TRANSFER);

  const description = `Transfer ${from} ke ${to}`;
  const id = await deps.repo.addTransfer(from, to, amount, description);
  const balances = await deps.repo.getBalances();
  return replyLines(
    '✅ Transfer tercatat',
    transferDetail(description, amount),
    `ID ${id}`,
    ...balanceLines([from, to], balances),
  );
}

type Handler = (command: Command, deps: Deps) => Promise<Reply>;

/** FR-054: balasan menyebut Transaksi yang berubah dan saldo Akun yang terdampak. */
function transactionLabel(transaction: Transaction): string {
  const { type, account, amount, description } = transaction;
  if (type === 'transfer') return transferDetail(description, amount);
  if (type === 'opening') return `Saldo awal ${account}${SEP}${formatAmount(amount)}`;
  return `${TYPE_EMOJI[type]} ${TYPE_LABELS[type]} ${description}${SEP}${formatAmount(amount)}${SEP}${account}`;
}

/** Akun yang saldonya tersentuh Transaksi ini. */
function affectedAccounts(transaction: Transaction): Account[] {
  return transaction.type === 'transfer' ? [transaction.account, transaction.toAccount] : [transaction.account];
}

async function undoOrRedo(action: 'undo' | 'redo', deps: Deps): Promise<string> {
  const transaction = action === 'undo' ? await deps.repo.undoLast() : await deps.repo.redoLast();
  if (!transaction) {
    return action === 'undo'
      ? replyLines('Tidak ada transaksi yang bisa dibatalkan.', 'Lihat /riwayat untuk transaksi aktif.')
      : replyLines('Tidak ada transaksi yang bisa dipulihkan.', 'Lihat /riwayat untuk transaksi aktif.');
  }

  const accounts = affectedAccounts(transaction);
  const balances = await deps.repo.getBalances();
  return replyLines(
    action === 'undo' ? '✅ Transaksi dibatalkan' : '✅ Transaksi dipulihkan',
    transactionLabel(transaction),
    `ID ${transaction.id}`,
    ...balanceLines(accounts, balances),
  );
}

/** FR-060: Transfer tampil `bank -> tunai`, Saldo awal tampil `Saldo awal`. */
function historyLine(transaction: HistoryTransaction): string {
  const head = `#${transaction.id} ${wibTimestamp(transaction.occurredAt)}`;
  if (transaction.type === 'opening') {
    return `${head}${SEP}Saldo awal ${transaction.account}${SEP}${formatAmount(transaction.amount)}`;
  }
  if (transaction.type === 'transfer') {
    return `${head}${SEP}${TRANSFER_EMOJI} Transfer ${transaction.account} -> ${transaction.toAccount}${SEP}${formatAmount(transaction.amount)}`;
  }
  const label = TYPE_LABELS[transaction.type];
  return `${head}${SEP}${TYPE_EMOJI[transaction.type]} ${label}${SEP}${transaction.description}${SEP}${formatAmount(transaction.amount)}${SEP}${transaction.account}`;
}

async function history(deps: Deps): Promise<string> {
  const transactions = await deps.repo.getHistory(HISTORY_LIMIT);
  if (transactions.length === 0) {
    return replyLines('Belum ada transaksi.', 'Catat dengan /pengeluaran atau /pemasukan.');
  }
  return ['Riwayat transaksi terakhir:', ...transactions.map(historyLine)].join('\n');
}

interface Period {
  label: string;
  start: Date;
  end: Date;
  /** Diisi hanya untuk ringkasan bulanan; hari melewati budget hanya masuk akal per bulan (FR-076). */
  month: { year: number; month: number } | null;
}

/** Rentang UTC `[start, end)` untuk `days` hari WIB mulai `dayMs` (NFR-042). */
function period(label: string, dayMs: number, days: number, month: Period['month'] = null): Period {
  return {
    label,
    start: new Date(dayMs - WIB_OFFSET_MS),
    end: new Date(dayMs + days * WIB_DAY_MS - WIB_OFFSET_MS),
    month,
  };
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
  return period(label, wibDay(year, month, 1), daysInMonth(year, month), { year, month });
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
  const lines = [
    `Ringkasan ${target.label}:`,
    `Pemasukan: ${formatAmount(income)}`,
    `Pengeluaran: ${formatAmount(expense)}`,
    `Net: ${formatAmount(income - expense)}`,
    `Transaksi: ${txCount}`,
  ];

  if (target.month) {
    const over = await daysOverBudget(target, deps);
    // FR-076: baris hanya bila ada hari yang lewat; `0` saat Budget baru berlaku sebagian bulan tidak berguna.
    if (over !== null && over > 0) lines.push(`Hari melewati budget: ${over}`);
  }

  return lines.join('\n');
}

/**
 * FR-076: jumlah hari WIB dalam bulan yang Pengeluarannya melewati Budget yang berlaku hari itu.
 * `null` bila belum ada Budget sama sekali; hari tanpa Pengeluaran tidak mungkin melewati Budget (amount > 0).
 */
async function daysOverBudget(target: Period, deps: Deps): Promise<number | null> {
  // Pemanggil hanya masuk saat target.month terisi (ringkasan bulanan), jadi bulan dijamin ada.
  const { year, month } = target.month!;
  const end = `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
  const budgets = await deps.repo.getBudgetsUpTo(end);
  if (budgets.length === 0) return null;

  const usedPerDay = new Map<string, number>();
  for (const { occurredAt, amount } of await deps.repo.getExpensesInRange(target.start, target.end)) {
    const day = wibIsoDay(occurredAt);
    usedPerDay.set(day, (usedPerDay.get(day) ?? 0) + amount);
  }

  let days = 0;
  for (const [day, used] of usedPerDay) {
    // Budget urut tanggal naik, jadi yang terakhir cocok adalah yang berlaku pada hari itu.
    let budget: number | null = null;
    for (const row of budgets) if (row.effectiveFrom <= day) budget = row.amount;
    if (budget !== null && used > budget) days += 1;
  }
  return days;
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

/** FR-085: satu jalur untuk baris `Sisa:`/`Kelebihan:` — dipakai `/budget` dan konfirmasi Pengeluaran. */
function remainingLine(left: number): string {
  return left < 0 ? `Kelebihan: ${formatAmount(-left)}` : `Sisa: ${formatAmount(left)}`;
}

/** FR-085, FR-086: pemakaian di setiap konfirmasi Pengeluaran; tepat 100% masih lembut. */
function budgetLines({ budget, used }: BudgetUsage): string[] {
  const left = budget - used;
  const lines = [`Budget hari ini: ${formatAmount(used)} / ${formatAmount(budget)}`, remainingLine(left)];
  // Dibagi dulu supaya perkaliannya tidak melewati batas bilangan aman di Nominal besar.
  if ((used / budget) * 100 < SOFT_WARNING_PERCENT) return lines;

  const percent = Math.floor((used / budget) * 100);
  const over = used > budget ? ', budget harian terlampaui' : '';
  lines.push(`⚠️ Peringatan: pemakaian budget hari ini ${percent}%${over}.`);
  return lines;
}

/** FR-081/FR-082: tanpa argumen menampilkan, dengan Nominal menetapkan mulai hari ini. */
async function dailyBudget(args: string, deps: Deps): Promise<string> {
  if (!args.trim()) {
    const usage = await budgetUsage(deps);
    if (!usage) return replyLines('Belum ada budget harian.', 'Tetapkan dengan /budget 150rb.');
    const left = usage.budget - usage.used;
    return replyLines(
      `Budget harian: ${formatAmount(usage.budget)}`,
      `Pemakaian hari ini: ${formatAmount(usage.used)}`,
      remainingLine(left),
    );
  }

  const amount = parseAmount(args);
  if (amount === null) return USAGE_BUDGET;
  const now = deps.now();
  await deps.repo.setBudget(amount, wibIsoDay(now));
  return replyLines('✅ Budget harian ditetapkan', `${formatAmount(amount)}${SEP}berlaku ${todayPeriod(now).label}`);
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
    return replyLines(
      `Tidak bisa mengedit ID ${id}: Transaksi tidak ada, sudah Dihapus, atau bukan Pengeluaran/Pemasukan.`,
      USAGE_EDIT,
    );
  }

  // Akun bisa berpindah, dan kita tidak tahu akun lama; tampilkan keduanya (FR-064).
  const accounts: Account[] = ['tunai', 'bank'];
  const balances = await deps.repo.getBalances();
  return replyLines('✅ Transaksi diubah', transactionLabel(edited), `ID ${edited.id}`, ...balanceLines(accounts, balances));
}

/** FR-062: hapus berlaku untuk Transaksi aktif apa pun, tidak membuang Riwayat undo (FR-053). */
async function deleteTransaction(args: string, deps: Deps): Promise<string> {
  const [idToken, ...rest] = args.trim().split(/\s+/);
  const id = parseId(idToken);
  if (id === null || rest.length > 0) return USAGE_HAPUS;

  const deleted = await deps.repo.deleteTransaction(id);
  if (!deleted) return replyLines(`Tidak ada Transaksi aktif dengan ID ${id}.`, USAGE_HAPUS);

  const accounts = affectedAccounts(deleted);
  const balances = await deps.repo.getBalances();
  return replyLines('✅ Transaksi dihapus', transactionLabel(deleted), `ID ${deleted.id}`, ...balanceLines(accounts, balances));
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