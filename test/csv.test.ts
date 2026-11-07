import { describe, expect, it } from 'vitest';
import { buildCsv } from '../src/csv';
import type { LedgerEntry } from '../src/repo';

const HEADER = 'id,date,account,type,description,money_in,money_out,account_balance,total_balance';

const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: 7,
  occurredAt: new Date('2026-11-03T01:05:09Z'), // 08:05:09 WIB
  account: 'tunai',
  type: 'expense',
  description: 'makan siang',
  moneyIn: 0,
  moneyOut: 2_500_000,
  accountBalance: -2_500_000,
  totalBalance: -2_500_000,
  ...over,
});

describe('buildCsv', () => {
  it('tetap menghasilkan header yang sah tanpa baris (FR-092, FR-099, FR-102)', () => {
    expect(buildCsv([])).toEqual({
      filename: 'keuangan-semua.csv',
      content: `\uFEFF${HEADER}`,
      caption: '📄 <b>Export semua transaksi</b>\n\n<code>0</code> baris',
    });
  });

  it('menulis kolom uang sebagai desimal bertitik dan waktu WIB (FR-098, ADR-0005)', () => {
    const file = buildCsv([entry()]);
    const row = '7,2026-11-03 08:05:09,tunai,expense,makan siang,0,25000,-25000,-25000';

    expect(file.content).toBe(`\uFEFF${HEADER}\r\n${row}`);
    expect(file.caption).toBe('📄 <b>Export semua transaksi</b>\n\n<code>1</code> baris');
  });

  it('menulis sen sebagai .dd hanya bila sen ≠ 0 (ADR-0005)', () => {
    const file = buildCsv([
      entry({
        moneyIn: 132_176_503,
        moneyOut: 0,
        accountBalance: 132_176_503,
        totalBalance: 132_176_503,
      }),
    ]);

    expect(file.content.split('\r\n')[1]).toContain(
      ',makan siang,1321765.03,0,1321765.03,1321765.03',
    );
  });

  it('menulis saldo negatif ber-sen dengan titik desimal dan tanda minus (ADR-0005)', () => {
    const file = buildCsv([
      entry({ moneyIn: 0, moneyOut: 2_500_050, accountBalance: -2_500_050, totalBalance: -2_500_050 }),
    ]);

    expect(file.content.split('\r\n')[1]).toContain('makan siang,0,25000.50,-25000.50,-25000.50');
  });

  it('menggeser timestamp ke hari WIB berikutnya bila lewat tengah malam UTC (FR-098)', () => {
    const file = buildCsv([entry({ occurredAt: new Date('2026-11-03T17:30:00Z') })]);

    expect(file.content.split('\r\n')[1]).toContain('2026-11-04 00:30:00');
  });

  it('mengutip deskripsi yang memuat koma, kutip, atau baris baru (FR-099)', () => {
    const file = buildCsv([entry({ description: 'makan, "enak"\nsekali' })]);

    expect(file.content).toContain('"makan, ""enak""\nsekali"');
  });

  it('mengawali export bulanan dengan Baris pembuka periode per Akun (FR-097)', () => {
    const start = new Date('2026-09-30T17:00:00Z'); // 00:00 WIB 01/10
    const file = buildCsv(
      [entry()],
      [
        { account: 'bank', balance: 10_000_000 },
        { account: 'tunai', balance: 30_000_000 },
      ],
      start,
    );
    const [, firstCarry, secondCarry] = file.content.split('\r\n');

    expect(file.filename).toBe('keuangan-2026-10.csv');
    expect(file.caption).toBe('📄 <b>Export 10/2026</b>\n\n<code>3</code> baris');
    expect(firstCarry).toBe(',2026-10-01 00:00:00,tunai,opening,Saldo awal periode,300000,0,300000,400000');
    expect(secondCarry).toBe(',2026-10-01 00:00:00,bank,opening,Saldo awal periode,100000,0,100000,400000');
  });

  it('Baris pembuka periode memakai desimal bertitik bila sen ≠ 0 (ADR-0005)', () => {
    const start = new Date('2026-09-30T17:00:00Z');
    const file = buildCsv(
      [],
      [
        { account: 'bank', balance: 132_176_503 },
        { account: 'tunai', balance: 2_500_000 },
      ],
      start,
    );
    const [, firstCarry, secondCarry] = file.content.split('\r\n');

    expect(firstCarry).toBe(
      ',2026-10-01 00:00:00,tunai,opening,Saldo awal periode,25000,0,25000,1346765.03',
    );
    expect(secondCarry).toBe(
      ',2026-10-01 00:00:00,bank,opening,Saldo awal periode,1321765.03,0,1321765.03,1346765.03',
    );
  });

  it('menaruh saldo pembuka negatif di money_out sebagai nilai absolut (FR-097)', () => {
    const start = new Date('2026-09-30T17:00:00Z');
    const file = buildCsv([], [{ account: 'tunai', balance: -5_000_000 }], start);

    expect(file.content.split('\r\n')[1]).toBe(
      ',2026-10-01 00:00:00,tunai,opening,Saldo awal periode,0,50000,-50000,-50000',
    );
  });

  it('export seluruh data tidak memakai Baris pembuka periode (FR-090)', () => {
    const file = buildCsv([entry()], [{ account: 'tunai', balance: 300_000 }]);

    expect(file.filename).toBe('keuangan-semua.csv');
    expect(file.content).not.toContain('Saldo awal periode');
  });
});
