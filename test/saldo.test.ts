import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/command';
import type { Deps } from '../src/execute';
import { execute } from '../src/execute';
import type { Account, Balances, Repo } from '../src/repo';

function memoryRepo(initial: Balances = { tunai: 0, bank: 0 }): {
  repo: Repo;
  openings: Partial<Record<Account, number>>;
} {
  const openings: Partial<Record<Account, number>> = {};
  for (const account of ['tunai', 'bank'] as const) {
    if (initial[account] !== 0) openings[account] = initial[account];
  }
  let nextId = 1;

  return {
    openings,
    repo: {
      async setOpeningBalance(account, amount) {
        openings[account] = amount;
        return nextId++;
      },
      addExpenseOrIncome: async () => 0,
      addTransfer: async () => 0,
      async getBalances() {
        return { tunai: openings.tunai ?? 0, bank: openings.bank ?? 0 };
      },
      undoLast: async () => null,
      redoLast: async () => null,
      getHistory: async () => [],
      editTransaction: async () => null,
      deleteTransaction: async () => null,
    },
  };
}

const deps = (repo: Repo): Deps => ({ now: () => new Date('2026-11-03T01:00:00Z'), repo });
const run = (text: string, repo: Repo): Promise<string> => execute(parseCommand(text), deps(repo));

describe('/saldo', () => {
  it('menampilkan tunai, bank, dan total; akun kosong dianggap 0 (FR-020)', async () => {
    const text = await run('/saldo', memoryRepo().repo);
    expect(text).toBe(['Saldo tunai: 0', 'Saldo bank: 0', 'Total: 0'].join('\n'));
  });

  it('menjumlahkan total dari kedua akun', async () => {
    const text = await run('/saldo', memoryRepo({ tunai: 25_000, bank: 1_500_000 }).repo);
    expect(text).toBe(['Saldo tunai: 25.000', 'Saldo bank: 1.500.000', 'Total: 1.525.000'].join('\n'));
  });

  it('memunculkan peringatan bila ada saldo negatif (FR-022)', async () => {
    const text = await run('/saldo', memoryRepo({ tunai: -25_000, bank: 10_000 }).repo);
    expect(text).toContain('Peringatan');
    expect(text).toContain('tunai');
    expect(text).toContain('-25.000');
  });
});

describe('/saldo_awal', () => {
  it('menyimpan saldo awal tunai dan membalas ID serta saldo terbaru (FR-011)', async () => {
    const { repo, openings } = memoryRepo();
    const text = await run('/saldo_awal tunai 200rb', repo);

    expect(openings.tunai).toBe(200_000);
    expect(text).toContain('ID 1');
    expect(text).toContain('Saldo tunai: 200.000');
  });

  it('bekerja untuk akun bank', async () => {
    const { repo, openings } = memoryRepo();
    const text = await run('/saldo_awal bank 5jt', repo);

    expect(openings.bank).toBe(5_000_000);
    expect(text).toContain('Saldo bank: 5.000.000');
  });

  it('menerima format Rp dengan spasi', async () => {
    const { repo, openings } = memoryRepo();
    await run('/saldo_awal tunai Rp 25.000', repo);
    expect(openings.tunai).toBe(25_000);
  });

  it('menetapkan ulang mengganti nilai lama (FR-013)', async () => {
    const { repo, openings } = memoryRepo();
    await run('/saldo_awal tunai 200rb', repo);
    const text = await run('/saldo_awal tunai 300rb', repo);

    expect(openings.tunai).toBe(300_000);
    expect(text).toContain('Saldo tunai: 300.000');
    expect(await run('/saldo', repo)).toContain('Saldo tunai: 300.000');
  });

  it('memunculkan peringatan bila saldo akun negatif setelah ditulis (FR-022)', async () => {
    const repo: Repo = {
      setOpeningBalance: async () => 7,
      addExpenseOrIncome: async () => 7,
      addTransfer: async () => 7,
      getBalances: async () => ({ tunai: -1_000, bank: 0 }),
      undoLast: async () => null,
      redoLast: async () => null,
      getHistory: async () => [],
      editTransaction: async () => null,
      deleteTransaction: async () => null,
    };
    const text = await run('/saldo_awal tunai 200rb', repo);

    expect(text).toContain('ID 7');
    expect(text).toContain('Peringatan');
    expect(text).toContain('tunai');
  });

  it('menolak Nominal tidak sah tanpa menulis apa pun (FR-035)', async () => {
    const { repo, openings } = memoryRepo();
    const text = await run('/saldo_awal tunai 1,5', repo);

    expect(openings).toEqual({});
    expect(text).toContain('/saldo_awal tunai 200rb');
  });

  it('menolak akun di luar tunai dan bank (FR-010)', async () => {
    const { repo, openings } = memoryRepo();
    const text = await run('/saldo_awal dompet 25rb', repo);

    expect(openings).toEqual({});
    expect(text).toContain('/saldo_awal tunai 200rb');
  });

  it('menolak argumen yang kurang', async () => {
    const { repo, openings } = memoryRepo();
    expect(await run('/saldo_awal tunai', repo)).toContain('/saldo_awal tunai 200rb');
    expect(await run('/saldo_awal', repo)).toContain('/saldo_awal tunai 200rb');
    expect(openings).toEqual({});
  });
});