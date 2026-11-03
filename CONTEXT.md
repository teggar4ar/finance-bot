# Personal Finance Bot

Bot Telegram satu pengguna untuk mencatat uang di dua tempat dan melaporkannya. File ini hanya glosarium: kata yang dipakai proyek ini, dan kata yang ditolak.

## Language

**Transaksi**:
Satu peristiwa keuangan yang dicatat, disimpan sebagai satu baris. Salah satu dari: `opening`, `expense`, `income`, `transfer`.
_Avoid_: entry, record, mutasi

**Akun**:
Salah satu dari tepat dua tempat uang disimpan: `tunai` atau `bank`.
_Avoid_: pocket, wallet, dompet, rekening

**Tunai**:
Uang fisik yang dipegang.

**Bank**:
Uang yang disimpan di rekening bank.

**Saldo awal**:
Jumlah awal satu akun. Dicatat sebagai transaksi bertipe `opening`; ia titik mulai, bukan pendapatan. Boleh ditetapkan kapan saja dan selalu dianggap berada sebelum transaksi lain.
_Avoid_: initial balance, modal, saldo pertama

**Pengeluaran** (`expense`, command `/pengeluaran`):
Uang keluar dari satu akun.
_Avoid_: debit, belanja, expense

**Pemasukan** (`income`, command `/pemasukan`):
Uang masuk ke satu akun.
_Avoid_: credit, kredit, pendapatan, income

**Transfer**:
Perpindahan uang antara kedua akun. Bukan pemasukan dan bukan pengeluaran; total tidak berubah.
_Avoid_: pindah dana, top up

**Transaksi aktif**:
Transaksi yang belum dibatalkan dan belum dihapus. Hanya transaksi aktif yang memengaruhi saldo.

**Dibatalkan** (`undone`):
Transaksi yang dikembalikan oleh `/undo`. Bisa dipulihkan oleh `/redo` selama riwayat undo belum dibuang.

**Dihapus** (`deleted`):
Transaksi yang hilang permanen, lewat `/hapus` atau lewat aturan buang-riwayat. Tidak bisa dipulihkan.

**Riwayat undo**:
Kumpulan transaksi yang sedang berstatus dibatalkan dan masih bisa dipulihkan `/redo`.

**Budget harian**:
Satu angka batas pengeluaran per hari WIB, dengan tanggal mulai berlaku. Bukan per kategori, bukan per akun.

**Nominal**:
Angka rupiah bulat positif yang ditulis pengguna; `rb`/`k` berarti ribu, `jt`/`juta` berarti juta. Desimal hanya sah bila memakai suffix.
_Avoid_: amount, nilai, harga

**Baris ledger**:
Satu sisi akun dari sebuah transaksi. Transfer menghasilkan dua baris ledger.
_Avoid_: leg, entry

**Baris pembuka periode**:
Baris sintetis bertipe `opening` di awal export bulanan yang merangkum saldo akumulasi sebelum periode itu.
_Avoid_: carry-in, saldo awal bulan

**Ringkasan**:
Total pemasukan dan pengeluaran pada satu rentang waktu. Saldo awal, transfer, transaksi dibatalkan, dan transaksi dihapus tidak dihitung.

**WIB**:
Waktu Indonesia Barat, UTC+7, tanpa daylight saving.
_Avoid_: local time, Waktu Indonesia
