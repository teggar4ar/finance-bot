/**
 * Parser Nominal (FR-034) dan formatter angka (FR-039).
 * Semua nominal berbasis integer **sen** (1 rupiah = 100 sen), ADR-0005.
 * `null` berarti masukan tidak sah.
 */
const SUFFIXES: Record<string, number> = {
  rb: 1_000,
  k: 1_000,
  jt: 1_000_000,
  juta: 1_000_000,
};

/**
 * Batas dalam sen: 999.999.999.999.999 sen ≈ Rp 10 triliun (ADR-0005).
 * Nilai ini juga di bawah `Number.MAX_SAFE_INTEGER` (≈9×10¹⁵), jadi aritmetika integer aman.
 */
const MAX_AMOUNT = 999_999_999_999_999;

/** Nilai pecahan desimal `dd` (2 digit) jadi sen: `'5'` -> 50, `'05'` -> 5. */
const fractionToSen = (fraction: string): number => Number(fraction.padEnd(2, '0'));

export function parseAmount(text: string): number | null {
  const raw = text.trim().toLowerCase().replace(/^rp\.?\s*/, '');
  let sen: number;

  const suffixed = /^(\d+)(?:[.,](\d{1,2}))?(rb|k|jt|juta)$/.exec(raw);
  if (suffixed) {
    // Dengan suffix, `.` maupun `,` boleh menjadi pemisah desimal (ADR-0005).
    const [, whole = '', fraction = '', suffix = ''] = suffixed;
    const multiplier = SUFFIXES[suffix] ?? 1;
    // Seluruh aritmetika tetap bilangan bulat: pecahan diskalakan sebagai sen.
    sen = Number(whole) * multiplier * 100 + fractionToSen(fraction) * multiplier;
  } else if (/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(raw)) {
    // Tanpa suffix: titik = pemisah ribuan (kelompok 3 digit), koma = desimal ≤2 digit.
    const [whole = '', fraction = ''] = raw.split(',');
    sen = Number(whole.replaceAll('.', '')) * 100 + fractionToSen(fraction);
  } else {
    return null;
  }

  if (!Number.isSafeInteger(sen) || sen <= 0 || sen > MAX_AMOUNT) return null;
  return sen;
}

/** FR-039/ADR-0005: titik ribuan; `,dd` hanya bila sen ≠ 0. */
export function formatAmount(sen: number): string {
  const sign = sen < 0 ? '-' : '';
  const abs = Math.abs(sen);
  const cents = abs % 100;
  const whole = (abs - cents) / 100;
  const wholeText = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return cents === 0 ? `${sign}${wholeText}` : `${sign}${wholeText},${String(cents).padStart(2, '0')}`;
}
