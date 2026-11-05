import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/command';
import { execute } from '../src/execute';
import type { Repo, Transaction } from '../src/repo';
import { fakeRepo as baseRepo } from './fake-repo';

const NOW = '2026-11-04T02:00:00Z'; // 09:00 WIB

interface SetCall {
  amount: number;
  wibDate: string;
}

interface UsedRange {
  start: string;
  end: string;
}

/** `budget`/`used` adalah jawaban query 6.6; `sets` dan `ranges` merekam argumennya. */
function fakeRepo(budget: number | null, used: number, overrides: Partial<Repo> = {}) {
  const sets: SetCall[] = [];
  const ranges: UsedRange[] = [];
  const repo = baseRepo({
    setBudget: async (amount, wibDate) => {
      sets.push({ amount, wibDate });
    },
    getBudgetFor: async () => budget,
    getExpenseUsed: async (start, end) => {
      ranges.push({ start: start.toISOString(), end: end.toISOString() });
      return used;
    },
    ...overrides,
  });
  return { repo, sets, ranges };
}

const run = async (text: string, repo: Repo, now = NOW): Promise<string> =>
  (await execute(parseCommand(text), { now: () => new Date(now), repo })) as string;

describe('/budget', () => {
  it('menjelaskan bila belum ada Budget, tanpa error (FR-081, FR-088)', async () => {
    const { repo, ranges } = fakeRepo(null, 0);
    const text = await run('/budget', repo);

    expect(text).toContain('Belum ada budget harian');
    expect(text).toContain('/budget 150rb');
    expect(ranges).toEqual([]);
  });

  it('menampilkan Budget, pemakaian hari ini, dan sisa (FR-081)', async () => {
    const { repo } = fakeRepo(150_000, 25_000);
    const text = await run('/budget', repo);

    expect(text).toContain('Budget harian: 150.000');
    expect(text).toContain('Pemakaian hari ini: 25.000');
    expect(text).toContain('Sisa: 125.000');
  });

  it('menampilkan kelebihan bila pemakaian melewati Budget (FR-081)', async () => {
    const { repo } = fakeRepo(150_000, 175_000);
    const text = await run('/budget', repo);

    expect(text).toContain('Pemakaian hari ini: 175.000');
    expect(text).toContain('Kelebihan: 25.000');
    expect(text).not.toContain('Sisa:');
  });

  it('pemakaian tepat sama dengan Budget berarti Sisa 0, bukan kelebihan (FR-081)', async () => {
    const { repo } = fakeRepo(100_000, 100_000);
    const text = await run('/budget', repo);

    expect(text).toContain('Sisa: 0');
    expect(text).not.toContain('Kelebihan');
  });

  it('memakai pemakaian hari WIB sebagai rentang UTC (FR-075, FR-084)', async () => {
    const { repo, ranges } = fakeRepo(150_000, 25_000);
    await run('/budget', repo);

    expect(ranges).toEqual([{ start: '2026-11-03T17:00:00.000Z', end: '2026-11-04T17:00:00.000Z' }]);
  });

  it('menetapkan Budget mulai hari itu (WIB) (FR-082, FR-083)', async () => {
    const { repo, sets } = fakeRepo(null, 0);
    const text = await run('/budget 150rb', repo);

    expect(sets).toEqual([{ amount: 150_000, wibDate: '2026-11-04' }]);
    expect(text).toContain('150.000');
    expect(text).toContain('hari ini (04/11/2026)');
  });

  it('memakai tanggal WIB, bukan UTC (FR-083)', async () => {
    const { repo, sets } = fakeRepo(null, 0);
    await run('/budget 150rb', repo, '2026-11-04T16:59:00Z'); // 23:59 WIB 04/11
    await run('/budget 150rb', repo, '2026-11-04T17:00:00Z'); // 00:00 WIB 05/11

    expect(sets.map((set) => set.wibDate)).toEqual(['2026-11-04', '2026-11-05']);
  });

  it.each(['/budget abc', '/budget 0', '/budget 150rb sekarang'])(
    '%s ditolak dengan contoh dan tanpa menulis (FR-082)',
    async (line) => {
      const { repo, sets } = fakeRepo(null, 0);
      const text = await run(line, repo);

      expect(sets).toEqual([]);
      expect(text).toContain('/budget 150rb');
    },
  );
});

describe('baris Budget di balasan Pengeluaran', () => {
  it('menampilkan pemakaian setelah Pengeluaran tercatat (FR-085)', async () => {
    const { repo } = fakeRepo(150_000, 175_000);
    const text = await run('/pengeluaran makan siang 25rb', repo);

    expect(text).toContain('Budget hari ini: 175.000 / 150.000 (sisa -25.000)');
  });

  it('baris Budget datang setelah baris saldo (FR-085)', async () => {
    const { repo } = fakeRepo(150_000, 25_000);
    const lines = (await run('/pengeluaran makan siang 25rb', repo)).split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Budget hari ini: 25.000 / 150.000');
  });

  it('tidak menampilkan apa pun bila belum ada Budget (FR-088)', async () => {
    const { repo } = fakeRepo(null, 25_000);
    const text = await run('/pengeluaran makan siang 25rb', repo);

    expect(text).not.toContain('Budget');
  });

  it('Pemasukan tidak menampilkan pemakaian Budget (FR-084, FR-085)', async () => {
    const { repo } = fakeRepo(150_000, 25_000);
    const text = await run('/pemasukan gaji 5jt', repo);

    expect(text).not.toContain('Budget');
  });

  it('tidak ada peringatan di bawah 80% (FR-086)', async () => {
    const { repo } = fakeRepo(100_000, 79_999);
    const text = await run('/pengeluaran makan siang 25rb', repo);

    expect(text).toContain('Budget hari ini');
    expect(text).not.toContain('Peringatan');
  });

  it('peringatan lembut mulai tepat 80% (FR-086, A2)', async () => {
    const { repo } = fakeRepo(100_000, 80_000);
    const text = await run('/pengeluaran makan siang 25rb', repo);

    expect(text).toContain('Peringatan: pemakaian budget hari ini 80%.');
    expect(text).not.toContain('terlampaui');
  });

  it('tepat 100% masih peringatan lembut (FR-086)', async () => {
    const { repo } = fakeRepo(100_000, 100_000);
    const text = await run('/pengeluaran makan siang 25rb', repo);

    expect(text).toContain('Peringatan: pemakaian budget hari ini 100%.');
    expect(text).not.toContain('terlampaui');
  });

  it('lewat 100% memberi peringatan keras (FR-086)', async () => {
    const { repo } = fakeRepo(150_000, 175_000);
    const text = await run('/pengeluaran makan siang 25rb', repo);

    expect(text).toContain('Peringatan: pemakaian budget hari ini 116% — budget harian terlampaui.');
  });

  it('/edit dan /hapus tidak menampilkan baris Budget', async () => {
    const expense: Transaction = {
      id: 1,
      type: 'expense',
      account: 'tunai',
      toAccount: null,
      amount: 25_000,
      description: 'makan siang',
    };
    const edited = fakeRepo(100_000, 25_000, { editTransaction: async () => expense });
    expect(await run('/edit 1 makan malam 30rb', edited.repo)).not.toContain('Budget');

    const deleted = fakeRepo(100_000, 25_000, { deleteTransaction: async () => expense });
    expect(await run('/hapus 1', deleted.repo)).not.toContain('Budget');
  });
});
