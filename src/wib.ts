/**
 * Satu-satunya tempat aritmetika dan format WIB (CONTEXT.md: WIB = UTC+7).
 * Instant disimpan UTC; untuk membaca kalender WIB, geser dulu lalu baca komponen `getUTC*`.
 */

export const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
export const WIB_DAY_MS = 24 * 60 * 60 * 1000;

export const pad = (value: number) => String(value).padStart(2, '0');

/** FR-060: waktu ringkas `dd/mm HH:mm` untuk /riwayat. */
export function wibTimestamp(occurredAt: Date): string {
  const wib = new Date(occurredAt.getTime() + WIB_OFFSET_MS);
  return `${pad(wib.getUTCDate())}/${pad(wib.getUTCMonth() + 1)} ${pad(wib.getUTCHours())}:${pad(wib.getUTCMinutes())}`;
}

/** FR-098: timestamp lengkap `YYYY-MM-DD HH:mm:ss` untuk Export CSV. */
export function wibDateTime(at: Date): string {
  const wib = new Date(at.getTime() + WIB_OFFSET_MS);
  const date = `${wib.getUTCFullYear()}-${pad(wib.getUTCMonth() + 1)}-${pad(wib.getUTCDate())}`;
  const time = `${pad(wib.getUTCHours())}:${pad(wib.getUTCMinutes())}:${pad(wib.getUTCSeconds())}`;
  return `${date} ${time}`;
}

/** Tanggal kalender WIB dari satu instant. */
export function wibDate(at: Date): { year: number; month: number; day: number } {
  const wib = new Date(at.getTime() + WIB_OFFSET_MS);
  return { year: wib.getUTCFullYear(), month: wib.getUTCMonth() + 1, day: wib.getUTCDate() };
}

/** Tengah malam UTC dari tanggal kalender WIB; `Date.UTC` menormalkan tanggal di luar bulan. */
export function wibDay(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day);
}

/** Tanggal kalender WIB sebagai `YYYY-MM-DD`, bentuk `budgets.effective_from` (FR-083). */
export function wibIsoDay(at: Date): string {
  const { year, month, day } = wibDate(at);
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function dayLabel(dayMs: number): string {
  const date = new Date(dayMs);
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
