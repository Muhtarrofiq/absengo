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

> **ℹ️ Versi ini sudah terkoneksi langsung ke Supabase** — kredensial (URL + `sb_secret`)
> sudah di-embed sebagai *fallback* di `api/server.js`, jadi **tidak perlu set env var di Vercel**.
> Cukup deploy folder ini, langsung jalan. (Baca catatan keamanan di bawah.)

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
Jawab prompt dengan Enter (default). Tidak ada konfigurasi build manual & tidak perlu set env
(kredensial sudah menjadi fallback di `api/server.js`).

---

## Catatan keamanan (fallback key di kode)
Kredensial Supabase (`sb_secret`) saat ini tertanam di `api/server.js` agar tidak perlu set env.
Karena file ini berjalan **di sisi server** (Vercel), key tidak pernah dikirim ke browser pengguna.
Namun, key ikut tersimpan di kode — jadi:
- **Simpan repo ini PRIVAT** (jangan public).
- Untuk keamanan lebih baik, hapus baris fallback dan gunakan env var Vercel
  (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) seperti versi awal README.

---

## Cara kerja sinkron

- Setiap perubahan data di browser → otomatis dikirim ke server → disimpan di Supabase.
- Semua perangkat yang login akan **menarik data terbaru** (cek tiap ~15 detik + saat tab aktif).
- Ada **deteksi konflik**: jika 2 perangkat mengubah data bersamaan, perangkat kedua
  mendapat peringatan "ada perubahan dari perangkat lain" lalu memuat data terbaru.
- Data dipisah per **Tahun Ajaran** (sama seperti di mode lokal).

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
npm run test:schema      # instalasi baru, upgrade DB lama, idempotensi, constraint
```

Pengujian mencakup: login admin/guru/siswa, pembatasan data per kelas untuk
cakupan `sendiri` dan `kelas`, penolakan `state/save` oleh siswa, validasi
username, serta pencabutan sesi saat akun siswa dihapus.
