# finance-bot

Bot Telegram **satu pengguna** untuk mencatat uang di dua akun — **tunai** dan **bank** — lewat perintah slash yang deterministik. Ringan, tanpa LLM, tanpa UI selain teks.

![Node.js](https://img.shields.io/badge/node-26.x-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169e1?logo=postgresql&logoColor=white)
![grammY](https://img.shields.io/badge/grammY-1.x-009dff)

Catat pengeluaran, pemasukan, dan transfer dengan satu baris singkat (mis. `/k makan siang 25rb`). Bot menyimpan transaksi di PostgreSQL, menghitung saldo dari transaksi (bukan angka tersimpan), mendukung undo/redo, ringkasan harian/mingguan/bulanan, peringatan **budget harian**, dan ekspor CSV bergaya ledger. Antarmuka dan nama perintah berbahasa Indonesia; kode dan identifier database berbahasa Inggris.

> [!NOTE]
> Proyek ini dirancang untuk **satu pengguna**. Hanya satu `ALLOWED_USER_ID` yang dilayani, dan bot hanya merespons di **chat pribadi**. Lingkungan dev dan produksi memakai **bot/token terpisah**.

## Fitur

- **Dua akun** (`tunai`, `bank`) dengan saldo yang selalu diturunkan dari transaksi aktif.
- **Catat cepat** — pengeluaran, pemasukan, dan transfer antar akun; tunai jadi default sehingga entri umum tak perlu flag.
- **Parser nominal Indonesia** — `25rb`, `25k`, `1,5jt`, `1.5jt`, `25.000`, `25000`; nominal juga boleh berdesimal hingga 2 digit (sen), mis. `25.000,50` atau `1.321.765,03` (titik pemisah ribuan, koma pemisah desimal).
- **Saldo awal** sebagai *row zero* ledger (boleh ditetapkan kapan saja; selalu dianggap sebelum transaksi lain).
- **Undo / redo** (soft delete) untuk transaksi terakhir.
- **Riwayat, edit, hapus** transaksi berdasarkan ID.
- **Ringkasan** hari ini, minggu ini, bulan ini, atau tanggal/bulan tertentu (batas hari dalam WIB).
- **Budget harian** dengan peringatan lembut (≥80%) dan keras (>100%), serta hitungan hari melewati budget pada ringkasan bulanan.
- **Ekspor CSV** bergaya ledger (semua data atau per bulan, dengan saldo berjalan).
- **Aman** — akses dibatasi middleware pertama, query terparameterisasi, rahasia hanya via environment variable.

## Tech stack

| Area | Pilihan |
|---|---|
| Runtime | Node.js 26.x (LTS) |
| Bahasa | TypeScript (strict) |
| Bot | [grammY](https://grammy.dev) |
| Database | PostgreSQL, SQL mentah via `pg` (tanpa ORM) |
| Tes | Vitest |
| Dev runner | `tsx` |
| Produksi | Heroku worker dyno + Heroku Postgres |

## Prasyarat

- **Node.js 26.x** dan npm.
- **PostgreSQL** — lokal (mis. Laragon) untuk dev, atau Heroku Postgres untuk produksi.
- **Token bot** dari [BotFather](https://t.me/BotFather).
- **Telegram user ID** Anda (hanya ID ini yang dilayani).

## Menjalankan secara lokal

```bash
git clone https://github.com/teggar4ar/finance-bot.git
cd finance-bot
npm install
```

Lalu siapkan konfigurasi:

```bash
cp .env.example .env
```

Isi `.env` (lihat tabel [Konfigurasi](#konfigurasi)), buat database, terapkan skema, lalu jalankan:

```bash
npm run db:init     # membuat tabel + view (idempoten, aman diulang)
npm run dev         # tsx watch — bot polling
```

> [!WARNING]
> Jangan pernah commit file `.env`. Rahasia (`BOT_TOKEN`, `DATABASE_URL`, `ALLOWED_USER_ID`) hanya disediakan lewat environment variable dan tidak boleh masuk log atau repositori.

## Konfigurasi

| Variabel | Wajib | Fungsi |
|---|---|---|
| `BOT_TOKEN` | ya | Token bot Telegram dari BotFather |
| `ALLOWED_USER_ID` | ya | Satu-satunya Telegram user ID yang diizinkan (integer positif) |
| `DATABASE_URL` | ya | String koneksi PostgreSQL |
| `TEST_DATABASE_URL` | tidak | DB untuk tes integrasi; tes integrasi dilewati bila kosong |
| `DB_POOL_SIZE` | tidak | Ukuran connection pool `pg` (default `3`) |

Aplikasi **gagal cepat** saat start bila `BOT_TOKEN`, `ALLOWED_USER_ID`, atau `DATABASE_URL` hilang/invalid.

## Perintah

| Perintah | Fungsi |
|---|---|
| `/start`, `/help` | Daftar perintah |
| `/saldo` | Saldo tunai, bank, dan total |
| `/saldo_awal tunai 200rb` | Tetapkan saldo awal akun |
| `/pengeluaran makan siang 25rb` · `/k` | Catat pengeluaran (default tunai) |
| `/pemasukan gaji 5jt @bank` · `/m` | Catat pemasukan |
| `/transfer bank tunai 500rb` | Pindahkan uang antar akun |
| `/undo` · `/redo` | Batalkan / pulihkan transaksi terakhir |
| `/riwayat` | 10 transaksi aktif terakhir (dengan ID) |
| `/edit <id> <deskripsi> <nominal> [@akun]` | Ubah transaksi |
| `/hapus <id>` | Hapus transaksi |
| `/hari_ini`, `/minggu_ini`, `/bulan_ini` | Ringkasan periode berjalan |
| `/ringkasan 2026-10-15` · `/ringkasan 2026-10` | Ringkasan tanggal / bulan tertentu |
| `/budget`, `/budget 150rb` | Lihat / tetapkan budget harian |
| `/export`, `/export 2026-10` | Ekspor CSV (semua data / per bulan) |

Flag akun opsional `@bank` atau `@tunai`; tanpa flag, akun default `tunai`.

## Struktur proyek

```text
src/
├─ index.ts        # bootstrap: cek DB, getMe, polling, shutdown SIGTERM/SIGINT
├─ config.ts       # loadConfig() — validasi env, gagal cepat
├─ env.ts          # muat .env lewat process.loadEnvFile()
├─ log.ts          # log satu baris; redaksi token
├─ command.ts      # parseCommand() — nama + argumen, alias satu huruf
├─ amount.ts       # parseAmount() / formatAmount() (format rupiah Indonesia)
├─ wib.ts          # satu-satunya aritmetika & format WIB
├─ execute.ts      # seam execute(command, deps) -> Reply; semua handler
├─ telegram.ts     # createBot() — middleware akses, kirim teks/dokumen
├─ csv.ts          # builder CSV murni (BOM, CRLF, RFC 4180)
├─ repo.ts         # interface data-access (Repo) + tipe
└─ db/
   ├─ repo.ts      # createRepo(pool) — satu-satunya tempat SQL
   ├─ pool.ts      # connection pool pg
   └─ init.ts      # penerap schema.sql
test/              # 267 tes Vitest (15 file) + fake-repo.ts
```

Arsitektur ringkas: semua handler adalah fungsi murni di balik seam `execute(command, deps) → Reply`, sehingga mudah diuji tanpa database. **Seluruh SQL tinggal di `src/db/repo.ts`**; sisanya memanggil fungsi seperti `getBalances()` atau `addExpenseOrIncome()`. Alur waktu memakai UTC di DB dan batas hari/minggu/bulan WIB dihitung di aplikasi (SQL tetap portabel).

## Tes

```bash
npm test
```

**267 tes di 15 file** (Vitest). Unit test mencakup parser nominal, parser argumen, aturan budget, dan logika saldo. Tes integrasi menembak PostgreSQL sungguhan pada database `_test` dan **dilewati bila `TEST_DATABASE_URL` kosong**.

> [!TIP]
> `tsconfig.json` hanya meng-`include` `src`, jadi tes tidak ikut di-typecheck oleh `tsc` biasa. Tes integrasi menolak berjalan bila nama database tidak berakhiran `_test`.

## Deployment

Produksi berjalan sebagai **worker Heroku** (`Procfile`: `worker: node dist/index.js`) dengan Heroku Postgres terpasang otomatis sebagai `DATABASE_URL`.

- Build dilakukan buildpack: `npm ci` lalu `npm run build` (`tsc` → `dist/`).
- Terapkan skema di Heroku dengan `node dist/db/init.js` (bukan `npm run db:init`, karena `tsx` adalah devDependency yang di-prune saat build).
- Shutdown `SIGTERM` ditangani rapi: berhenti menerima update, menuntaskan pekerjaan in-flight, lalu menutup pool.

## Dokumentasi

- [`CONTEXT.md`](./CONTEXT.md) — glosarium istilah domain.
- [`fr-nfr.md`](./fr-nfr.md) — functional & non-functional requirements, keputusan, asumsi.
- [`db-schema.md`](./db-schema.md) — skema, view `ledger_entries`, katalog query, kebijakan perubahan schema.
- [`docs/adr`](./docs/adr) — Architecture Decision Records (saldo derived, transfer satu baris, opening = row zero, alias satu huruf).
