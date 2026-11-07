import type { Account, CarryIn, LedgerEntry } from './repo';
import { splitSen } from './amount';
import { pad, wibDate, wibDateTime } from './wib';

/** Hasil `/export`: isi file plus nama dan caption untuk adapter Telegram (FR-101). Caption ber-HTML; isi CSV tetap polos. */
export interface CsvFile {
  filename: string;
  content: string;
  caption: string;
}

const BOM = '\uFEFF';
const HEADER = 'id,date,account,type,description,money_in,money_out,account_balance,total_balance';
const ACCOUNTS: readonly Account[] = ['tunai', 'bank'];

/** FR-099: kutip bila memuat koma, kutip, atau baris baru; kutip ganda jadi dua (RFC 4180). */
function field(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const row = (values: readonly (string | number)[]) => values.map(field).join(',');

/**
 * FR-098/ADR-0005: nilai uang (integer sen) ditulis sebagai desimal bertitik
 * agar delimiter-safe untuk CSV (`1321765.03`, `25000`). Titik ribuan sengaja
 * tidak dipakai; `.dd` hanya muncul bila sen ≠ 0 — beda dari chat (koma).
 */
function money(sen: number): string {
  const sign = sen < 0 ? '-' : '';
  const { whole, cents } = splitSen(sen);
  return cents === 0 ? `${sign}${whole}` : `${sign}${whole}.${pad(cents)}`;
}

/** FR-092, FR-093: satu Baris ledger; kolom uang memakai desimal bertitik. */
function ledgerRow(entry: LedgerEntry): string {
  return row([
    entry.id,
    wibDateTime(entry.occurredAt),
    entry.account,
    entry.type,
    entry.description,
    money(entry.moneyIn),
    money(entry.moneyOut),
    money(entry.accountBalance),
    money(entry.totalBalance),
  ]);
}

/** FR-097: Baris pembuka periode, satu per Akun, dengan saldo sebelum bulan berjalan. */
function carryInRows(carryIn: readonly CarryIn[], start: Date): string[] {
  const sorted = [...carryIn].sort((a, b) => ACCOUNTS.indexOf(a.account) - ACCOUNTS.indexOf(b.account));
  const total = sorted.reduce((sum, item) => sum + item.balance, 0);
  return sorted.map(({ account, balance }) =>
    row([
      '',
      wibDateTime(start),
      account,
      'opening',
      'Saldo awal periode',
      money(balance > 0 ? balance : 0),
      money(balance < 0 ? -balance : 0),
      money(balance),
      money(total),
    ]),
  );
}

/**
 * FR-090/FR-091: `start` null = seluruh data; selain itu export bulanan yang
 * dimulai `start` (tengah malam WIB tanggal 1).
 */
export function buildCsv(
  entries: readonly LedgerEntry[],
  carryIn: readonly CarryIn[] = [],
  start: Date | null = null,
): CsvFile {
  const lines = [HEADER, ...(start ? carryInRows(carryIn, start) : []), ...entries.map(ledgerRow)];
  const count = entries.length + (start ? carryIn.length : 0);

  if (!start) {
    return {
      filename: 'keuangan-semua.csv',
      content: BOM + lines.join('\r\n'),
      caption: `📄 <b>Export semua transaksi</b>\n\n<code>${count}</code> baris`,
    };
  }

  const { year, month } = wibDate(start);
  const monthText = pad(month);
  return {
    filename: `keuangan-${year}-${monthText}.csv`,
    content: BOM + lines.join('\r\n'),
    caption: `📄 <b>Export ${monthText}/${year}</b>\n\n<code>${count}</code> baris`,
  };
}
