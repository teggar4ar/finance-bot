import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Transformer } from 'grammy';
import type { Deps } from '../src/execute';
import { createBot } from '../src/telegram';
import { fakeRepo } from './fake-repo';

interface Call {
  method: string;
  payload: Record<string, unknown>;
}

const deps: Deps = { now: () => new Date('2026-11-03T01:00:00Z'), repo: fakeRepo() };

/** Pesan pribadi dari satu Telegram user (FR-001, FR-003). */
const update = (text: string, fromId = 42) => ({
  update_id: 1,
  message: {
    message_id: 1,
    date: 0,
    chat: { id: fromId, type: 'private', first_name: 'x' },
    from: { id: fromId, is_bot: false, first_name: 'x' },
    text,
  },
});

/** Bot siap-update + panggilan API ditangkap ke array, bukan ke jaringan. */
function readyBot(makeDeps: (owner: number) => Deps = () => deps): { bot: ReturnType<typeof createBot>; calls: Call[] } {
  const bot = createBot('123:abc', [42, 99], makeDeps);
  bot.botInfo = { id: 1, is_bot: true, first_name: 'Test', username: 'test_bot' } as never;

  const calls: Call[] = [];
  const capture: Transformer = (_prev, method, payload) => {
    calls.push({ method: String(method), payload: payload as Record<string, unknown> });
    return Promise.resolve({ ok: true, result: true }) as never;
  };
  bot.api.config.use(capture);

  return { bot, calls };
}

describe('adapter Telegram', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mengirim balasan teks dengan parse_mode HTML (isi ber-tag)', async () => {
    const { bot, calls } = readyBot();

    await bot.handleUpdate(update('/saldo') as never);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('sendMessage');
    expect(calls[0]?.payload.parse_mode).toBe('HTML');
    expect(String(calls[0]?.payload.text)).toContain('<b>');
  });

  it('mengirim caption /export dengan parse_mode HTML', async () => {
    const { bot, calls } = readyBot();

    await bot.handleUpdate(update('/export') as never);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('sendDocument');
    expect(calls[0]?.payload.parse_mode).toBe('HTML');
  });

  it('membangun deps per Pengguna dari ctx.from.id', async () => {
    const owners: number[] = [];
    const { bot } = readyBot((owner) => {
      owners.push(owner);
      return deps;
    });

    await bot.handleUpdate(update('/saldo', 42) as never);
    await bot.handleUpdate(update('/saldo', 99) as never);

    expect(owners).toEqual([42, 99]);
  });

  it('tiap Pengguna hanya melihat saldo bukunya sendiri (FR-001, ADR-0007)', async () => {
    // Saldo berbeda per owner: 42 -> Rp 42.000, 99 -> Rp 99.000.
    const { bot, calls } = readyBot((owner) => ({
      now: () => new Date('2026-11-03T01:00:00Z'),
      repo: fakeRepo({ getBalances: async () => ({ tunai: owner * 100_000, bank: 0 }) }),
    }));

    await bot.handleUpdate(update('/saldo', 42) as never);
    await bot.handleUpdate(update('/saldo', 99) as never);

    const [mine, theirs] = calls.map((call) => String(call.payload.text));
    expect(mine).toContain('42.000');
    expect(mine).not.toContain('99.000');
    expect(theirs).toContain('99.000');
    expect(theirs).not.toContain('42.000');
  });

  it('mengabaikan pesan dari pengguna di luar allowlist tanpa balasan & tanpa akses data (FR-002)', async () => {
    const owners: number[] = [];
    const { bot, calls } = readyBot((owner) => {
      owners.push(owner);
      return deps;
    });

    await bot.handleUpdate(update('/saldo', 7) as never);

    expect(calls).toHaveLength(0);
    expect(owners).toEqual([]);
  });

  it('mencatat user= pada log command (bukan isi pesan)', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const { bot } = readyBot();

    await bot.handleUpdate(update('/pengeluaran rahasia 10000', 42) as never);

    const logged = write.mock.calls.flat().join('');
    expect(logged).toContain('command');
    expect(logged).toContain('user=42');
    expect(logged).not.toContain('rahasia');
  });

  it('mencatat user= pada log command_failed', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const failing: Deps = {
      now: () => new Date('2026-11-03T01:00:00Z'),
      repo: fakeRepo({ getBalances: async () => { throw new Error('boom'); } }),
    };
    const { bot } = readyBot(() => failing);

    await bot.handleUpdate(update('/saldo', 42) as never);

    const logged = write.mock.calls.flat().join('');
    expect(logged).toContain('command_failed');
    expect(logged).toContain('user=42');
  });
});
