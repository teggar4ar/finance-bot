import { formatAmount, parseAmount } from './amount';
import type { Command } from './command';
import type { Account, Balances, Repo } from './repo';
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
  '/pengeluaran makan siang 25rb — catat pengeluaran (default tunai)',
  '/pengeluaran spotify 55rb @bank — pengeluaran dari bank',
  '/pemasukan gaji 5jt @bank — catat pemasukan',
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

function negativeWarning(negative: readonly Account[]): string {
  return negative.length > 0 ? `Peringatan: saldo ${negative.join(' dan ')} negatif.` : '';
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
  const warning = balances[account] < 0 ? ` ${negativeWarning([account])}` : '';
  return `Saldo awal ${account} ${formatAmount(amount)} dicatat. ID ${id}. Saldo ${account}: ${formatAmount(balances[account])}.${warning}`;
}

type Handler = (command: Command, deps: Deps) => Promise<string>;

const handlers: Record<string, Handler> = {
  help: async () => HELP,
  start: async () => HELP,
  saldo: async (_command, deps) => saldoText(await deps.repo.getBalances()),
  saldo_awal: async (command, deps) => setOpeningBalance(command.args, deps),
};

export async function execute(command: Command | null, deps: Deps): Promise<string> {
  if (!command) return HINT;
  const handler = handlers[command.name];
  return handler ? handler(command, deps) : HINT;
}