import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/command';
import type { CsvFile } from '../src/csv';
import { execute } from '../src/execute';
import type { CarryIn, LedgerEntry, Repo } from '../src/repo';
import { fakeRepo as baseRepo } from './fake-repo';

const NOW = '2026-11-05T02:00:00Z';

interface Range {
  start: string | null;
  end: string | null;
}

const entry: LedgerEntry = {
  id: 7,
  occurredAt: new Date('2026-10-05T01:00:00Z'),
  account: 'tunai',
  type: 'expense',
  description: 'makan siang',
  moneyIn: 0,
  moneyOut: 2_500_000,
  accountBalance: 17_500_000,
  totalBalance: 17_500_000,
};

/** Merekam argumen rentang supaya batas bulan WIB bisa diperiksa. */
function fakeRepo(ledger: LedgerEntry[] = [entry], carryIn: CarryIn[] = []) {
  const ranges: Range[] = [];
  const carryStarts: string[] = [];
  const repo = baseRepo({
    getLedger: async (start, end) => {
      ranges.push({ start: start?.toISOString() ?? null, end: end?.toISOString() ?? null });
      return ledger;
    },
    getCarryIn: async (start) => {
      carryStarts.push(start.toISOString());
      return carryIn;
    },
  });
  return { repo, ranges, carryStarts };
}

const run = (text: string, repo: Repo) => execute(parseCommand(text), { now: () => new Date(NOW), repo });

async function csv(text: string, repo: Repo): Promise<CsvFile> {
  const reply = await run(text, repo);
  if (typeof reply === 'string') throw new Error(`bukan file: ${reply}`);
  return reply;
}

describe('/export', () => {
  it('mengirim seluruh Transaksi aktif dengan nama keuangan-semua.csv (FR-090, FR-101)', async () => {
    const { repo, ranges, carryStarts } = fakeRepo();
    const file = await csv('/export', repo);

    expect(ranges).toEqual([{ start: null, end: null }]);
    expect(carryStarts).toEqual([]);
    expect(file.filename).toBe('keuangan-semua.csv');
    expect(file.caption).toBe('Export semua transaksi\n1 baris');
    expect(file.content).toContain('7,2026-10-05 08:00:00,tunai,expense,makan siang,0,25000,175000,175000');
  });

  it('membatasi ke satu bulan WIB dan menambah Baris pembuka periode (FR-091, FR-097)', async () => {
    const { repo, ranges, carryStarts } = fakeRepo([entry], [{ account: 'tunai', balance: 20_000_000 }]);
    const file = await csv('/export 2026-10', repo);

    expect(ranges).toEqual([{ start: '2026-09-30T17:00:00.000Z', end: '2026-10-31T17:00:00.000Z' }]);
    expect(carryStarts).toEqual(['2026-09-30T17:00:00.000Z']);
    expect(file.filename).toBe('keuangan-2026-10.csv');
    expect(file.caption).toBe('Export 10/2026\n2 baris');
    expect(file.content).toContain(',2026-10-01 00:00:00,tunai,opening,Saldo awal periode,200000,0,200000,200000');
  });

  it('menulis kolom uang sebagai desimal bertitik bila sen ≠ 0 (ADR-0005)', async () => {
    const fractional: LedgerEntry = {
      ...entry,
      moneyIn: 0,
      moneyOut: 2_500_050,
      accountBalance: 17_499_950,
      totalBalance: 17_499_950,
    };
    const { repo } = fakeRepo([fractional], [{ account: 'tunai', balance: 19_999_950 }]);
    const file = await csv('/export 2026-10', repo);

    expect(file.content).toContain('makan siang,0,25000.50,174999.50,174999.50');
    expect(file.content).toContain(',2026-10-01 00:00:00,tunai,opening,Saldo awal periode,199999.50,0,199999.50,199999.50');
  });

  it('bulan tanpa Transaksi tetap menghasilkan CSV sah berisi header (FR-102)', async () => {
    const { repo } = fakeRepo([], []);
    const file = await csv('/export 2026-10', repo);

    expect(file.content.split('\r\n')).toHaveLength(1);
    expect(file.caption).toBe('Export 10/2026\n0 baris');
  });

  it.each(['/export abc', '/export 2026-13', '/export 2026-10-15', '/export 2026-1'])(
    '%s ditolak dengan contoh dan tanpa membaca ledger',
    async (line) => {
      const { repo, ranges, carryStarts } = fakeRepo();
      const reply = await run(line, repo);

      expect(reply).toContain('/export 2026-10');
      expect(ranges).toEqual([]);
      expect(carryStarts).toEqual([]);
    },
  );
});
