import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/command';
import type { Deps } from '../src/execute';
import { execute } from '../src/execute';
import type { Account, Balances, Repo } from '../src/repo';
import { HINT } from '../src/text';
import { fakeRepo } from './fake-repo';

interface Recorded {
  account: Account;
  type: 'expense' | 'income';
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
      setOpeningBalance: async (account, amount) => {
        balances[account] = amount;
        return nextId++;
      },
      getBalances: async () => ({ ...balances }),
      async addExpenseOrIncome(account, type, amount, description) {
        entries.push({ account, type, amount, description });
        balances[account] += type === 'expense' ? -amount : amount;
        return nextId++;
      },
      addTransfer: async () => nextId++,
    }),
  };
}

const deps = (repo: Repo): Deps => ({ now: () => new Date('2026-11-03T01:00:00Z'), repo });
const run = async (text: string, repo: Repo): Promise<string> =>
  (await execute(parseCommand(text), deps(repo))) as string;

describe('/pengeluaran', () => {
  it('mencatat Pengeluaran di tunai secara default (FR-030, FR-032)', async () => {
    const { repo, entries } = memoryRepo({ tunai: 20_000_000, bank: 0 });
    const text = await run('/pengeluaran makan siang 25rb', repo);

    expect(entries).toEqual([{ account: 'tunai', type: 'expense', amount: 2_500_000, description: 'makan siang' }]);
    expect(text).toContain('Pengeluaran');
    expect(text).toContain('makan siang');
    expect(text).toContain('25.000');
    expect(text).toContain('tunai');
    expect(text).toContain('ID: <code>1</code>');
    expect(text).toContain('Saldo tunai: <code>175.000</code>');
  });

  it('mencatat dari bank lewat flag @bank (FR-032)', async () => {
    const { repo, entries } = memoryRepo({ tunai: 0, bank: 100_000_000 });
    const text = await run('/pengeluaran spotify 55rb @bank', repo);

    expect(entries).toEqual([{ account: 'bank', type: 'expense', amount: 5_500_000, description: 'spotify' }]);
    expect(text).toContain('Saldo bank: <code>945.000</code>');
  });

  it('menerima flag @tunai eksplisit (FR-032)', async () => {
    const { repo, entries } = memoryRepo();
    await run('/pengeluaran parkir 5rb @tunai', repo);

    expect(entries[0]?.account).toBe('tunai');
    expect(entries[0]?.amount).toBe(500_000);
  });

  it('Nominal adalah token terakhir sebelum flag; sisanya deskripsi (FR-033)', async () => {
    const { repo, entries } = memoryRepo();
    await run('/pengeluaran bayar kos 2 bulan 3jt', repo);

    expect(entries[0]).toEqual({
      account: 'tunai',
      type: 'expense',
      amount: 300_000_000,
      description: 'bayar kos 2 bulan',
    });
  });

  it('menerima prefix Rp tanpa memasukkannya ke deskripsi (FR-034)', async () => {
    const { repo, entries } = memoryRepo();
    const text = await run('/pengeluaran kopi Rp 25.000', repo);

    expect(entries[0]?.amount).toBe(2_500_000);
    expect(entries[0]?.description).toBe('kopi');
    expect(text).toContain('kopi');
  });

  it('memunculkan peringatan bila saldo akun menjadi negatif (FR-022)', async () => {
    const { repo } = memoryRepo({ tunai: 1_000_000, bank: 0 });
    const text = await run('/pengeluaran makan siang 25rb', repo);

    expect(text).toContain('<blockquote>⚠️ <i>Saldo tunai negatif.</i></blockquote>');
    expect(text.split('\n').at(-1)).toBe('<blockquote>⚠️ <i>Saldo tunai negatif.</i></blockquote>');
  });

  it('membalas bentuk multi-baris: status, detail, ID, saldo (FR-038)', async () => {
    const { repo } = memoryRepo({ tunai: 20_000_000, bank: 0 });
    const text = await run('/pengeluaran makan siang 25rb', repo);

    expect(text).toBe(
      [
        '✅ <b>Pengeluaran tercatat</b>',
        '',
        'ID: <code>1</code>',
        'makan siang',
        'Nominal: <code>25.000</code>',
        'Akun: tunai',
        '',
        'Saldo tunai: <code>175.000</code>',
      ].join('\n'),
    );
  });

  it('mencatat dan menampilkan Pengeluaran ber-sen (ADR-0005)', async () => {
    const { repo, entries } = memoryRepo({ tunai: 20_000_000, bank: 0 });
    const text = await run('/pengeluaran makan siang 25.000,50', repo);

    expect(entries).toEqual([{ account: 'tunai', type: 'expense', amount: 2_500_050, description: 'makan siang' }]);
    expect(text).toContain('Nominal: <code>25.000,50</code>');
    expect(text).toContain('Saldo tunai: <code>174.999,50</code>');
  });

  it('penolakan memakai Format: dan Contoh: di baris terpisah (NFR-061)', async () => {
    const { repo } = memoryRepo();
    const text = await run('/pengeluaran 25rb', repo);

    expect(text).toBe(
      [
        '<b>Format:</b> <code>/pengeluaran &lt;deskripsi&gt; &lt;nominal&gt; [@bank|@tunai]</code>',
        '',
        '<b>Contoh:</b> <code>/pengeluaran makan siang 25rb</code>',
      ].join('\n'),
    );
  });

  it('meng-escape deskripsi yang memuat < > & agar terkirim utuh (HTML parse_mode)', async () => {
    const { repo } = memoryRepo({ tunai: 20_000_000, bank: 0 });
    const text = await run('/pengeluaran beli <kabel> & adaptor 25rb', repo);

    expect(text).toContain('beli &lt;kabel&gt; &amp; adaptor');
    expect(text).not.toContain('<kabel>');
  });

  it.each([
    ['/pengeluaran', 'tanpa argumen'],
    ['/pengeluaran 25rb', 'tanpa deskripsi'],
    ['/pengeluaran makan siang', 'tanpa Nominal'],
    ['/pengeluaran makan 1.5', 'Nominal tidak sah'],
    ['/pengeluaran makan 0', 'Nominal nol'],
    ['/pengeluaran makan 25rb @dompet', 'Akun tidak dikenal'],
    ['/pengeluaran makan @bank 25rb', 'flag Akun bukan di akhir'],
    ['/pengeluaran 25rb makan', 'token terakhir bukan Nominal'],
  ])('%s ditolak dengan petunjuk dan tanpa menulis (%s)', async (line) => {
    const { repo, entries } = memoryRepo();
    const text = await run(line, repo);

    expect(entries).toEqual([]);
    expect(text).toContain('/pengeluaran makan siang 25rb');
  });
});

describe('/pemasukan', () => {
  it('mencatat Pemasukan ke bank lewat @bank (FR-031)', async () => {
    const { repo, entries } = memoryRepo({ tunai: 0, bank: 10_000_000 });
    const text = await run('/pemasukan gaji 5jt @bank', repo);

    expect(entries).toEqual([{ account: 'bank', type: 'income', amount: 500_000_000, description: 'gaji' }]);
    expect(text).toContain('Pemasukan');
    expect(text).toContain('gaji');
    expect(text).toContain('5.000.000');
    expect(text).toContain('bank');
    expect(text).toContain('Saldo bank: <code>5.100.000</code>');
  });

  it('default ke tunai (FR-032)', async () => {
    const { repo, entries } = memoryRepo();
    await run('/pemasukan jual sepeda 500rb', repo);

    expect(entries[0]?.account).toBe('tunai');
    expect(entries[0]?.type).toBe('income');
  });

  it('menolak masukan tidak sah tanpa menulis (FR-035)', async () => {
    const { repo, entries } = memoryRepo();
    const text = await run('/pemasukan 5jt', repo);

    expect(entries).toEqual([]);
    expect(text).toContain('/pemasukan gaji 5jt @bank');
  });
});

describe('alias /k dan /m (FR-030, FR-031)', () => {
  it.each([
    ['/k makan siang 25rb', '/pengeluaran makan siang 25rb'],
    ['/k spotify 55rb @bank', '/pengeluaran spotify 55rb @bank'],
    ['/m gaji 5jt @bank', '/pemasukan gaji 5jt @bank'],
    ['/k makan 1.5', '/pengeluaran makan 1.5'],
    ['/m 5jt', '/pemasukan 5jt'],
  ])('%s berperilaku persis seperti %s', async (alias, canonical) => {
    const viaAlias = memoryRepo({ tunai: 200_000, bank: 100_000 });
    const viaCommand = memoryRepo({ tunai: 200_000, bank: 100_000 });

    expect(await run(alias, viaAlias.repo)).toBe(await run(canonical, viaCommand.repo));
    expect(viaAlias.entries).toEqual(viaCommand.entries);
  });

  it('tidak ada alias di luar /k dan /m', async () => {
    const { repo, entries } = memoryRepo();
    // /p dan /keluar adalah alternatif yang ditolak ADR-0004; dikunci di sini.
    for (const line of ['/s', '/p', '/keluar']) expect(await run(line, repo)).toBe(HINT);
    expect(entries).toEqual([]);
  });
});
