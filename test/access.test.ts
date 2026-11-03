import { describe, expect, it } from 'vitest';
import { isAllowedMessage } from '../src/telegram';

const ALLOWED = 42;

describe('isAllowedMessage', () => {
  it('menerima chat pribadi dari pengguna yang diizinkan', () => {
    expect(isAllowedMessage('private', ALLOWED, ALLOWED)).toBe(true);
  });

  it('mengabaikan pengguna lain (FR-002)', () => {
    expect(isAllowedMessage('private', ALLOWED + 1, ALLOWED)).toBe(false);
    expect(isAllowedMessage('private', undefined, ALLOWED)).toBe(false);
  });

  it('mengabaikan grup dan channel meski dari pengguna yang diizinkan (FR-003)', () => {
    expect(isAllowedMessage('group', ALLOWED, ALLOWED)).toBe(false);
    expect(isAllowedMessage('supergroup', ALLOWED, ALLOWED)).toBe(false);
    expect(isAllowedMessage('channel', ALLOWED, ALLOWED)).toBe(false);
  });

  it('mengabaikan chat tanpa tipe', () => {
    expect(isAllowedMessage(undefined, ALLOWED, ALLOWED)).toBe(false);
  });
});