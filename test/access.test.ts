import { describe, expect, it } from 'vitest';
import { isAllowedMessage } from '../src/telegram';

const ALLOWED = [42, 99];

describe('isAllowedMessage', () => {
  it('menerima chat pribadi dari tiap pengguna terdaftar', () => {
    expect(isAllowedMessage('private', 42, ALLOWED)).toBe(true);
    expect(isAllowedMessage('private', 99, ALLOWED)).toBe(true);
  });

  it('mengabaikan pengguna di luar allowlist (FR-002)', () => {
    expect(isAllowedMessage('private', 43, ALLOWED)).toBe(false);
    expect(isAllowedMessage('private', undefined, ALLOWED)).toBe(false);
  });

  it('mengabaikan grup dan channel meski dari pengguna terdaftar (FR-003)', () => {
    expect(isAllowedMessage('group', 42, ALLOWED)).toBe(false);
    expect(isAllowedMessage('supergroup', 42, ALLOWED)).toBe(false);
    expect(isAllowedMessage('channel', 42, ALLOWED)).toBe(false);
  });

  it('mengabaikan chat tanpa tipe', () => {
    expect(isAllowedMessage(undefined, 42, ALLOWED)).toBe(false);
  });
});
