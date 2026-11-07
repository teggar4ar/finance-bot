import { bold, code } from './reply';
import type { ExpenseOrIncome } from './repo';

/** FR-100: per kategori; setiap command v1 tetap muncul dengan contoh singkat. */
export const HELP = [
  '<b>Command yang tersedia</b>',
  '',
  'Nominal boleh berdesimal hingga 2 digit setelah koma (mis. 25.000,50).',
  '',
  '<b>📝 Catat</b>',
  '/saldo_awal tunai 200rb - tetapkan saldo awal satu akun',
  '/pengeluaran makan siang 25rb - catat pengeluaran dari tunai (alias /k)',
  '/pengeluaran spotify 55rb @bank - catat pengeluaran dari bank',
  '/pemasukan gaji 5jt @bank - catat pemasukan ke bank (alias /m)',
  '/transfer bank tunai 500rb - pindah uang antar akun',
  '',
  '<b>👀 Lihat</b>',
  '/saldo - saldo tunai, bank, dan total',
  '/riwayat - 10 transaksi terakhir',
  '/hari_ini - ringkasan hari ini',
  '/minggu_ini - ringkasan minggu ini',
  '/bulan_ini - ringkasan bulan ini',
  '/ringkasan 2026-10-15 - ringkasan satu tanggal',
  '/ringkasan 2026-10 - ringkasan satu bulan',
  '',
  '<b>✏️ Ubah</b>',
  '/undo - batalkan transaksi terakhir',
  '/redo - pulihkan transaksi terakhir',
  '/edit 12 makan malam 30rb - ubah transaksi',
  '/hapus 12 - hapus transaksi',
  '',
  '<b>⚙️ Budget dan export</b>',
  '/budget - lihat budget harian',
  '/budget 150rb - tetapkan budget harian',
  '/export - ekspor semua transaksi ke CSV',
  '/export 2026-10 - ekspor satu bulan',
  '',
  '/help - daftar command ini',
  '/start - daftar command ini',
].join('\n');

export const HINT = ['❓ <b>Command tidak dikenal.</b>', '', 'Ketik /help untuk daftar command.'].join('\n');

/** NFR-061: penolakan Format/Contoh; tag pada teks `<…>` di-escape lewat `code`. */
const usage = (format: string, example: string): string =>
  [`${bold('Format:')} ${code(format)}`, '', `${bold('Contoh:')} ${code(example)}`].join('\n');

export const USAGE_SALDO_AWAL = usage('/saldo_awal <tunai|bank> <nominal>', '/saldo_awal tunai 200rb');
export const USAGE_PENGELUARAN = usage(
  '/pengeluaran <deskripsi> <nominal> [@bank|@tunai]',
  '/pengeluaran makan siang 25rb',
);
export const USAGE_PEMASUKAN = usage(
  '/pemasukan <deskripsi> <nominal> [@bank|@tunai]',
  '/pemasukan gaji 5jt @bank',
);
export const USAGE_TRANSFER = usage('/transfer <dari> <ke> <nominal>', '/transfer bank tunai 500rb');
export const USAGE_EDIT = usage('/edit <id> <deskripsi> <nominal> [@bank|@tunai]', '/edit 12 makan malam 30rb');
export const USAGE_HAPUS = usage('/hapus <id>', '/hapus 12');
export const USAGE_RINGKASAN = usage('/ringkasan <tanggal|bulan>', '/ringkasan 2026-10-15 atau /ringkasan 2026-10');
export const USAGE_BUDGET = usage('/budget <nominal>', '/budget 150rb');
export const USAGE_EXPORT = usage('/export [YYYY-MM]', '/export 2026-10');

/** Nama jenis yang tampil ke pengguna; satu tempat supaya balasan tidak berbeda kata. */
export const TYPE_LABELS: Record<ExpenseOrIncome, string> = { expense: 'Pengeluaran', income: 'Pemasukan' };
export const TYPE_EMOJI: Record<ExpenseOrIncome, string> = { expense: '💸', income: '📥' };
export const TRANSFER_EMOJI = '🔁';
