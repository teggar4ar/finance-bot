import { describe, expect, it } from 'vitest';
import type { Transformer } from 'grammy';
import type { Deps } from '../src/execute';
import { createBot } from '../src/telegram';
import { fakeRepo } from './fake-repo';

interface Call {
  method: string;
  payload: Record<string, unknown>;
}

const deps: Deps = { now: () => new Date('2026-11-03T01:00:00Z'), repo: fakeRepo() };

/** Pesan pribadi dari pengguna yang diizinkan (FR-001, FR-003). */
const update = (text: string) => ({
  update_id: 1,
  message: {
    message_id: 1,
    date: 0,
    chat: { id: 42, type: 'private', first_name: 'x' },
    from: { id: 42, is_bot: false, first_name: 'x' },
    text,
  },
});

/** Bot siap-update + panggilan API ditangkap ke array, bukan ke jaringan. */
function readyBot(): { bot: ReturnType<typeof createBot>; calls: Call[] } {
  const bot = createBot('123:abc', 42, deps);
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
});
