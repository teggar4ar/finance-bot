import { describe, expect, it } from 'vitest';
import { formatAmount, parseAmount } from '../src/amount';

describe('parseAmount', () => {
  it.each([
    ['25rb', 25_000],
    ['25k', 25_000],
    ['1,5jt', 1_500_000],
    ['1.5jt', 1_500_000],
    ['25.000', 25_000],
    ['25000', 25_000],
    ['Rp 25.000', 25_000],
    ['rp25000', 25_000],
    ['1.234.567', 1_234_567],
    ['1,234,567', 1_234_567],
    ['100juta', 100_000_000],
    ['0,5jt', 500_000],
    ['1,55jt', 1_550_000],
    ['999999999999999', 999_999_999_999_999],
  ])('menerima %s (FR-034)', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it.each([
    '1,5',
    '1.5',
    '0',
    '0rb',
    '0,00jt',
    '-5',
    '-5rb',
    '25,0000',
    '1.2345',
    'abc',
    '',
    'rp',
    '25 rb',
    '1234567890123456',
  ])('menolak %j (FR-034)', (input) => {
    expect(parseAmount(input)).toBeNull();
  });
});

describe('formatAmount', () => {
  it.each([
    [0, '0'],
    [25_000, '25.000'],
    [1_234_567, '1.234.567'],
    [-5_000, '-5.000'],
    [999_999_999_999_999, '999.999.999.999.999'],
  ])('memformat %d menjadi %s (FR-039)', (amount, expected) => {
    expect(formatAmount(amount)).toBe(expected);
  });
});