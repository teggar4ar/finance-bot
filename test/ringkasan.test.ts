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
const run = (text: string, repo: Repo, now?: string): Promise<string> => execute(parseCommand(text), deps(repo, now));

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
    const { repo } = fakeRepo({ getSummary: async () => ({ income: 5_000_000, expense: 25_000, txCount: 3 }) });
    const text = await run('/hari_ini', repo);

    expect(text).toContain('hari ini (04/11/2026)');
    expect(text).toContain('Pemasukan: 5.000.000');
    expect(text).toContain('Pengeluaran: 25.000');
    expect(text).toContain('Net: 4.975.000');
    expect(text).toContain('Transaksi: 3');
  });

  it('Net negatif ditulis dengan tanda minus', async () => {
    const { repo } = fakeRepo({ getSummary: async () => ({ income: 0, expense: 25_000, txCount: 1 }) });
    expect(await run('/hari_ini', repo)).toContain('Net: -25.000');
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
