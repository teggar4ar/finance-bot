import { WIB_DAY_MS, WIB_OFFSET_MS, dayLabel, daysInMonth, pad, wibDate, wibDay } from './wib';

/**
 * Aritmetika periode WIB (`/hari_ini`, `/minggu_ini`, `/bulan_ini`, `/ringkasan`).
 * Blok murni tanpa `Deps`; dipisah dari `execute.ts` saat file menembus ~500 baris
 * (audit F-2). Semua fungsi menghasilkan rentang UTC `[start, end)` (NFR-042).
 */
export interface Period {
  label: string;
  start: Date;
  end: Date;
  /** Diisi hanya untuk ringkasan bulanan; hari melewati budget hanya masuk akal per bulan (FR-076). */
  month: { year: number; month: number } | null;
}

/** Rentang UTC `[start, end)` untuk `days` hari WIB mulai `dayMs`. */
function period(label: string, dayMs: number, days: number, month: Period['month'] = null): Period {
  return {
    label,
    start: new Date(dayMs - WIB_OFFSET_MS),
    end: new Date(dayMs + days * WIB_DAY_MS - WIB_OFFSET_MS),
    month,
  };
}

export function todayPeriod(now: Date): Period {
  const { year, month, day } = wibDate(now);
  const dayMs = wibDay(year, month, day);
  return period(`hari ini (${dayLabel(dayMs)})`, dayMs, 1);
}

/** FR-071: minggu Senin sampai Minggu WIB. */
export function weekPeriod(now: Date): Period {
  const { year, month, day } = wibDate(now);
  const today = wibDay(year, month, day);
  const sinceMonday = (new Date(today).getUTCDay() + 6) % 7;
  const start = today - sinceMonday * WIB_DAY_MS;
  return period(`minggu ini (${dayLabel(start)} - ${dayLabel(start + 6 * WIB_DAY_MS)})`, start, 7);
}

export function monthPeriod(label: string, year: number, month: number): Period {
  return period(label, wibDay(year, month, 1), daysInMonth(year, month), { year, month });
}

/** FR-072: bulan kalender WIB. */
export function thisMonthPeriod(now: Date): Period {
  const { year, month } = wibDate(now);
  return monthPeriod(`bulan ini (${pad(month)}/${year})`, year, month);
}

/** FR-073: hanya `YYYY-MM-DD` atau `YYYY-MM`; tanggal mustahil seperti 31 Februari ditolak. */
export function summaryPeriod(args: string): Period | null {
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
