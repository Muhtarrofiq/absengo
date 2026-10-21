-- ============================================================
--  MIGRASI: Kontrol Akses Login SISWA per Kelas
--  Jalankan di Supabase → SQL Editor → New query → Run
--
--  Pakai file ini bila database SUDAH ada (aplikasi lama).
--  Untuk instalasi baru, cukup jalankan supabase/schema.sql.
--  Skrip ini idempotent: aman dijalankan berulang kali.
-- ============================================================

-- 1. Kolom baru pada akun login ---------------------------------
alter table public.auth_users add column if not exists nama      text;
alter table public.auth_users add column if not exists kelas     text;
alter table public.auth_users add column if not exists siswa_id  text;
alter table public.auth_users add column if not exists akses     text not null default 'sendiri';

-- 2. Role kini mencakup 'siswa' ---------------------------------
alter table public.auth_users drop constraint if exists auth_users_role_check;
alter table public.auth_users add constraint auth_users_role_check
  check (role in ('admin','guru','siswa'));

-- 3. Cakupan data siswa: 'sendiri' | 'kelas' --------------------
alter table public.auth_users drop constraint if exists auth_users_akses_check;
alter table public.auth_users add constraint auth_users_akses_check
  check (akses in ('sendiri','kelas'));

-- 4. Satu siswa hanya boleh punya satu akun login ---------------
create unique index if not exists auth_users_siswa_id_key
  on public.auth_users (siswa_id) where role = 'siswa';
create index if not exists auth_users_kelas_idx
  on public.auth_users (kelas) where role = 'siswa';

-- 5. Kolom yang sama pada tabel sesi (agar info kelas ikut sesi) -
alter table public.auth_sessions add column if not exists nama     text;
alter table public.auth_sessions add column if not exists kelas    text;
alter table public.auth_sessions add column if not exists siswa_id text;
alter table public.auth_sessions add column if not exists akses    text not null default 'sendiri';

-- Selesai. Verifikasi (opsional):
--   select column_name, data_type from information_schema.columns
--   where table_name = 'auth_users' order by ordinal_position;
