-- ============================================================
--  Payroll Guru — Supabase schema (shared data backend)
--  Jalankan skrip ini di Supabase: SQL Editor > New query > Run
--  Skrip ini aman dijalankan ulang (idempotent) untuk memperbarui
--  database lama, termasuk menambah akses login SISWA per kelas.
-- ============================================================

-- Tabel state aplikasi: satu baris menyimpan SELURUH snapshot
-- localStorage aplikasi (semua key ta_*, pengaturan, dll).
-- `version` dipakai untuk deteksi konflik saat banyak perangkat sinkron.
create table if not exists public.app_state (
  id         integer primary key default 1,
  version    bigint  not null default 0,
  state      jsonb   not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Tabel akun login (admin / guru / siswa)
create table if not exists public.auth_users (
  id            serial primary key,
  username      text unique not null,
  password_hash text not null,
  role          text not null check (role in ('admin','guru'))
);

-- ------------------------------------------------------------
-- Migrasi: role SISWA + data kelas/siswa pada akun dan sesi.
-- (Kolom baru ditambahkan bila database dibuat dari versi lama.)
-- ------------------------------------------------------------
alter table public.auth_users add column if not exists nama      text;
alter table public.auth_users add column if not exists kelas     text;
alter table public.auth_users add column if not exists siswa_id  text;
alter table public.auth_users add column if not exists akses     text not null default 'sendiri';

-- Role kini mencakup 'siswa'
alter table public.auth_users drop constraint if exists auth_users_role_check;
alter table public.auth_users add constraint auth_users_role_check
  check (role in ('admin','guru','siswa'));

-- Cakupan data siswa: 'sendiri' = hanya data miliknya,
-- 'kelas' = seluruh siswa pada kelas yang sama.
alter table public.auth_users drop constraint if exists auth_users_akses_check;
alter table public.auth_users add constraint auth_users_akses_check
  check (akses in ('sendiri','kelas'));

-- Satu siswa hanya boleh memiliki satu akun login.
create unique index if not exists auth_users_siswa_id_key
  on public.auth_users (siswa_id) where role = 'siswa';
create index if not exists auth_users_kelas_idx
  on public.auth_users (kelas) where role = 'siswa';

-- Tabel sesi login (token)
create table if not exists public.auth_sessions (
  token      text primary key,
  username   text not null,
  role       text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.auth_sessions add column if not exists nama     text;
alter table public.auth_sessions add column if not exists kelas    text;
alter table public.auth_sessions add column if not exists siswa_id text;
alter table public.auth_sessions add column if not exists akses    text not null default 'sendiri';

-- ------------------------------------------------------------
-- Fungsi atomik untuk menyimpan state dengan cek versi.
-- Mengembalikan jsonb {ok, code?, version} sehingga tidak perlu
-- mengandalkan exception lintas REST.
-- ------------------------------------------------------------
create or replace function public.app_save_state(
  p_version bigint,
  p_state   jsonb,
  p_force   boolean
) returns jsonb
language plpgsql
security definer
as $$
declare
  cur_version bigint;
  new_version bigint;
begin
  select version into cur_version from public.app_state where id = 1;
  if cur_version is null then
    cur_version := 0;
  end if;

  if (p_force is not true) and p_version <> cur_version then
    return jsonb_build_object('ok', false, 'code', 'conflict', 'version', cur_version);
  end if;

  new_version := cur_version + 1;

  insert into public.app_state (id, version, state, updated_at)
  values (1, new_version, p_state, now())
  on conflict (id) do update
    set version = excluded.version,
        state   = excluded.state,
        updated_at = now();

  return jsonb_build_object('ok', true, 'version', new_version);
end $$;

-- Seed akun default (dihapus/diubah lewat menu Pengaturan > Akun Login)
insert into public.auth_users (username, password_hash, role) values
  ('admin', 'scrypt$iZ2rfwhTNVnAcXFfJWICOQ==$Z1nACicQwLt6mjRR9+VXUteVCqZWRER38iar9htFowTdvkkMZO8ZeFZgfRIOF+QtP+iduG+cipy5GFVtygT2Uw==', 'admin'),
  ('guru',  'scrypt$nfTVeZdtyNb1OSmnJvv56w==$acAv8PVd9UOdinw3mmgTlZCuEKq1ah7q06cT2I+4q2UOVJ+ptB0pDdtu4vQJqHyM2SZDejqUz4xAKMQiTLgjLg==', 'guru')
on conflict (username) do nothing;

-- ============================================================
--  Catatan akses SISWA
--  - Akun siswa dibuat dari aplikasi: Pengaturan > Akses Login Siswa.
--  - username = NIS/NISN siswa, kolom `kelas` menentukan batas akses.
--  - `akses` = 'sendiri' -> siswa hanya melihat absensi & pelanggaran
--    miliknya sendiri; 'kelas' -> melihat seluruh siswa di kelasnya.
--  - Data guru, honor, penggajian, dan kelas lain TIDAK pernah dikirim
--    ke akun siswa (difilter di api/server.js, bukan hanya di tampilan).
-- ============================================================
