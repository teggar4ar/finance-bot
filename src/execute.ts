import { formatAmount, parseAmount } from './amount';
import type { Command } from './command';
import type { CsvFile } from './csv';
import { buildCsv } from './csv';
import { type Period, monthPeriod, summaryPeriod, thisMonthPeriod, todayPeriod, weekPeriod } from './period';
import { bold, code, esc, warning } from './reply';
import type { Account, Balances, ExpenseOrIncome, HistoryTransaction, Repo, Transaction } from './repo';
import { isAccount } from './repo';
import {
  HELP,
  HINT,
  TRANSFER_EMOJI,
  TYPE_EMOJI,
  TYPE_LABELS,
  USAGE_BUDGET,
  USAGE_EDIT,
  USAGE_EXPORT,
  USAGE_HAPUS,
  USAGE_PEMASUKAN,
  USAGE_PENGELUARAN,
  USAGE_RINGKASAN,
  USAGE_SALDO_AWAL,
  USAGE_TRANSFER,
} from './text';
import { daysInMonth, pad, wibIsoDay, wibTimestamp } from './wib';

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

/** FR-086, A2: ambang peringatan lembut, satu konstanta supaya mudah diubah. */
const SOFT_WARNING_PERCENT = 80;

const HISTORY_LIMIT = 10;

/** Balasan multi-baris dalam satu blok; baris `null` (mis. peringatan yang tidak berlaku) dibuang. */
function replyLines(...lines: (string | null)[]): string {
  return lines.filter((line): line is string => line !== null).join('\n');
}

/** Balasan berblok: tiap blok dipisah satu baris kosong; blok kosong dibuang. */
function blocks(...parts: (string | null)[]): string {
  return parts.filter((part): part is string => !!part).join('\n\n');
}

/** FR-022: `null` bila tidak ada saldo negatif; tanpa kata "Peringatan" (R5). */
function negativeWarning(accounts: readonly Account[], balances: Balances): string | null {
  const negative = accounts.filter((account) => balances[account] < 0);
  return negative.length > 0 ? warning(`Saldo ${negative.join(' dan ')} negatif.`) : null;
}

/** NFR-062: satu baris per Akun yang tersentuh Transaksi. */
function balanceBlock(accounts: readonly Account[], balances: Balances): string {
  return accounts.map((account) => `Saldo ${account}: ${code(formatAmount(balances[account]))}`).join('\n');
}

/** Baris ID Transaksi pada kartu; ID tepat di atas baris deskripsi (R3). */
function idLine(id: number): string {
  return `ID: ${code(String(id))}`;
}

/** Baris Nominal pada kartu; satu tempat supaya label seragam di semua command. */
function nominalLine(amount: number): string {
  return `Nominal: ${code(formatAmount(amount))}`;
}

/** Baris Akun pada kartu; satu tempat supaya label seragam di semua command. */
function accountLine(account: Account): string {
  return `Akun: ${account}`;
}

function saldoText(balances: Balances): string {
  return blocks(
    '💰 <b>Saldo</b>',
    replyLines(
      `Tunai: ${code(formatAmount(balances.tunai))}`,
      `Bank: ${code(formatAmount(balances.bank))}`,
      `Total: ${bold(code(formatAmount(balances.tunai + balances.bank)))}`,
    ),
    negativeWarning(['tunai', 'bank'], balances),
  );
}

async function setOpeningBalance(args: string, deps: Deps): Promise<string> {
  const [account, ...rest] = args.trim().split(/\s+/);
  const amount = parseAmount(rest.join(' '));
  if (!isAccount(account) || amount === null) return USAGE_SALDO_AWAL;

  const id = await deps.repo.setOpeningBalance(account, amount);
  const balances = await deps.repo.getBalances();
  return blocks(
    '✅ <b>Saldo awal tercatat</b>',
    replyLines(idLine(id), accountLine(account), nominalLine(amount)),
    balanceBlock([account], balances),
    negativeWarning([account], balances),
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

/** FR-038: kartu konfirmasi — deskripsi tepat di bawah ID, Nominal/Akun menempel. */
async function recordTransaction(args: string, type: ExpenseOrIncome, deps: Deps): Promise<string> {
  const transaction = parseTransaction(args);
  if (!transaction) return type === 'expense' ? USAGE_PENGELUARAN : USAGE_PEMASUKAN;

  const account = transaction.account ?? 'tunai';
  const { amount, description } = transaction;
  const id = await deps.repo.addExpenseOrIncome(account, type, amount, description);
  const balances = await deps.repo.getBalances();
  const usage = type === 'expense' ? await budgetUsage(deps) : null;

  return blocks(
    `✅ <b>${TYPE_LABELS[type]} tercatat</b>`,
    replyLines(
      idLine(id),
      esc(description),
      nominalLine(amount),
      accountLine(account),
    ),
    balanceBlock([account], balances),
    usage ? budgetBlock(usage) : null,
    // Peringatan selalu di akhir, digabung: negatif dulu, lalu budget.
    replyLines(negativeWarning([account], balances), usage ? budgetWarning(usage) : null),
  );
}

/** FR-036: urutan argumen <from> <to> <amount>, tanpa deskripsi dari pengguna. */
async function recordTransfer(args: string, deps: Deps): Promise<string> {
  const [from, to, ...rest] = args.trim().split(/\s+/);
  const amount = parseAmount(rest.join(' '));
  if (!isAccount(from) || !isAccount(to) || amount === null) return USAGE_TRANSFER;
  if (from === to) return blocks('⚠️ <b>Tidak bisa transfer ke akun yang sama.</b>', USAGE_TRANSFER);

  const description = `Transfer ${from} ke ${to}`;
  const id = await deps.repo.addTransfer(from, to, amount, description);
  const balances = await deps.repo.getBalances();
  return blocks(
    '✅ <b>Transfer tercatat</b>',
    replyLines(idLine(id), `Arah: ${from} ke ${to}`, nominalLine(amount)),
    balanceBlock([from, to], balances),
    negativeWarning([from, to], balances),
  );
}

type Handler = (command: Command, deps: Deps) => Promise<Reply>;

/** FR-054: baris identitas Transaksi pada kartu perubahan (undo/redo/edit/hapus). */
function transactionCard(transaction: Transaction): string[] {
  const { type, account, amount, description } = transaction;
  const nominal = nominalLine(amount);
  if (type === 'transfer') return [`Arah: ${account} ke ${transaction.toAccount}`, nominal];
  if (type === 'opening') return [`Saldo awal ${account}`, nominal];
  return [`${TYPE_LABELS[type]}: ${esc(description)}`, nominal, accountLine(account)];
}

/** Akun yang saldonya tersentuh Transaksi ini. */
function affectedAccounts(transaction: Transaction): Account[] {
  return transaction.type === 'transfer' ? [transaction.account, transaction.toAccount] : [transaction.account];
}

async function undoOrRedo(action: 'undo' | 'redo', deps: Deps): Promise<string> {
  const transaction = action === 'undo' ? await deps.repo.undoLast() : await deps.repo.redoLast();
  if (!transaction) {
    const what = action === 'undo' ? 'dibatalkan' : 'dipulihkan';
    return blocks(`<b>Tidak ada transaksi yang bisa ${what}.</b>`, 'Lihat /riwayat untuk transaksi aktif.');
  }

  const accounts = affectedAccounts(transaction);
  const balances = await deps.repo.getBalances();
  return blocks(
    action === 'undo' ? '✅ <b>Transaksi dibatalkan</b>' : '✅ <b>Transaksi dipulihkan</b>',
    replyLines(idLine(transaction.id), ...transactionCard(transaction)),
    balanceBlock(accounts, balances),
    negativeWarning(accounts, balances),
  );
}

/** FR-060: Transfer tampil `bank -> tunai`, Saldo awal tampil `Saldo awal`. */
function historyLine(transaction: HistoryTransaction): string {
  const head = `${code(`#${transaction.id}`)} ${wibTimestamp(transaction.occurredAt)}`;
  const amount = code(formatAmount(transaction.amount));
  if (transaction.type === 'opening') {
    return `${head} · Saldo awal ${transaction.account} · ${amount}`;
  }
  if (transaction.type === 'transfer') {
    return `${head} · ${TRANSFER_EMOJI} Transfer ${transaction.account} -&gt; ${transaction.toAccount} · ${amount}`;
  }
  const label = TYPE_LABELS[transaction.type];
  return `${head} · ${TYPE_EMOJI[transaction.type]} ${label} · ${esc(transaction.description)} · ${amount} · ${transaction.account}`;
}

async function history(deps: Deps): Promise<string> {
  const transactions = await deps.repo.getHistory(HISTORY_LIMIT);
  if (transactions.length === 0) {
    return blocks('Belum ada transaksi.', 'Catat dengan /pengeluaran atau /pemasukan.');
  }
  return blocks('🕒 <b>Riwayat transaksi terakhir</b>', transactions.map(historyLine).join('\n'));
}

/** FR-070–FR-075: Net dihitung di sini, jumlah Transaksi datang dari query 6.5. */
async function summary(target: Period | null, deps: Deps): Promise<string> {
  if (!target) return USAGE_RINGKASAN;
  const { income, expense, txCount } = await deps.repo.getSummary(target.start, target.end);
  const counts: string[] = [`Transaksi: ${code(String(txCount))}`];

  if (target.month) {
    const over = await daysOverBudget(target, deps);
    // FR-076: baris hanya bila ada hari yang lewat; `0` saat Budget baru berlaku sebagian bulan tidak berguna.
    if (over !== null && over > 0) counts.push(`Hari melewati budget: ${code(String(over))}`);
  }

  return blocks(
    `📊 <b>Ringkasan ${target.label}</b>`,
    replyLines(
      `${TYPE_LABELS.income}: ${code(formatAmount(income))}`,
      `${TYPE_LABELS.expense}: ${code(formatAmount(expense))}`,
      `Net: ${bold(code(formatAmount(income - expense)))}`,
    ),
    replyLines(...counts),
  );
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
  return left < 0 ? `Kelebihan: ${code(formatAmount(-left))}` : `Sisa: ${code(formatAmount(left))}`;
}

/** FR-085: blok pemakaian budget pada konfirmasi Pengeluaran. */
function budgetBlock({ budget, used }: BudgetUsage): string {
  return replyLines(
    `Budget hari ini: ${code(`${formatAmount(used)} / ${formatAmount(budget)}`)}`,
    remainingLine(budget - used),
  );
}

/** FR-086: peringatan lembut di ≥80%; lebih keras bila Budget terlampaui (tepat 100% masih lembut). */
function budgetWarning({ budget, used }: BudgetUsage): string | null {
  // Dibagi dulu supaya perkaliannya tidak melewati batas bilangan aman di Nominal besar.
  if ((used / budget) * 100 < SOFT_WARNING_PERCENT) return null;

  const percent = Math.floor((used / budget) * 100);
  const over = used > budget ? ', budget harian terlampaui' : '';
  return warning(`Pemakaian budget hari ini ${percent}%${over}.`);
}

/** FR-081/FR-082: tanpa argumen menampilkan, dengan Nominal menetapkan mulai hari ini. */
async function dailyBudget(args: string, deps: Deps): Promise<string> {
  if (!args.trim()) {
    const usage = await budgetUsage(deps);
    if (!usage) return blocks('Belum ada budget harian.', 'Tetapkan dengan /budget 150rb.');
    return blocks(
      '⚙️ <b>Budget harian</b>',
      replyLines(
        nominalLine(usage.budget),
        `Pemakaian hari ini: ${code(formatAmount(usage.used))}`,
        remainingLine(usage.budget - usage.used),
      ),
    );
  }

  const amount = parseAmount(args);
  if (amount === null) return USAGE_BUDGET;
  const now = deps.now();
  await deps.repo.setBudget(amount, wibIsoDay(now));
  return blocks(
    '✅ <b>Budget harian ditetapkan</b>',
    replyLines(nominalLine(amount), `Berlaku: ${todayPeriod(now).label}`),
  );
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
    return blocks(
      // R4c: ID cukup di baris atas, tak diulang di kalimat galat.
      replyLines(
        idLine(id),
        '⚠️ <b>Tidak bisa mengedit: Transaksi tidak ada, sudah Dihapus, atau bukan Pengeluaran/Pemasukan.</b>',
      ),
      USAGE_EDIT,
    );
  }

  // Akun bisa berpindah, dan kita tidak tahu akun lama; tampilkan keduanya (FR-064).
  const accounts: Account[] = ['tunai', 'bank'];
  const balances = await deps.repo.getBalances();
  return blocks(
    '✅ <b>Transaksi diubah</b>',
    replyLines(idLine(edited.id), ...transactionCard(edited)),
    balanceBlock(accounts, balances),
    negativeWarning(accounts, balances),
  );
}

/** FR-062: hapus berlaku untuk Transaksi aktif apa pun, tidak membuang Riwayat undo (FR-053). */
async function deleteTransaction(args: string, deps: Deps): Promise<string> {
  const [idToken, ...rest] = args.trim().split(/\s+/);
  const id = parseId(idToken);
  if (id === null || rest.length > 0) return USAGE_HAPUS;

  const deleted = await deps.repo.deleteTransaction(id);
  if (!deleted) {
    return blocks(
      replyLines(idLine(id), '⚠️ <b>Tidak ada Transaksi aktif.</b>'),
      USAGE_HAPUS,
    );
  }

  const accounts = affectedAccounts(deleted);
  const balances = await deps.repo.getBalances();
  return blocks(
    '✅ <b>Transaksi dihapus</b>',
    replyLines(idLine(deleted.id), ...transactionCard(deleted)),
    balanceBlock(accounts, balances),
    negativeWarning(accounts, balances),
  );
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
