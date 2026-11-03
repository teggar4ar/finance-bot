import type { Command } from './command';

/**
 * Seam perilaku: Telegram → `execute` → teks balasan.
 * `deps` diisi dari luar supaya bisa diganti fake di tes.
 */
export interface Deps {
  now: () => Date;
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

const handlers: Record<string, () => string> = {
  help: () => HELP,
  start: () => HELP,
};

export async function execute(command: Command | null, _deps: Deps): Promise<string> {
  const handler = command ? handlers[command.name] : undefined;
  return handler ? handler() : HINT;
}