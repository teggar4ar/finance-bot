import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/command';
import type { Deps } from '../src/execute';
import { execute } from '../src/execute';
import type { Repo } from '../src/repo';
import { fakeRepo as baseRepo } from './fake-repo';

interface Range {
  start: string;
  end: string;
}

function fakeRepo(overrides: Partial<Repo> = {}): { repo: Repo; ranges: Range[] } {
  const ranges: Range[] = [];
  const repo: Repo = baseRepo({
    getSummary: async (start, end) => {
      ranges.push({ start: start.toISOString(), end: end.toISOString() });
      return { income: 0, expense: 0, txCount: 0 };
    },
    ...overrides,
  });
  return { repo, ranges };
}

const deps = (repo: Repo, now = '2026-11-04T02:00:00Z'): Deps => ({ now: () => new Date(now), repo });
const run = async (text: string, repo: Repo, now?: string): Promise<string> =>
  (await execute(parseCommand(text), deps(repo, now))) as string;

describe('/hari_ini', () => {
  it('memakai batas hari WIB sebagai rentang UTC (FR-070, FR-075)', async () => {
    const { repo, ranges } = fakeRepo();
    await run('/hari_ini', repo);

    expect(ranges).toEqual([{ start: '2026-11-03T17:00:00.000Z', end: '2026-11-04T17:00:00.000Z' }]);
  });

  it('pukul 23:59 WIB masih hari yang sama, 00:00 WIB sudah hari berikutnya (FR-075)', async () => {
    const late = fakeRepo();
    await run('/hari_ini', late.repo, '2026-11-04T16:59:00Z');
    expect(late.ranges[0]).toEqual({ start: '2026-11-03T17:00:00.000Z', end: '2026-11-04T17:00:00.000Z' });

    const midnight = fakeRepo();
    await run('/hari_ini', midnight.repo, '2026-11-04T17:00:00Z');
    expect(midnight.ranges[0]).toEqual({ start: '2026-11-04T17:00:00.000Z', end: '2026-11-05T17:00:00.000Z' });
  });

  it('menampilkan Pemasukan, Pengeluaran, Net, dan jumlah Transaksi (FR-070)', async () => {
    const { repo } = fakeRepo({ getSummary: async () => ({ income: 500_000_000, expense: 2_500_000, txCount: 3 }) });
    const text = await run('/hari_ini', repo);

    expect(text).toContain('hari ini (04/11/2026)');
    expect(text).toContain('Pemasukan: 5.000.000');
    expect(text).toContain('Pengeluaran: 25.000');
    expect(text).toContain('Net: 4.975.000');
    expect(text).toContain('Transaksi: 3');
  });

  it('Net negatif ditulis dengan tanda minus', async () => {
    const { repo } = fakeRepo({ getSummary: async () => ({ income: 0, expense: 2_500_000, txCount: 1 }) });
    expect(await run('/hari_ini', repo)).toContain('Net: -25.000');
  });

  it('menampilkan Ringkasan ber-sen (ADR-0005)', async () => {
    const { repo } = fakeRepo({ getSummary: async () => ({ income: 500_000_050, expense: 2_500_075, txCount: 2 }) });
    const text = await run('/hari_ini', repo);

    expect(text).toContain('Pemasukan: 5.000.000,50');
    expect(text).toContain('Pengeluaran: 25.000,75');
    expect(text).toContain('Net: 4.974.999,75');
  });
});

describe('/minggu_ini', () => {
  it('memakai minggu Senin sampai Minggu WIB (FR-071)', async () => {
    const { repo, ranges } = fakeRepo();
    await run('/minggu_ini', repo, '2026-11-04T02:00:00Z'); // Rabu

    expect(ranges).toEqual([{ start: '2026-11-01T17:00:00.000Z', end: '2026-11-08T17:00:00.000Z' }]);
  });

  it('hari Minggu masih minggu yang sama', async () => {
    const { repo, ranges } = fakeRepo();
    await run('/minggu_ini', repo, '2026-11-08T16:00:00Z'); // Minggu 23:00 WIB

    expect(ranges).toEqual([{ start: '2026-11-01T17:00:00.000Z', end: '2026-11-08T17:00:00.000Z' }]);
  });

  it('Senin 00:00 WIB membuka minggu baru', async () => {
    const { repo, ranges } = fakeRepo();
    await run('/minggu_ini', repo, '2026-11-08T17:00:00Z');

    expect(ranges).toEqual([{ start: '2026-11-08T17:00:00.000Z', end: '2026-11-15T17:00:00.000Z' }]);
  });

  it('minggu yang melintasi tahun berakhir di Januari', async () => {
    const { repo, ranges } = fakeRepo();
    const text = await run('/minggu_ini', repo, '2026-12-28T05:00:00Z'); // Senin 12:00 WIB

    expect(ranges).toEqual([{ start: '2026-12-27T17:00:00.000Z', end: '2027-01-03T17:00:00.000Z' }]);
    expect(text).toContain('28/12/2026 - 03/01/2027');
  });
});

describe('/bulan_ini', () => {
  it('memakai bulan kalender WIB (FR-072)', async () => {
    const { repo, ranges } = fakeRepo();
    const text = await run('/bulan_ini', repo, '2026-11-04T02:00:00Z');

    expect(ranges).toEqual([{ start: '2026-10-31T17:00:00.000Z', end: '2026-11-30T17:00:00.000Z' }]);
    expect(text).toContain('bulan ini (11/2026)');
  });

  it('1 WIB masih bulan berjalan, 00:00 WIB tanggal 1 sudah bulan baru', async () => {
    const { repo, ranges } = fakeRepo();
    await run('/bulan_ini', repo, '2026-10-31T16:59:00Z'); // 31/10 23:59 WIB
    expect(ranges[0]).toEqual({ start: '2026-09-30T17:00:00.000Z', end: '2026-10-31T17:00:00.000Z' });

    await run('/bulan_ini', repo, '2026-10-31T17:00:00Z'); // 01/11 00:00 WIB
    expect(ranges[1]).toEqual({ start: '2026-10-31T17:00:00.000Z', end: '2026-11-30T17:00:00.000Z' });
  });

  it('memakai tahun baru saat WIB melewati 31 Desember', async () => {
    const { repo, ranges } = fakeRepo();
    const text = await run('/bulan_ini', repo, '2026-12-31T17:30:00Z'); // 01/01/2027 00:30 WIB

    expect(ranges).toEqual([{ start: '2026-12-31T17:00:00.000Z', end: '2027-01-31T17:00:00.000Z' }]);
    expect(text).toContain('bulan ini (01/2027)');
  });
});

describe('hari melewati budget (FR-076)', () => {
  const expenseAt = (iso: string, amount: number) => ({ occurredAt: new Date(iso), amount });

  it('bulan menghitung hari WIB yang melewati Budget yang berlaku, bukan hari tanpa Budget', async () => {
    const budgetDates: string[] = [];
    const { repo, ranges } = fakeRepo({
      getExpensesInRange: async () => [
        expenseAt('2026-10-04T18:00:00Z', 50_000_000), // 05/10, belum ada Budget
        expenseAt('2026-10-10T05:00:00Z', 6_000_000), // 10/10, lewat 50.000
        expenseAt('2026-10-19T05:00:00Z', 4_000_000), // 19/10, tidak lewat
        expenseAt('2026-10-20T05:00:00Z', 4_000_000), // 20/10, Budget turun jadi 30.000
        expenseAt('2026-10-25T05:00:00Z', 3_000_000), // tepat 30.000, belum lewat
      ],
      getBudgetsUpTo: async (date) => {
        budgetDates.push(date);
        return [
          { effectiveFrom: '2026-10-10', amount: 5_000_000 },
          { effectiveFrom: '2026-10-20', amount: 3_000_000 },
        ];
      },
    });

    const text = await run('/ringkasan 2026-10', repo);

    expect(budgetDates).toEqual(['2026-10-31']);
    expect(ranges).toEqual([{ start: '2026-09-30T17:00:00.000Z', end: '2026-10-31T17:00:00.000Z' }]);
    expect(text).toContain('Hari melewati budget: 2');
  });

  it('/bulan_ini juga menyebutkannya', async () => {
    const { repo } = fakeRepo({
      getExpensesInRange: async () => [expenseAt('2026-11-05T05:00:00Z', 6_000_000)],
      getBudgetsUpTo: async () => [{ effectiveFrom: '2026-11-01', amount: 5_000_000 }],
    });

    expect(await run('/bulan_ini', repo)).toContain('Hari melewati budget: 1');
  });

  it('tanpa Budget pada bulan itu tidak ada barisnya', async () => {
    const { repo } = fakeRepo({
      getExpensesInRange: async () => [expenseAt('2026-10-05T05:00:00Z', 500_000)],
    });

    expect(await run('/ringkasan 2026-10', repo)).not.toContain('Hari melewati budget');
  });

  it('Budget berlaku tapi tidak ada hari yang lewat: barisnya disembunyikan', async () => {
    const { repo } = fakeRepo({
      getExpensesInRange: async () => [expenseAt('2026-10-05T05:00:00Z', 50_000)],
      getBudgetsUpTo: async () => [{ effectiveFrom: '2026-10-05', amount: 50_000 }],
    });

    expect(await run('/ringkasan 2026-10', repo)).not.toContain('Hari melewati budget');
  });

  it.each(['/hari_ini', '/minggu_ini', '/ringkasan 2026-10-15'])(
    'ringkasan bukan bulanan tidak membaca Budget: %s',
    async (text) => {
      let budgetCalls = 0;
      const { repo } = fakeRepo({
        getBudgetsUpTo: async () => {
          budgetCalls += 1;
          return [{ effectiveFrom: '2026-10-01', amount: 50_000 }];
        },
      });

      expect(await run(text, repo)).not.toContain('Hari melewati budget');
      expect(budgetCalls).toBe(0);
    },
  );
});

describe('/ringkasan', () => {
  it('menerima satu tanggal (FR-073)', async () => {
    const { repo, ranges } = fakeRepo();
    const text = await run('/ringkasan 2026-10-15', repo);

    expect(ranges).toEqual([{ start: '2026-10-14T17:00:00.000Z', end: '2026-10-15T17:00:00.000Z' }]);
    expect(text).toContain('Ringkasan 15/10/2026');
  });

  it('menerima satu bulan dan memakai jumlah hari yang benar (FR-073)', async () => {
    const { repo, ranges } = fakeRepo();
    await run('/ringkasan 2026-02', repo);

    expect(ranges).toEqual([{ start: '2026-01-31T17:00:00.000Z', end: '2026-02-28T17:00:00.000Z' }]);
  });

  it.each([
    '/ringkasan',
    '/ringkasan besok',
    '/ringkasan 2026-13',
    '/ringkasan 2026-02-31',
    '/ringkasan 2026-1',
    '/ringkasan 0026-10-15',
  ])('format tidak dikenal membalas petunjuk %s (FR-073)', async (text) => {
    const { repo, ranges } = fakeRepo();
    const reply = await run(text, repo);

    expect(reply).toContain('/ringkasan 2026-10-15');
    expect(ranges).toEqual([]);
  });
});
