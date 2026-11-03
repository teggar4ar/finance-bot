import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/command';

describe('parseCommand', () => {
  it('membaca command tanpa argumen', () => {
    expect(parseCommand('/help')).toEqual({ name: 'help', args: '' });
  });

  it('mempertahankan sisa pesan sebagai argumen', () => {
    expect(parseCommand('/pengeluaran makan siang 25rb')).toEqual({
      name: 'pengeluaran',
      args: 'makan siang 25rb',
    });
  });

  it('mengabaikan spasi di awal dan akhir', () => {
    expect(parseCommand('  /saldo  ')).toEqual({ name: 'saldo', args: '' });
  });

  it('membuang suffix @namabot', () => {
    expect(parseCommand('/help@finance_dev_bot')).toEqual({ name: 'help', args: '' });
  });

  it('menurunkan huruf besar', () => {
    expect(parseCommand('/HELP')).toEqual({ name: 'help', args: '' });
  });

  it('hanya memproses command pertama (FR-104)', () => {
    expect(parseCommand('/help /saldo')).toEqual({ name: 'help', args: '/saldo' });
  });

  it('menganggap teks biasa bukan command', () => {
    expect(parseCommand('halo')).toBeNull();
    expect(parseCommand('halo /help')).toBeNull();
    expect(parseCommand('')).toBeNull();
    expect(parseCommand('   ')).toBeNull();
  });

  it('menolak slash tanpa nama', () => {
    expect(parseCommand('/')).toBeNull();
  });
});