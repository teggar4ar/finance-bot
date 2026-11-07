import { describe, expect, it } from 'vitest';
import { bold, code, esc, warning } from '../src/reply';

describe('esc', () => {
  it('meng-escape < > & (penjaga jalur galat 400 parse entities)', () => {
    expect(esc('beli <kabel> & adaptor')).toBe('beli &lt;kabel&gt; &amp; adaptor');
  });

  it('meng-escape & lebih dulu agar tidak menggandakan tag yang dihasilkan', () => {
    expect(esc('&lt;')).toBe('&amp;lt;');
  });
});

describe('code', () => {
  it('membungkus dan meng-escape isinya', () => {
    expect(code('/edit <id>')).toBe('<code>/edit &lt;id&gt;</code>');
  });
});

describe('bold', () => {
  it('membungkus tanpa mengubah isi statis', () => {
    expect(bold('Saldo')).toBe('<b>Saldo</b>');
  });
});

describe('warning', () => {
  it('membungkus peringatan sebagai blok kutipan italic', () => {
    expect(warning('Saldo tunai negatif.')).toBe('<blockquote>⚠️ <i>Saldo tunai negatif.</i></blockquote>');
  });
});
