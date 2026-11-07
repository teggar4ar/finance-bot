/**
 * Format balasan Telegram (HTML `parse_mode`). Telegram hanya punya markup, bukan warna.
 * `<br>` tidak didukung; baris kosong dipisah newline ganda literal (`\n\n`).
 * Satu-satunya jalur galat 400 adalah teks pengguna yang memuat `<`, `>`, `&`,
 * jadi setiap teks dari pengguna wajib lewat `esc`.
 */
export const esc = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Angka, ID, tanggal, dan jumlah: monospace. Isi di-escape agar format/usage aman. */
export const code = (text: string): string => `<code>${esc(text)}</code>`;

/** Judul/status dan nilai penting (Total, Net). Isi statis, jadi tidak di-escape. */
export const bold = (text: string): string => `<b>${text}</b>`;

/** FR-022/FR-086: peringatan lembut sebagai blok kutipan — bukan galat (R5). */
export const warning = (text: string): string => `<blockquote>⚠️ <i>${text}</i></blockquote>`;
