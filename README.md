# Payroll Guru — Deploy ke Vercel + Supabase (data bersama)

Aplikasi penggajian honor guru kini **bisa dipakai banyak pengguna dengan data yang sama**.
Arsitektur:

```
Browser (index.html)  ──login & sinkron──▶  Vercel Serverless (api/server.js)  ──▶  Supabase Postgres
   (tampilan & logika)      state/get, state/save,          (REST, service_role)       (app_state, auth)
                            auth/login, auth/me, dst
```

- **Frontend** tetap 100% static (`index.html`).
- **Backend** = satu fungsi Vercel Serverless (`api/server.js`, tanpa dependency npm) yang
  mengimplementasikan kontrak API yang sudah tertanam di dalam aplikasi.
- **Database** = Supabase Postgres (satu baris `app_state` menyimpan seluruh snapshot data).

> Mode **pure localStorage** (tanpa server, untuk 1 perangkat) tetap tersedia lewat URL `?local`.

---

## Struktur folder

| File | Fungsi |
|------|--------|
| `index.html` | Aplikasi (sudah dikonfigurasi mode server via `window.SERVER_CONFIG`) |
| `api/server.js` | Backend API (Vercel Serverless) — jembatan ke Supabase + filter akses siswa |
| `supabase/schema.sql` | Skema tabel + fungsi + akun default (untuk instalasi baru) |
| `supabase/migrate-akses-siswa.sql` | Migrasi khusus database yang **sudah ada** (menambah akses siswa) |
| `vercel.json` | Konfigurasi static hosting |
| `package.json` | Agar `api/server.js` dibaca sebagai ESM; `npm test` utk uji lokal |
| `tools/` | Harness uji lokal (mock Supabase) — tidak perlu diubah |

---

## Langkah 1 — Siapkan Supabase (data)

1. Buat project di [supabase.com](https://supabase.com) (bebas / free tier cukup).
2. Buka **SQL Editor** → **New query** → salin isi `supabase/schema.sql` → **Run**.
   Ini membuat tabel `app_state`, `auth_users`, `auth_sessions`, fungsi `app_save_state`,
   dan 2 akun default.
3. **Database yang sudah berjalan?** Cukup jalankan
   `supabase/migrate-akses-siswa.sql` (lebih ringkas, hanya menambah akses siswa).
   `schema.sql` juga aman dijalankan ulang karena bersifat idempotent.
   ⚠️ Tanpa langkah ini, pembuatan akun siswa akan gagal dengan pesan
   *"Skema database belum diperbarui"*.
4. Buka **Project Settings → API**. Catat dua nilai:
   - `Project URL` (mis. `https://abcdefgh.supabase.co`)
   - **Secret key** — untuk project baru berbentuk `sb_secret_xxxxxxxx...`
     (setara service_role lama). ⚠️ **Rahasia — hanya untuk sisi server**, jangan bocor ke browser.

> Akun default: **admin / admin123** dan **guru / guru123**.
> Ganti lewat menu aplikasi **Pengaturan → Akun Login** setelah berjalan.

### ⚠️ Format key (penting)
Supabase versi baru memakai key `sb_secret_...` / `sb_publishable_...`.
**Env `SUPABASE_SERVICE_ROLE_KEY` harus diisi key `sb_secret_...`**, bukan key JWT `eyJ...`
(service_role `eyJ...` lama justru akan ditolak dengan *"Invalid API key"*).

---

## Langkah 2 — Deploy ke Vercel

> **⚠️ Wajib set Environment Variables di Vercel** sebelum aplikasi bisa dipakai:
> `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY`. Kredensial **tidak lagi ditanam di kode**
> (repo ini publik). Tanpa env tersebut, semua route `/api/server` menjawab 500 dengan pesan
> "Backend belum dikonfigurasi".

**Cara A — Drag & drop (paling cepat):**
1. Buka [vercel.com/new](https://vercel.com/new).
2. **Drag & drop** seluruh folder `payroll-guru`.
3. **Deploy** → selesai. Buka URL `xxx.vercel.app` → login `admin/admin123`.

**Cara B — GitHub:**
1. Push seluruh folder `payroll-guru` ke repo GitHub.
2. Di vercel.com → **New Project** → import repo → Framework Preset: **Other**.
3. **Deploy**.

**Cara C — Vercel CLI:**
```bash
npm i -g vercel
cd payroll-guru
vercel --prod
```
Jawab prompt dengan Enter (default), lalu isi env `SUPABASE_URL` &
`SUPABASE_SERVICE_ROLE_KEY` di dashboard Vercel → **Settings → Environment Variables**.

---

## Catatan keamanan (kunci Supabase)

- `api/server.js` **tidak lagi memuat kredensial apa pun**. Hanya membaca
  `process.env.SUPABASE_URL` & `process.env.SUPABASE_SERVICE_ROLE_KEY`
  (atau `SUPABASE_KEY`). Bila kosong, semua route menjawab 500 dengan pesan jelas.
- Repo ini **publik**. Karena versi lama sempat menanam `sb_secret` di kode, kunci tersebut
  harus dianggap sudah bocor:
  1. Supabase → **Settings → API Keys** → buat secret key baru.
  2. Tempel nilai baru ke Vercel → Settings → Environment Variables → `SUPABASE_SERVICE_ROLE_KEY`.
  3. **Hapus/revoke** kunci lama di Supabase.
  4. Redeploy (Vercel → Deployments → Redeploy) agar env baru terbaca.

---

## Cara kerja sinkron

- Setiap perubahan data di browser → otomatis dikirim ke server → disimpan di Supabase.
- Semua perangkat yang login akan **menarik data terbaru** (cek tiap ~15 detik + saat tab aktif).
- **Tidak ada data yang dibuang saat dua perangkat mengubah bersamaan.** Jika perangkat lain
  menulis lebih dulu (HTTP 409), data lokal **digabung tiga arah** (basis / perangkat ini /
  server) lalu disimpan ulang:
  - daftar (siswa, guru, kehadiran, absensi) digabung **per `id`** — tambahan kedua
    perangkat sama-sama tersimpan, suntingan entri yang sama diambil yang berpenanda waktu
    terbaru (jika ada), sisanya diutamakan versi perangkat yang sedang dipakai;
  - penghapusan hanya dihormati bila entri tidak diubah di sisi lain;
  - objek seperti `pengaturan` digabung per kolom, bukan ditimpa seluruhnya.
- **Perubahan yang belum terkirim tidak pernah ditimpa** tarik data berkala: selama masih ada
  perubahan tertunda, aplikasi mendorong dulu, baru menarik.
- Tarik data otomatis **ditunda** saat pengguna sedang mengetik (input/textarea/select fokus
  atau modal terbuka) supaya isian yang belum tersimpan tidak hilang.
- Saat halaman ditutup / ponsel dikunci, perubahan terakhir dikirim memakai
  `fetch(..., { keepalive: true })` agar tidak terpotong.
- Bila koneksi/server gagal, data **tetap disimpan di perangkat**, status di sidebar berubah
  menjadi *"Belum terkirim — menunggu koneksi"*, dan pengiriman diulang otomatis
  (backoff 1→30 detik) hingga berhasil.
- Sesi tidak dihapus hanya karena gangguan jaringan: kalau `auth/me` gagal karena jaringan,
  aplikasi tetap masuk memakai sesi tersimpan dan mengirim data setelah online. Sesi hanya
  dibuang bila server benar-benar menolak token (401/403).
- Indikator status di sidebar: **Menyimpan… → Tersimpan di server** atau
  **Belum terkirim — menunggu koneksi**.
- Perangkat selalu memuat versi terbaru: `/` dan `/index.html` dikirim dengan
  `Cache-Control: max-age=0, must-revalidate` (lihat `vercel.json`), jadi browser tidak
  memakai kode lama yang masih menimpa data dengan cara lama.
- Data dipisah per **Tahun Ajaran** (sama seperti di mode lokal).

## Riwayat data & pemulihan

Setiap penyimpanan menyalin versi **sebelumnya** ke tabel `app_state_history`
(30 versi terakhir, lebih lama dipangkas otomatis). Di **Pengaturan → Riwayat Data & Pulihkan**
admin bisa melihat daftar versi (waktu, versi, jumlah siswa/guru/kehadiran, ukuran) lalu
menekan **Pulihkan**.

- Pemulihan membuat **versi baru** (bukan menimpa riwayat), dan versi yang sedang aktif
  diarsipkan lebih dulu — jadi pemulihan selalu bisa dibatalkan.
- Terbatas untuk **admin** (guru & siswa ditolak 403).
- Setelah dipulihkan, semua perangkat menerima data baru pada tarik berkala berikutnya.
- Endpoint: `GET /api/server?route=state/history`, `POST /api/server?route=state/restore`
  dengan body `{ "historyId": 12 }`.

## Akun & role
- **Admin**: akses penuh (kelola data, gaji, akun login).
- **Guru**: hanya Input Kehadiran, Input/Laporan Absensi, dan Tata Tertib.
- **Siswa**: hanya menu **Absensi Saya** — rekap kehadiran & catatan tata tertib
  sesuai kelasnya. Akun siswa bersifat **read-only** (tidak bisa mengubah data).
- Ubah username/password Admin/Guru di **Pengaturan → Akun Login** (hanya admin).

---

## Akses Login Siswa per Kelas

Akun siswa dibuat dari **Pengaturan → Akses Login Siswa per Kelas** (khusus admin):

1. Pilih **Kelas**.
2. Isi **Password Awal** (opsional — jika dikosongkan, password = NIS/NISN siswa).
3. Pilih **Cakupan Data**:
   - **Hanya dirinya sendiri** → siswa hanya melihat absensi & pelanggaran miliknya.
   - **Seluruh kelas** → siswa melihat rekap absensi seluruh siswa di kelasnya.
4. Klik **Buat Akun Kelas Ini**. Username setiap siswa otomatis memakai NIS/NISN.
5. Gunakan tombol **Reset** bila siswa lupa password, atau **Hapus** untuk mencabut akses.

Contoh: siswa dengan NISN `0051234567` di kelas `VII A` login memakai
username `0051234567` dan password awal `0051234567` (kecuali admin mengisi password lain).

### Batas akses (diterapkan di server)
Saat siswa login, `state/get` **tidak** mengirim snapshot penuh. Server
(`api/server.js`) hanya mengirim:

| Data | Dikirim ke siswa? |
|------|-------------------|
| Identitas sekolah, tahun ajaran, master tata tertib | ✅ |
| Data siswa & absensi sesuai cakupan (diri sendiri / satu kelas) | ✅ |
| Catatan pelanggaran sesuai cakupan | ✅ |
| Data guru, kehadiran guru, master honor, penggajian, riwayat gaji | ❌ |
| Data siswa kelas lain | ❌ |

Selain itu `state/save` dari akun siswa ditolak **403**, dan akun siswa tidak
bisa membuka/mengubah daftar akun. Tampilan menu juga dibatasi, tetapi
perlindungan utama tetap di sisi server.

> Mode `?local` (tanpa server) menyimpan akun siswa di browser dan hanya
> menyembunyikan menu; untuk kontrol akses sungguhan gunakan mode server.


---

## Keamanan (penting)
- `SUPABASE_SERVICE_ROLE_KEY` **hanya hidup di server** (env Vercel), tidak pernah dikirim ke browser.
- Browser hanya berkomunikasi dengan fungsi `/api/server`; kredensial Supabase tidak terlihat oleh pengguna.
- Password disimpan sebagai hash `scrypt` (bukan plaintext).
- Snapshot state untuk akun **siswa** difilter di server (kelas & cakupan), bukan hanya di tampilan.
- Sesi siswa dicabut otomatis saat akun dihapus atau password direset.
- Logout di mode server membersihkan cache data di `localStorage` perangkat bersama.

## Troubleshooting
- **Login selalu gagal / "Backend belum dikonfigurasi"** → pastikan 2 env var sudah diset lalu redeploy.
- **Buka dari preview in-app (sandbox, tanpa backend)** → halaman akan sulit dipakai karena
  mencoba konek server. Buka dengan `?local` di akhir URL untuk melihat UI dalam mode lokal.
- **Ingin kembali 100% lokal tanpa login** → deploy saja, lalu buka `https://xxx.vercel.app/?local`.

## Uji backend secara lokal
```bash
cd payroll-guru
npm test     # mock Supabase + uji kontrak API, termasuk filter akses siswa
```

Uji UI (opsional, memakai jsdom — tidak dipakai saat runtime/deploy):

```bash
npm install --no-save jsdom
npm run test:ui          # mode lokal (?local)
npm run test:ui-server   # mode server: login admin/siswa + filter state
```

Uji skema SQL terhadap Postgres sungguhan (PGlite — WASM, tanpa server DB):

```bash
npm install --no-save @electric-sql/pglite
npm run test:schema      # instalasi baru, upgrade DB lama, idempotensi, constraint,
                         # riwayat snapshot & pemulihan (PGlite)
```

Uji riwayat data & pemulihan (server + UI):

```bash
npm install --no-save jsdom
npm run test:riwayat     # 43 cek: riwayat, pulihkan, batalkan pulih, hak akses, pangkas 30
```

Uji sinkronisasi lintas perangkat (dua "perangkat" jsdom sekaligus):

```bash
npm install --no-save jsdom
npm run test:sinkron     # 63 cek: konflik 409, merge per id, layar input kehadiran,
                         # offline, keepalive, sesi, kunci yang belum dikenal
```

Uji batas jam per tanggal (jsdom):

```bash
npm install --no-save jsdom
npm run test:batas       # batas per tanggal, kolom dinamis, rekap & kolom Jml Absen
```

### Batas Jam per Tanggal

Di modal **Input Kehadiran** ada isian batas yang berlaku **hanya untuk tanggal
yang sedang dipilih** (Tanggal Kehadiran), bukan untuk semua hari:

```
Tanggal Kehadiran               [ 2026-11-02 ]
Jumlah Kolom Jam ke- (Global)   [ 10 ]
Batas Jam untuk Tanggal Ini     [  7 ]   (Sen 2/11/26)
                              Tanggal dibatasi: [Sen 2/11/26 · 7 JP ×] [Sel 3/11/26 · 5 JP ×]
```

Aturan kerjanya:

- Batas berlaku **per tanggal**. Mengatur 2/11 = 7 tidak mengubah tanggal lain.
  Pindah tanggal → isian otomatis menampilkan batas tanggal tersebut.
- Chip **Tanggal dibatasi** menampilkan semua tanggal yang punya batas; klik namanya
  untuk pindah ke tanggal itu, klik `×` untuk menghapus batas tanggal itu saja.
- Kolom yang ditampilkan = `min(jumlah kolom, batas tanggal itu)`.
  Batas tidak pernah menambah kolom.
- Jam ke- di atas batas tidak ditampilkan dan tidak bisa dicentang.
- Target harian dipotong **per jam, bukan hanya per JP**: yang dihitung hanya jam
  mengajar yang benar-benar berada di dalam batas. Contoh Jumat 9/10/2026 guru
  dijadwalkan jam ke-6..10 (5 JP) dengan batas 7 → kotak yang tersedia hanya jam
  6 dan 7, jadi target = **2 JP**. Kalau semua kotak sudah dicentang, tidak ada
  "Kurang dari Target" dan Jml Absen kosong. Guru yang seluruh jamnya di atas
  batas → target 0 (tidak ditagih).
- **Kehadiran juga dipotong.** Tercatat 10 JP dengan batas 7 dihitung 7 JP; sisa 3 JP
  tidak masuk Jml Hadir, Total, maupun cetakan. Di daftar kehadiran, sel harian
  menampilkan angka yang dihitung dengan penanda `(+3)` dan tooltip penjelasan.
- Tanggal yang sudah mencapai batas dianggap **penuh**, sehingga **Jml Absen
  dikosongkan** (tampil `-`), bukan 0. Absen hanya terisi bila benar-benar kurang
  (batas 7, hadir 5 → Absen 2). Tooltip kolom Jml Absen memuat rincian per tanggal.
- Kosong / 0 = tanpa batas untuk tanggal itu.
- Disimpan di `localStorage` dengan key `batasJamPerTanggal`
  (contoh: `{"2026-11-02":7,"2026-11-03":5}`). Key lama
  (`batasJamTampilGlobal`, `batasJamPerHariGlobal`) sudah tidak dipakai.

Demo interaktif dengan data contoh:

```bash
npm run demo:batas       # -> /home/user/demo-batas-jam.html (buka dengan ?local)
```

Uji tata letak cetak (jsdom):

```bash
npm install --no-save jsdom
npm run test:print         # Cetak Kehadiran Guru: lebar kolom & orientasi kertas
npm run test:print-shadow  # bayangan kepala kolom tabel di SEMUA tampilan cetak
npm run test:keterangan    # kelola kolom keterangan (ganti nama, urutan, hapus)
```

### Mengatur kolom keterangan (Ijin, Sakit, dll)

Kolom keterangan pada **Cetak Kehadiran Guru** diambil dari daftar `keteranganIjinList`.
Daftar ini bisa diubah dari dua tempat:

- **Rekap Bulanan** → tombol **Kelola Keterangan** (di samping tombol cetak)
- **Input Kehadiran Guru** → tombol **Edit Daftar** di dekat pilihan Keterangan
- atau ketik bebas saat memilih *Lainnya...* pada dropdown keterangan

Yang bisa dilakukan di modal tersebut:

| Aksi | Cara | Efek |
|---|---|---|
| Tambah | Isi kolom teks → **Tambah** | Menambah kolom baru di cetakan |
| Ganti nama | Ubah teks pada baris → **Enter** / klik ✓ / klik di luar | Data kehadiran lama ikut diperbarui, jadi tidak muncul dua kolom (lama & baru) |
| Atur urutan | Tombol ▲ ▼ | Urutan daftar = urutan kolom saat dicetak |
| Hapus | Tombol 🗑 | Menghapus dari daftar; catatan kehadiran lama TIDAK dihapus |
| Reset | **Reset ke Default** | Kembali ke Alpa, Sakit, Keperluan Keluarga, Tugas Dinas |

Catatan: kategori yang masih dipakai catatan kehadiran lama tetap muncul sebagai kolom
walaupun sudah dihapus dari daftar — ini disengaja agar data tidak hilang diam-diam.
Ganti namanya (bukan hapus) bila ingin kolom itu menyatu dengan kategori lain.

Pratinjau visual semua dokumen cetak (tanpa perlu data produksi):

```bash
npm run print:preview      # -> /home/user/print-preview.html
```

### Bayangan kepala kolom tabel

Semua tampilan cetak memakai satu pembangun CSS bersama, `cssBayanganKepalaTabel()`
(di dalam `index.html`), supaya gaya kepala tabel konsisten:

| Tampilan cetak | Selector |
|---|---|
| Kehadiran Guru | `table.data-kehadiran th` |
| Rekap Gaji | `table.data thead th` |
| Leger Tahunan & Leger Kehadiran Tahunan | `table.leger th` |
| Slip Gaji | `.slip-detail-table th` |
| Laporan Siswa, Tata Tertib, Absensi Saya | `th` (di `buatKopLaporanSiswa`) |

Efeknya dibangun **3 lapis** karena `box-shadow` dan `background` sering dibuang
saat mencetak (Chrome: opsi "Background graphics" tidak dicentang; Firefox:
dibuang default). `print-color-adjust: exact` hanya meminta, pengaturan pengguna
tetap menang. Jadi:

1. **Border** — garis bawah tebal + garis atas tipis. Selalu tercetak, inilah
   lapisan yang membuat kepala kolom tetap terlihat timbul di printer hitam-putih.
2. **Background** — gradasi abu yang menggelap ke bawah, bila warna ikut tercetak.
3. **Box-shadow** — bayangan halus untuk layar dan printer berwarna.

Pengujian mencakup: login admin/guru/siswa, pembatasan data per kelas untuk
cakupan `sendiri` dan `kelas`, penolakan `state/save` oleh siswa, validasi
username, serta pencabutan sesi saat akun siswa dihapus. `test:print`
memastikan total lebar kolom cetak kehadiran **tepat 100%** (tidak terpotong)
untuk 1–14 kategori keterangan, orientasi A4 otomatis (portrait ≤6 kategori,
landscape ≥7), header berulang tiap halaman, dan baris tidak terbelah.
