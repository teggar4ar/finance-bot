import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/command';
import type { Deps } from '../src/execute';
import { execute } from '../src/execute';
import type { Account, Balances, Repo } from '../src/repo';
import { fakeRepo } from './fake-repo';

interface Recorded {
  from: Account;
  to: Account;
  amount: number;
  description: string;
}

function memoryRepo(initial: Balances = { tunai: 0, bank: 0 }): { repo: Repo; entries: Recorded[] } {
  const balances: Balances = { ...initial };
  const entries: Recorded[] = [];
  let nextId = 1;

  return {
    entries,
    repo: fakeRepo({
      setOpeningBalance: async () => nextId++,
      addExpenseOrIncome: async () => nextId++,
      getBalances: async () => ({ ...balances }),
      async addTransfer(from, to, amount, description) {
        entries.push({ from, to, amount, description });
        balances[from] -= amount;
        balances[to] += amount;
        return nextId++;
      },
    }),
  };
}

const deps = (repo: Repo): Deps => ({ now: () => new Date('2026-11-03T01:00:00Z'), repo });
const run = async (text: string, repo: Repo): Promise<string> =>
  (await execute(parseCommand(text), deps(repo))) as string;

describe('/transfer', () => {
  it('memindahkan Nominal dari akun asal ke akun tujuan (FR-036)', async () => {
    const { repo, entries } = memoryRepo({ tunai: 200_000, bank: 5_000_000 });
    const text = await run('/transfer bank tunai 500rb', repo);

    expect(entries).toEqual([{ from: 'bank', to: 'tunai', amount: 500_000, description: 'Transfer bank ke tunai' }]);
    expect(text).toContain('Transfer bank ke tunai');
    expect(text).toContain('500.000');
    expect(text).toContain('ID 1');
  });

  it('membalas saldo kedua akun setelah Transfer (FR-038)', async () => {
    const { repo } = memoryRepo({ tunai: 200_000, bank: 5_000_000 });
    const text = await run('/transfer bank tunai 500rb', repo);

    expect(text).toContain('Saldo bank: 4.500.000');
    expect(text).toContain('Saldo tunai: 700.000');
  });

  it('membalas bentuk multi-baris: status, detail, ID, kedua saldo (FR-038)', async () => {
    const { repo } = memoryRepo({ tunai: 200_000, bank: 5_000_000 });
    const text = await run('/transfer bank tunai 500rb', repo);

    expect(text).toBe(
      [
        '✅ Transfer tercatat',
        '🔁 Transfer bank ke tunai · 500.000',
        'ID 1',
        'Saldo bank: 4.500.000',
        'Saldo tunai: 700.000',
      ].join('\n'),
    );
  });

  it('tidak mengubah total saldo (FR-037)', async () => {
    const { repo } = memoryRepo({ tunai: 200_000, bank: 5_000_000 });
    const total = async () => (await run('/saldo', repo)).split('\n').find((line) => line.startsWith('Total:'));

    const before = await total();
    await run('/transfer bank tunai 500rb', repo);

    expect(await total()).toBe(before);
  });

  it('menerima Nominal berprefix Rp dengan spasi (FR-034)', async () => {
    const { repo, entries } = memoryRepo({ tunai: 0, bank: 1_000_000 });
    await run('/transfer bank tunai Rp 25.000', repo);

    expect(entries[0]?.amount).toBe(25_000);
  });

  it('memunculkan peringatan bila akun asal menjadi negatif (FR-022)', async () => {
    const { repo } = memoryRepo({ tunai: 0, bank: 10_000 });
    const text = await run('/transfer bank tunai 25rb', repo);

    expect(text).toContain('Peringatan');
    expect(text).toContain('bank');
  });

  it('tidak memunculkan peringatan bila kedua akun tetap positif (FR-022)', async () => {
    const { repo } = memoryRepo({ tunai: 0, bank: 1_000_000 });
    expect(await run('/transfer bank tunai 500rb', repo)).not.toContain('Peringatan');
  });

  it('menolak Transfer ke akun yang sama dengan pesan jelas (FR-036)', async () => {
    const { repo, entries } = memoryRepo({ tunai: 500_000, bank: 500_000 });
    const text = await run('/transfer tunai tunai 100rb', repo);

    expect(entries).toEqual([]);
    expect(text).toContain('akun yang sama');
    expect(text).toContain('/transfer bank tunai 500rb');
  });

  it.each([
    ['/transfer', 'tanpa argumen'],
    ['/transfer bank', 'tanpa akun tujuan dan Nominal'],
    ['/transfer bank tunai', 'tanpa Nominal'],
    ['/transfer bank tunai 1,5', 'Nominal tidak sah'],
    ['/transfer bank tunai 0', 'Nominal nol'],
    ['/transfer dompet tunai 25rb', 'Akun asal tidak dikenal'],
    ['/transfer bank dompet 25rb', 'Akun tujuan tidak dikenal'],
    ['/transfer bank tunai 25rb jajan', 'token setelah Nominal'],
  ])('%s ditolak dengan petunjuk dan tanpa menulis (%s)', async (line) => {
    const { repo, entries } = memoryRepo({ tunai: 500_000, bank: 500_000 });
    const text = await run(line, repo);

    expect(entries).toEqual([]);
    expect(text).toContain('/transfer bank tunai 500rb');
  });
});
