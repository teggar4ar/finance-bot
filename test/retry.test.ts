import { describe, expect, it, vi } from 'vitest';
import { Api, HttpError } from 'grammy';
import { getMeWithRetry } from '../src/telegram';

describe('getMeWithRetry', () => {
  it('mencoba ulang sekali untuk HttpError lalu berhasil', async () => {
    const error = new HttpError("Network request for 'getMe' failed!", { code: 'ECONNRESET' });
    let calls = 0;
    const api = { getMe: () => { calls++; return calls === 1 ? Promise.reject(error) : Promise.resolve({ ok: true }); } } as unknown as Api;

    await expect(getMeWithRetry(api)).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('tidak mencoba ulang GrammyError / error non-jaringan', async () => {
    const getMe = vi.fn().mockRejectedValue(new Error('Unauthorized'));
    await expect(getMeWithRetry({ getMe } as unknown as Api)).rejects.toThrow('Unauthorized');
    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it('melempar error setelah retry kedua gagal', async () => {
    const error = new HttpError('down', { code: 'ECONNRESET' });
    const getMe = vi.fn().mockRejectedValue(error);
    await expect(getMeWithRetry({ getMe } as unknown as Api)).rejects.toBe(error);
    expect(getMe).toHaveBeenCalledTimes(2);
  });
});
