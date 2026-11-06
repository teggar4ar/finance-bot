import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/command';
import type { Deps } from '../src/execute';
import { execute } from '../src/execute';
import type { HistoryTransaction, Repo, Transaction } from '../src/repo';
import { fakeRepo as baseRepo } from './fake-repo';

interface Recorded {
  edited: { id: number; description: string; amount: number; account: string | null }[];
  deleted: number[];
}

function fakeRepo(overrides: Partial<Repo> = {}): { repo: Repo; recorded: Recorded } {
  const recorded: Recorded = { edited: [], deleted: [] };

  const base = baseRepo(overrides);

  const repo: Repo = {
    ...base,
    async editTransaction(id, description, amount, account) {
      recorded.edited.push({ id, description, amount, account });
      return base.editTransaction(id, description, amount, account);
    },
    async deleteTransaction(id) {
      recorded.deleted.push(id);
      return base.deleteTransaction(id);
    },
  };

  return { repo, recorded };
}

const deps = (repo: Repo): Deps => ({ now: () => new Date('2026-11-03T01:00:00Z'), repo });
const run = async (text: string, repo: Repo): Promise<string> =>
  (await execute(parseCommand(text), deps(repo))) as string;

const expense: HistoryTransaction = {
  id: 12,
  type: 'expense',
  account: 'tunai',
  toAccount: null,
  amount: 25_000,
  description: 'makan siang',
  occurredAt: new Date('2026-11-03T01:15:00Z'), // 08:15 WIB
};

describe('/riwayat', () => {
  it('menampilkan ID, jam WIB, jenis, akun, Nominal, dan deskripsi (FR-060)', async () => {
    const { repo } = fakeRepo({ getHistory: async () => [expense] });
    const text = await run('/riwayat', repo);

    expect(text).toContain('#12');
    expect(text).toContain('03/11 08:15');
    expect(text).toContain('💸 Pengeluaran');
    expect(text).toContain('tunai');
    expect(text).toContain('25.000');
    expect(text).toContain('makan siang');
  });

  it('menampilkan Transfer sebagai bank -> tunai (FR-060)', async () => {
    const { repo } = fakeRepo({
      getHistory: async () => [
        {
          id: 11,
          type: 'transfer',
          account: 'bank',
          toAccount: 'tunai',
          amount: 500_000,
          description: 'Transfer bank ke tunai',
          occurredAt: new Date('2026-11-03T00:00:00Z'),
        },
      ],
    });
    const text = await run('/riwayat', repo);

    expect(text).toContain('bank -> tunai');
    expect(text).toContain('500.000');
  });

  it('menampilkan Saldo awal sebagai saldo awal (FR-060)', async () => {
    const { repo } = fakeRepo({
      getHistory: async () => [
        {
          id: 1,
          type: 'opening',
          account: 'tunai',
          toAccount: null,
          amount: 200_000,
          description: 'Saldo awal',
          occurredAt: new Date('2026-11-01T02:00:00Z'),
        },
      ],
    });
    const text = await run('/riwayat', repo);

    expect(text).toContain('Saldo awal tunai · 200.000');
  });

  it('meminta 10 Transaksi terakhir (FR-060)', async () => {
    let requested = 0;
    const { repo } = fakeRepo({
      getHistory: async (limit) => {
        requested = limit;
        return [];
      },
    });
    await run('/riwayat', repo);

    expect(requested).toBe(10);
  });

  it('mengatakan belum ada Transaksi', async () => {
    const { repo } = fakeRepo();
    expect(await run('/riwayat', repo)).toBe(
      ['Belum ada transaksi.', 'Catat dengan /pengeluaran atau /pemasukan.'].join('\n'),
    );
  });
});

describe('/edit', () => {
  const edited: Transaction = {
    id: 12,
    type: 'expense',
    account: 'bank',
    toAccount: null,
    amount: 30_000,
    description: 'makan malam',
  };

  it('mengubah deskripsi, Nominal, dan akun Pengeluaran (FR-061)', async () => {
    const { repo, recorded } = fakeRepo({
      editTransaction: async () => edited,
      getBalances: async () => ({ tunai: 170_000, bank: 1_000_000 }),
    });
    const text = await run('/edit 12 makan malam 30rb @bank', repo);

    expect(recorded.edited).toEqual([{ id: 12, description: 'makan malam', amount: 30_000, account: 'bank' }]);
    expect(text).toContain('Transaksi diubah');
    expect(text).toContain('makan malam');
    expect(text).toContain('30.000');
  });

  it('tanpa flag Akun membiarkan akun lama (FR-061)', async () => {
    const { repo, recorded } = fakeRepo({ editTransaction: async () => ({ ...edited, account: 'tunai' }) });
    await run('/edit 12 makan malam 30rb', repo);

    expect(recorded.edited).toEqual([{ id: 12, description: 'makan malam', amount: 30_000, account: null }]);
  });

  it('membalas saldo akun terpengaruh (FR-064)', async () => {
    const { repo } = fakeRepo({
      editTransaction: async () => edited,
      getBalances: async () => ({ tunai: 170_000, bank: 1_000_000 }),
    });
    const text = await run('/edit 12 makan malam 30rb @bank', repo);

    expect(text).toContain('Saldo tunai: 170.000');
    expect(text).toContain('Saldo bank: 1.000.000');
  });

  it('menolak Transfer dan Saldo awal dengan pesan jelas (FR-065)', async () => {
    const { repo } = fakeRepo({ editTransaction: async () => null });
    const text = await run('/edit 11 makan malam 30rb', repo);

    expect(text).toContain('ID 11');
    expect(text).toContain('bukan Pengeluaran/Pemasukan');
    expect(text).toContain('/edit');
  });

  it.each(['/edit', '/edit 12', '/edit 12 makan malam', '/edit 12 makan malam 30rb @dompet', '/edit abc makan 30rb'])(
    'menolak masukan tidak sah %s (FR-061)',
    async (text) => {
      const { repo, recorded } = fakeRepo();
      expect(await run(text, repo)).toContain('/edit');
      expect(recorded.edited).toEqual([]);
    },
  );

  it('memperingatkan bila Akun jadi negatif (FR-022)', async () => {
    const { repo } = fakeRepo({
      editTransaction: async () => edited,
      getBalances: async () => ({ tunai: -5_000_000, bank: 0 }),
    });
    const text = await run('/edit 12 makan malam 30rb', repo);

    expect(text).toContain('Peringatan');
    expect(text).toContain('tunai');
  });
});

describe('/hapus', () => {
  it('menghapus Transaksi aktif dan membalas saldo terbaru (FR-062, FR-064)', async () => {
    const { repo, recorded } = fakeRepo({
      deleteTransaction: async () => ({ ...expense, type: 'expense' }),
      getBalances: async () => ({ tunai: 200_000, bank: 0 }),
    });
    const text = await run('/hapus 12', repo);

    expect(recorded.deleted).toEqual([12]);
    expect(text).toContain('Transaksi dihapus');
    expect(text).toContain('makan siang');
    expect(text).toContain('Saldo tunai: 200.000');
  });

  it('membalas kedua Akun saat Transfer dihapus (FR-064)', async () => {
    const { repo } = fakeRepo({
      deleteTransaction: async () => ({
        id: 11,
        type: 'transfer',
        account: 'bank',
        toAccount: 'tunai',
        amount: 500_000,
        description: 'Transfer bank ke tunai',
      }),
      getBalances: async () => ({ tunai: 200_000, bank: 5_000_000 }),
    });
    const text = await run('/hapus 11', repo);

    expect(text).toContain('Saldo bank: 5.000.000');
    expect(text).toContain('Saldo tunai: 200.000');
  });

  it('ID tidak ada atau sudah Dihapus dibalas error jelas (FR-063)', async () => {
    const { repo } = fakeRepo({ deleteTransaction: async () => null });
    const text = await run('/hapus 99', repo);

    expect(text).toContain('Tidak ada Transaksi aktif dengan ID 99');
    expect(text).toContain('/hapus');
  });

  it.each(['/hapus', '/hapus abc', '/hapus 12 13'])('menolak masukan tidak sah %s', async (text) => {
    const { repo, recorded } = fakeRepo();
    expect(await run(text, repo)).toContain('/hapus');
    expect(recorded.deleted).toEqual([]);
  });

  it('memperingatkan bila Akun jadi negatif (FR-022)', async () => {
    const { repo } = fakeRepo({
      deleteTransaction: async () => ({ ...expense, type: 'income', description: 'gaji' }),
      getBalances: async () => ({ tunai: -50_000, bank: 0 }),
    });
    const text = await run('/hapus 12', repo);

    expect(text).toContain('Peringatan');
    expect(text).toContain('tunai');
  });
});
