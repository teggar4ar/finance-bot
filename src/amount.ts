/**
 * Parser Nominal (FR-034) dan formatter angka (FR-039).
 * Rupiah bulat positif; `null` berarti masukan tidak sah.
 */
const SUFFIXES: Record<string, number> = {
  rb: 1_000,
  k: 1_000,
  jt: 1_000_000,
  juta: 1_000_000,
};

const MAX_AMOUNT = 999_999_999_999_999; // 15 digit

export function parseAmount(text: string): number | null {
  const raw = text.trim().toLowerCase().replace(/^rp\.?\s*/, '');
  let amount: number;

  const suffixed = /^(\d+)(?:[.,](\d{1,2}))?(rb|k|jt|juta)$/.exec(raw);
  if (suffixed) {
    const [, whole = '', fraction = '', suffix = ''] = suffixed;
    const multiplier = SUFFIXES[suffix] ?? 1;
    amount = Number(whole) * multiplier + Number(fraction.padEnd(2, '0')) * (multiplier / 100);
  } else if (/^\d{1,3}(?:[.,]\d{3})+$/.test(raw) || /^\d+$/.test(raw)) {
    amount = Number(raw.replace(/[.,]/g, ''));
  } else {
    return null;
  }

  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) return null;
  return amount;
}

export function formatAmount(amount: number): string {
  return String(Math.trunc(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}