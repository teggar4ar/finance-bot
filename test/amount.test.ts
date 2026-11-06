import { describe, expect, it } from 'vitest';
import { formatAmount, parseAmount } from '../src/amount';

describe('parseAmount (sen, ADR-0005)', () => {
  it.each([
    ['1.321.765,03', 132_176_503],
    ['1321765,03', 132_176_503],
    ['1.321.765', 132_176_500],
    ['1,5', 150],
    ['25rb', 2_500_000],
    ['25k', 2_500_000],
    ['1,5jt', 150_000_000],
    ['1.5jt', 150_000_000],
    ['25.000', 2_500_000],
    ['25000', 2_500_000],
    ['Rp 25.000', 2_500_000],
    ['rp25000', 2_500_000],
    ['1.234.567', 123_456_700],
    ['100juta', 10_000_000_000],
    ['0,5jt', 50_000_000],
    ['1,55jt', 155_000_000],
    ['9.999.999.999.999,99', 999_999_999_999_999],
  ])('menerima %s (FR-034)', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it.each([
    '1.5',
    '25,000',
    '1,234,567',
    '1.2345',
    '1,',
    ',5',
    '0',
    '0rb',
    '0,00jt',
    '-5',
    '-5rb',
    'abc',
    '',
    'rp',
    '25 rb',
    '1234567890123456',
    '999999999999999',
  ])('menolak %j (FR-034)', (input) => {
    expect(parseAmount(input)).toBeNull();
  });
});

describe('formatAmount (sen, ADR-0005)', () => {
  it.each([
    [0, '0'],
    [2_500_000, '25.000'],
    [123_456_700, '1.234.567'],
    [132_176_503, '1.321.765,03'],
    [150, '1,50'],
    [-500_000, '-5.000'],
    [-132_176_503, '-1.321.765,03'],
    [999_999_999_999_999, '9.999.999.999.999,99'],
  ])('memformat %d sen menjadi %s (FR-039)', (sen, expected) => {
    expect(formatAmount(sen)).toBe(expected);
  });

  it('nominal bulat tidak menampilkan ,00', () => {
    expect(formatAmount(132_176_500)).toBe('1.321.765');
  });
});
