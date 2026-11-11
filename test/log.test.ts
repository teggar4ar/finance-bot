import { describe, expect, it } from 'vitest';
import { describeError } from '../src/log';

describe('describeError', () => {
  it('meredaksi token (NFR-002)', () => {
    expect(describeError(new Error('url https://x/bot123:abc/getMe'), '123:abc')).toBe(
      'url https://x/bot<redacted>/getMe',
    );
  });

  it('menyertakan kode penyebab dari HttpError grammY (detail jaringan tidak disembunyikan)', () => {
    const error = Object.assign(new Error("Network request for 'getMe' failed!"), {
      error: { code: 'ECONNRESET' },
    });
    expect(describeError(error)).toBe("Network request for 'getMe' failed! (cause=ECONNRESET)");
  });

  it('tanpa kode penyebab: pesan apa adanya', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });
});
