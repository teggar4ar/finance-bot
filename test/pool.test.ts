import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPool } from '../src/db/pool';

describe('createPool error listener (audit U13)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('menangani error pool tanpa melempar, dan mencatatnya (worker tidak mati)', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const pool = createPool('postgres://user:pass@localhost:5432/keuangan');

    expect(() => pool.emit('error', new Error('idle connection reset'))).not.toThrow();
    expect(write.mock.calls.flat().join('')).toContain('pool_error');
  });
});
