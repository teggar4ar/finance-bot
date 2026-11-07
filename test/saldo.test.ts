import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/command';
import type { Deps } from '../src/execute';
import { execute } from '../src/execute';
import type { Account, Balances, Repo } from '../src/repo';
import { fakeRepo } from './fake-repo';

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
    repo: fakeRepo({
      async setOpeningBalance(account, amount) {
        openings[account] = amount;
        return nextId++;
      },
      async getBalances() {
        return { tunai: openings.tunai ?? 0, bank: openings.bank ?? 0 };
      },
    }),
  };
}

const deps = (repo: Repo): Deps => ({ now: () => new Date('2026-11-03T01:00:00Z'), repo });
const run = async (text: string, repo: Repo): Promise<string> =>
  (await execute(parseCommand(text), deps(repo))) as string;

describe('/saldo', () => {
  it('menampilkan tunai, bank, dan total; akun kosong dianggap 0 (FR-020)', async () => {
    const text = await run('/saldo', memoryRepo().repo);
    expect(text).toBe(
      ['💰 <b>Saldo</b>', '', 'Tunai: <code>0</code>', 'Bank: <code>0</code>', 'Total: <b><code>0</code></b>'].join('\n'),
    );
  });

  it('menjumlahkan total dari kedua akun', async () => {
    const text = await run('/saldo', memoryRepo({ tunai: 2_500_000, bank: 150_000_000 }).repo);
    expect(text).toBe(
      [
        '💰 <b>Saldo</b>',
        '',
        'Tunai: <code>25.000</code>',
        'Bank: <code>1.500.000</code>',
        'Total: <b><code>1.525.000</code></b>',
      ].join('\n'),
    );
  });

  it('memunculkan peringatan bila ada saldo negatif (FR-022)', async () => {
    const text = await run('/saldo', memoryRepo({ tunai: -2_500_000, bank: 1_000_000 }).repo);
    expect(text).toContain('<blockquote>⚠️ <i>Saldo tunai negatif.</i></blockquote>');
    expect(text).toContain('<code>-25.000</code>');
  });

  it('menampilkan per-akun dan Total ber-sen (ADR-0005)', async () => {
    const text = await run('/saldo', memoryRepo({ tunai: 132_176_503, bank: 2_500_075 }).repo);
    expect(text).toBe(
      [
        '💰 <b>Saldo</b>',
        '',
        'Tunai: <code>1.321.765,03</code>',
        'Bank: <code>25.000,75</code>',
        'Total: <b><code>1.346.765,78</code></b>',
      ].join('\n'),
    );
  });
});

describe('/saldo_awal', () => {
  it('menyimpan saldo awal tunai dan membalas ID serta saldo terbaru (FR-011)', async () => {
    const { repo, openings } = memoryRepo();
    const text = await run('/saldo_awal tunai 200rb', repo);

    expect(openings.tunai).toBe(20_000_000);
    expect(text).toContain('ID: <code>1</code>');
    expect(text).toContain('Saldo tunai: <code>200.000</code>');
  });

  it('membalas bentuk multi-baris: status, detail, ID, saldo (FR-038)', async () => {
    const { repo } = memoryRepo();
    const text = await run('/saldo_awal tunai 200rb', repo);

    expect(text).toBe(
      [
        '✅ <b>Saldo awal tercatat</b>',
        '',
        'ID: <code>1</code>',
        'Akun: tunai',
        'Nominal: <code>200.000</code>',
        '',
        'Saldo tunai: <code>200.000</code>',
      ].join('\n'),
    );
  });

  it('bekerja untuk akun bank', async () => {
    const { repo, openings } = memoryRepo();
    const text = await run('/saldo_awal bank 5jt', repo);

    expect(openings.bank).toBe(500_000_000);
    expect(text).toContain('Saldo bank: <code>5.000.000</code>');
  });

  it('menerima format Rp dengan spasi', async () => {
    const { repo, openings } = memoryRepo();
    await run('/saldo_awal tunai Rp 25.000', repo);
    expect(openings.tunai).toBe(2_500_000);
  });

  it('menyimpan dan menampilkan nominal ber-sen (ADR-0005)', async () => {
    const { repo, openings } = memoryRepo();
    const text = await run('/saldo_awal bank 1.321.765,03', repo);

    expect(openings.bank).toBe(132_176_503);
    expect(text).toContain('✅ <b>Saldo awal tercatat</b>');
    expect(text).toContain('Nominal: <code>1.321.765,03</code>');
    expect(text).toContain('Saldo bank: <code>1.321.765,03</code>');
  });

  it('menetapkan ulang mengganti nilai lama (FR-013)', async () => {
    const { repo, openings } = memoryRepo();
    await run('/saldo_awal tunai 200rb', repo);
    const text = await run('/saldo_awal tunai 300rb', repo);

    expect(openings.tunai).toBe(30_000_000);
    expect(text).toContain('Saldo tunai: <code>300.000</code>');
    expect(await run('/saldo', repo)).toContain('Tunai: <code>300.000</code>');
  });

  it('memunculkan peringatan bila saldo akun negatif setelah ditulis (FR-022)', async () => {
    const repo = fakeRepo({
      setOpeningBalance: async () => 7,
      addExpenseOrIncome: async () => 7,
      addTransfer: async () => 7,
      getBalances: async () => ({ tunai: -100_000, bank: 0 }),
    });
    const text = await run('/saldo_awal tunai 200rb', repo);

    expect(text).toContain('ID: <code>7</code>');
    expect(text).toContain('<blockquote>⚠️ <i>Saldo tunai negatif.</i></blockquote>');
  });

  it('menolak Nominal tidak sah tanpa menulis apa pun (FR-035)', async () => {
    const { repo, openings } = memoryRepo();
    const text = await run('/saldo_awal tunai 1.5', repo);

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