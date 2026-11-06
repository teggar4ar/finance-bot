# Audit SOLID & Arsitektur — finance-bot

Tanggal: 2026-06-06 · Ruang lingkup: seluruh `src/` (14 file), seam tes, `schema.sql`, 4 ADR, `CONTEXT.md`.
Sifat: bahan perbaikan. **Bukan tiket**, tidak mengubah kode, tidak memutuskan apa pun atas nama pengguna.

---

## 1. Ringkasan eksekutif

Asumsi awal — *"struktur/kualitas kode kurang rapi dan tidak memakai SOLID"* — **tidak terbukti**. Kode ini termasuk rapi untuk ukurannya: modul murni ber-interface sempit, satu seam data-access yang disuntik, dan tipe union yang menjaga invarian. Yang ada bukan pelanggaran besar, melainkan **satu fungsi besar (`execute.ts`) dan sekelompok kecil duplikasi**.

| Prinsip | Skor | Catatan singkat |
|---|---|---|
| Single Responsibility | 4 / 5 | `execute.ts` (443 baris) menampung 4 tanggung jawab; sisanya jelas |
| Open/Closed | 4 / 5 | Registry `handlers` + `ALIASES` ideal; sedikit pencampuran khusus-`expense` |
| Liskov Substitution | 5 / 5 | Union `Transaction` + `isAccount()` + `toSafeNumber()` menjaga kontrak |
| Interface Segregation | 3 / 5 | `Repo` gemuk (18 method); `fakeRepo` menyalin semuanya |
| Dependency Inversion | 4,5 / 5 | `Deps = { now, repo }` disuntik; hanya 2 baca `env` yang langsung |
| Kedalaman modul (arsitektur) | 4,5 / 5 | `amount`/`wib`/`csv`/`command` dalam (interface tipis, isi kaya) |

**Verdict: sehat. Tidak butuh overhaul.** Tiga perbaikan kecil berisiko nol, sisanya ditahan sampai ada pemicu nyata. Bagian 6 berisi daftar **yang justru jangan dilakukan** supaya perbaikan tidak berubah jadi overengineering.

---

## 2. Metode & kriteria

Tiap temuan wajib lolos dua saringan:

1. **Prinsip SOLID** (SRP/OCP/LSP/ISP/DIP) — apakah ada alasan-untuk-berubah yang tercampur, atau ketergantungan yang salah arah.
2. **Uji penghapusan (deletion test)** — andai modul/fungsi dihapus, apakah kerumitan **terkonsentrasi** (bagus) atau cuma **berpindah** (tidak layak). Istilah arsitektur dipakai persis: *module, interface, depth, seam, adapter, leverage, locality*.

Prinsip penahan: **YAGNI**. Perbaikan hanya diusulkan bila ada gesekan nyata hari ini; sisanya diberi **pemicu** kapan boleh dikerjakan.

---

## 3. Peta arsitektur

```
Telegram ──► src/telegram.ts            adapter: pesan → execute() → balasan
                 │  (middleware akses, try/catch, pemilih string|CsvFile)
                 ▼
             src/execute.ts             SEAM perilaku: (command, deps) → Reply
                 │  Deps = { now, repo }
                 ▼
             src/repo.ts                SEAM data-access (interface Repo + tipe domain)
                 ▲
        ┌────────┴─────────┐
   src/db/repo.ts      test/fake-repo.ts      ← DUA adapter = seam sungguhan
   (satu-satunya SQL)   (palsu, untuk tes)
```

Modul **dalam** (interface tipis, isi kaya, leverage tinggi):
`src/amount.ts`, `src/wib.ts`, `src/csv.ts`, `src/command.ts`, `src/log.ts`.

Modul **tipis tapi jujur** (bukan kelebihan-abstraksi):
`src/env.ts` (8 baris, membungkus `existsSync`+`loadEnvFile` di dua pemanggil), `src/config.ts` (validasi gagal-cepat), `src/db/pool.ts`.

Seam `Repo` memenuhi syarat "seam sungguhan": punya **dua adapter** (produksi `createRepo` + tes `fakeRepo`), jadi pelepasan `pg` dari logika uang terbukti, bukan hipotetis.

---

## 4. Penilaian per prinsip (bukti)

**SRP.** Hampir semua modul punya satu sebab-untuk-berubah: `amount` (parser+formatter Nominal), `wib` (aritmetika WIB, satu tempat sejak #10), `csv` (builder murni), `db/repo.ts` (SQL). Pengecualiannya `execute.ts` — lihat **F-2**. `db/repo.ts` besar (290 baris) **bukan** pelanggaran: SQL yang terkumpul di satu tempat adalah keputusan sadar (NFR-051), dan menghapurnya akan menabrak lokalitas yang diinginkan.

**OCP.** Menambah command = menambah entri di `handlers` (`execute.ts:486`), bukan menyunting rantai `if`. `ALIASES` (`:484`) di-resolve **sebelum** pemilihan handler, sehingga alias tak bisa menyimpang dari command kanonik — persis yang dijanjikan ADR-0004. Ini contoh OCP yang benar. Satu gesekan kecil: `recordTransaction` memuat perilaku khusus Pengeluaran (`if (type !== 'expense')`, `:185`) — **F-8**.

**LSP.** `Transaction` (`repo.ts:20`) adalah union berdiskriminan: hanya `transfer` yang punya `toAccount`. `isAccount()` (`:102`) dan `toTransaction()` (`db/repo.ts:59`) menegakkan kontrak yang sama dengan `CONSTRAINT chk_tx_transfer`. Penggantian implementasi tidak mengubah janji. Tidak ada temuan.

**ISP.** `Repo` punya 18 method (`repo.ts:65`); tiap handler memakai 1–3. `fakeRepo` (`test/fake-repo.ts`) menyalin **semua** method, jadi tiap file tes bergantung pada seluruh interface. Ini contoh *fat interface* klasik — tapi **F-4** menjelaskan kenapa memecahnya sekarang justru merugikan.

**DIP.** `execute(command, deps)` dengan `Deps = { now, repo }` (`execute.ts:14`) adalah injeksi dependensi yang bersih; `execute.ts` **tidak pernah** menyentuh `pg`/SQL (diverifikasi: 23 pemanggilan semuanya lewat `deps.repo.*`). Seam ini yang membuat 240 tes bisa jalan tanpa database. Dua baca `env` langsung menyimpang dari `loadConfig` — **F-6**.

---

## 5. Temuan

Severity: **S**edang / **R**endah / **I**nfo. Urut dari paling layak dikerjakan.

### F-1 · Duplikasi baris sisa Budget — `R`
- **Lokasi:** `execute.ts:392` dan `execute.ts:412`.
- **Masalah:** ekspresi `` left < 0 ? `Kelebihan: …` : `Sisa: …` `` identik di dua tempat (konfirmasi `/budget` vs. balasan Pengeluaran), padahal #13 sudah pernah menyatukan format ini.
- **Prinsip:** SRP/DRY + lokalitas — satu bentuk balasan seharusnya hidup di satu tempat, agar tidak menyimpang lagi.
- **Uji penghapusan:** mengekstrak `remainingLine(left)` memindahkan 1 baris jadi 1 pemanggilan; kerumitan **terkonsentrasi**, bukan berpindah. Lolos (tipis).
- **Rekomendasi:** satu helper kecil `remainingLine(left: number): string`; dua pemanggil memakainya.
- **Risiko:** hampir nol. Ini satu-satunya perbaikan yang aku sarankan dikerjakan kini.

### F-2 · `execute.ts` menampung 4 tanggung jawab — `R`
- **Lokasi:** `execute.ts` (443 baris) berisi sekaligus: (a) registry & seam `execute`, (b) seluruh kosakata balasan (`HELP`, `SEP`, `balanceLines`, `transactionLabel`, …), (c) aritmetika periode WIB (`period`, `todayPeriod`, `weekPeriod`, `monthPeriod`, `summaryPeriod`), (d) logika Budget + export.
- **Prinsip:** SRP tingkat-modul — empat sebab-untuk-berubah dalam satu file. Tiap tiket fitur baru (#9, #10, #14) menyunting file yang sama.
- **Uji penghapusan:** memecah **per-command** ke banyak file akan **memperlemah** lokalitas (handler dan kosakata balasan memang rapat). Memecah **`period`** lolos: blok `:262–321` sudah murni, tidak bergantung `Deps`, dan hanya `execute.ts` yang memakainya.
- **Rekomendasi:** pecah **hanya** blok periode ke `src/period.ts` **ketika** file tembus ~500 baris. Jangan pecah handler per-command (lihat §6).
- **Risiko:** refactor mekanis, tapi ini refactor — bukan perbaikan mendesak.

### F-3 · Parameter ganda di `daysOverBudget` — `R`
- **Lokasi:** `execute.ts:336` memanggil `daysOverBudget(target, target.month, deps)`; signature di `:348–351` menerima `target` **dan** `{year, month}` padahal `target.month` sudah membawa keduanya.
- **Prinsip:** desain interface — pemanggil dipaksa mengoper ulang data yang sudah ada; sumber kebenaran ganda.
- **Uji penghapusan:** membaca bulan dari `target.month` (non-null setelah guard `:335`) menghapus satu parameter. Lolos.
- **Rekomendasi:** ambil `{year, month}` dari `target.month`. Handoff #14 sudah menandai ini sebagai kosmetik — cocok dibundel dengan F-1/F-2.
- **Risiko:** nol.

### F-4 · `Repo` gemuk + `fakeRepo` menyalin semuanya — `R`
- **Lokasi:** `repo.ts:65` (18 method); `test/fake-repo.ts` menulis 18 stub lalu `overrides`.
- **Prinsip:** ISP — tiap handler bergantung pada method yang tak dipakainya.
- **Uji penghapusan:** memecah jadi `ReadRepo`/`WriteRepo`/`BudgetRepo`/`LedgerRepo` **menambah** jumlah tipe dan mewajibkan `createRepo` memenuhi keempatnya, sementara `fakeRepo` yang sudah ber-`overrides` **sudah** memberikan manfaat utama ISP untuk tes. Kerumitan **berpindah** ke definisi tipe → **tidak lolos**.
- **Rekomendasi:** **TAHAN.** Pemicu untuk meninjau ulang: bila `Repo` tembus ~25 method, atau `fakeRepo` mulai punya logika setup, bukan sekadar stub.

### F-5 · `Reply = string | CsvFile` memaksa cast di 7 tempat — `I`
- **Lokasi:** `execute.ts:19`; cast `as string` di 7 helper tes (`catat`, `budget`, `riwayat`, `ringkasan`, `saldo`, `transfer`, `undo`); cabang `typeof reply === 'string'` di `telegram.ts:32`.
- **Prinsip:** ini union tak berdiskriminan; konsumen harus menebak bentuknya.
- **Uji penghapusan:** mengganti ke discriminated union memperbaiki tipe, tetapi **satu** command file membuat polimorfisme itu belum sepadan.
- **Rekomendasi:** **TAHAN** (sudah diputuskan di #10). Pemicu: **saat command file kedua lahir**, ganti ke union berdiskriminan dan buang 7 cast.

### F-6 · Akses `env` tidak seragam — `I`
- **Lokasi:** `config.loadConfig()` resmi, tetapi `db/pool.ts:10` membaca `process.env.DB_POOL_SIZE` dan `db/init.ts:11` membaca `process.env.DATABASE_URL` langsung.
- **Prinsip:** DIP/konsistensi — dua jalan menuju konfigurasi yang sama.
- **Uji penghapusan:** memindahkan `dbPoolSize` ke `Config` menambah field ke `Config` + `loadConfig`. Manfaat kecil.
- **Rekomendasi:** **TAHAN**; bila `Config` disentuh karena alasan lain, bawa `dbPoolSize` serta. `db/init.ts` memang butuh `DATABASE_URL` sendiri (tak butuh `BOT_TOKEN`), jadi membiarkannya wajar.

### F-7 · Konfirmasi tulis berulang — `I`
- **Lokasi:** pola "`✅ <judul>` / `<label transaksi>` / `ID <id>` / `...balanceLines()`" di `setOpeningBalance` (`:130`), `recordTransaction` (`:178`), `recordTransfer` (`:200`), `undoOrRedo` (`:233`), `editTransaction` (`:466`), `deleteTransaction` (`:480`).
- **Prinsip:** DRY + lokalitas (bentuk balasan sukses tulis).
- **Uji penghapusan:** satu helper `writeConfirm({ title, label, id, balances })` menggantikan 6 perakitan ad-hoc. Kerumitan **terkonsentrasi**. Lolos, tapi tipls.
- **Rekomendasi:** *Worth exploring*, bukan wajib. Bila disentuh bersama F-1, netral-positif.

### F-8 · Pencampuran khusus-Pengeluaran di `recordTransaction` — `I`
- **Lokasi:** `execute.ts:185` — `if (type !== 'expense') return …` lalu menambah baris Budget hanya untuk Pengeluaran.
- **Prinsip:** OCP kecil — perilaku khusus satu tipe disisipkan di fungsi generik dua tipe.
- **Uji penghapusan:** memisahkan ke `recordExpense`/`recordIncome` menambah kode untuk dua tipe yang 90% sama. **Tidak lolos** untuk sekarang.
- **Rekomendasi:** **TAHAN.** Biarkan `if` tunggal itu.

---

## 6. Yang sudah bagus — jangan diubah (guardrail anti-overengineering)

Daftar ini penting justru agar perbaikan **tidak** merusak desain yang sudah benar.

- **Seam murni tanpa framework.** `execute(command, deps)` + `Repo` yang disuntik. Jangan tambah DI container, service layer, `abstract class BaseHandler`, atau repository-per-entitas.
- **Modul murni dalam.** `amount.ts`, `wib.ts`, `csv.ts`, `command.ts` — interface tipis, isi kaya, teruji lewat puluhan tes. Jangan pecah atau bungkus lagi.
- **SQL hanya di `db/repo.ts` (NFR-051).** Jangan sebarkan query ke handler atau tambah ORM.
- **Saldo diturunkan, tidak disimpan (ADR-0001).** Jangan "optimalkan" dengan kolom cache saldo.
- **Transfer satu baris (ADR-0002), Saldo awal = baris nol (ADR-0003).** Jangan pecah transfer jadi dua baris atau ubah urutan ledger.
- **`handlers` map + `ALIASES`.** Ini OCP yang benar; jangan ganti jadi rantai `if/else` atau `switch` raksasa.
- **Union `Transaction` + `isAccount()`.** Jangan ganti jadi `any`/cast demi "kepraktisan".

Yang **jangan** dikerjakan meski terlihat "SOLID": memecah `Repo` (F-4), memecah handler per-command (F-2), menu terpisah (F-6), abstraksi `Reply` (F-5) — semuanya menambah tipe/kode tanpa menghilangkan riak hari ini.

---

## 7. Rekomendasi prioritas (bahan perbaikan)

| # | Perbaikan | Jenis | Risiko | Pemicu |
|---|---|---|---|---|
| 1 | F-1 `remainingLine(left)` — satukan baris sisa Budget | refactor kecil, aturan | ~0 | kerjakan kini |
| 2 | F-3 buang parameter ganda `daysOverBudget` | refactor kecil, aturan | ~0 | bundel dengan #1 |
| 3 | F-7 helper `writeConfirm()` | refactor kosmetik | rendah | bila menyentuh balasan lagi |
| 4 | F-2 pecah blok periode → `src/period.ts` | refactor struktur | sedang | `execute.ts` > ~500 baris |
| 5 | F-5 `Reply` union berdiskriminan | perubahan tipe | sedang | saat command file kedua ada |
| 6 | F-4 segregasi `Repo` | perubahan interface | sedang | `Repo` > ~25 method |
| 7 | F-6 `dbPoolSize` → `Config` | konsistensi | rendah | saat `Config` disentuh |

Hanya **baris 1–2** yang aku sarankan dikerjakan tanpa pemicu. Baris 3–7 punya pemicu; mengerjakannya sekarang berisiko overengineering pada basis kode satu-pengguna yang sudah 240 tes hijau.

---

## 8. Lampiran — catatan akhir

- Tidak ada kebocoran DIP di jalur uang: `execute.ts` **nol** akses `pg`/SQL (23 pemanggilan `deps.repo.*`).
- Tidak ada penyimpangan LSP yang bisa diuji; guard "Transfer tanpa akun tujuan" di `toTransaction()` memang tak dapat dijangkau selama `chk_tx_transfer` ada (diketahui, bukan bug).
- Empat balasan Pengeluaran ber-Budget = empat perjalanan DB (`addExpenseOrIncome`, `getBalances`, `getBudgetFor`, `getExpenseUsed`) — aman untuk satu pengguna (ADR-0001). Bukan temuan.
- Skor di §1 subjektif namun berbasis bukti baris di §4; gunakan sebagai urutan prioritas, bukan sertifikasi.

> Ringkas: basis kode ini **tidak perlu diselamatkan**. Kerjakan F-1 + F-3, tahan sisanya sampai pemicunya muncul.
