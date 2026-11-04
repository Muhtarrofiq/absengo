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

-- ------------------------------------------------------------
--  Riwayat snapshot (jaring pengaman bila data tertimpa)
--  Setiap penyimpanan menyalin versi SEBELUMNYA ke tabel ini,
--  sehingga data lama selalu bisa dipulihkan dari menu Pengaturan.
--  Yang disimpan hanya 30 versi terakhir (dipangkas otomatis).
-- ------------------------------------------------------------
create table if not exists public.app_state_history (
  id          bigserial primary key,
  version     bigint not null,
  state       jsonb not null,
  keterangan  text,
  created_at  timestamptz not null default now()
);

create index if not exists app_state_history_created_idx
  on public.app_state_history (created_at desc);

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
  cur_state   jsonb;
  new_version bigint;
begin
  select version, state into cur_version, cur_state from public.app_state where id = 1;
  if cur_version is null then
    cur_version := 0;
  end if;

  if (p_force is not true) and p_version <> cur_version then
    return jsonb_build_object('ok', false, 'code', 'conflict', 'version', cur_version);
  end if;

  new_version := cur_version + 1;

  -- Salin versi yang AKAN diganti ke riwayat sebelum ditimpa.
  if cur_state is not null then
    insert into public.app_state_history (version, state, keterangan)
    values (cur_version, cur_state, 'sebelum simpan v' || new_version);

    delete from public.app_state_history
     where id not in (select id from public.app_state_history order by id desc limit 30);
  end if;

  insert into public.app_state (id, version, state, updated_at)
  values (1, new_version, p_state, now())
  on conflict (id) do update
    set version = excluded.version,
        state   = excluded.state,
        updated_at = now();

  return jsonb_build_object('ok', true, 'version', new_version);
end $$;

-- ------------------------------------------------------------
--  Daftar riwayat untuk halaman Pengaturan (tanpa mengirim isi
--  snapshot yang besar: hanya waktu, versi, ukuran, dan jumlah data).
-- ------------------------------------------------------------
create or replace function public.app_list_history(p_limit integer default 30)
returns table (
  id               bigint,
  version          bigint,
  created_at       timestamptz,
  ukuran           bigint,
  jumlah_siswa     bigint,
  jumlah_guru      bigint,
  jumlah_kehadiran bigint,
  keterangan       text
)
language sql
stable
security definer
as $$
  select h.id,
         h.version,
         h.created_at,
         octet_length(h.state::text)::bigint as ukuran,
         coalesce((select sum(jsonb_array_length(e.value::jsonb))
                     from jsonb_each_text(h.state) e
                    where e.key like '%dataSiswa_v1'
                      and jsonb_typeof(e.value::jsonb) = 'array'), 0)::bigint as jumlah_siswa,
         coalesce((select sum(jsonb_array_length(e.value::jsonb))
                     from jsonb_each_text(h.state) e
                    where e.key like '%dataGuru_v2'
                      and jsonb_typeof(e.value::jsonb) = 'array'), 0)::bigint as jumlah_guru,
         coalesce((select sum(jsonb_array_length(e.value::jsonb))
                     from jsonb_each_text(h.state) e
                    where e.key like '%dataKehadiran'
                      and jsonb_typeof(e.value::jsonb) = 'array'), 0)::bigint as jumlah_kehadiran,
         h.keterangan
    from public.app_state_history h
   order by h.id desc
   limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

-- ------------------------------------------------------------
--  Pulihkan snapshot lama sebagai VERSI BARU.
--  Versi yang sedang aktif ikut diarsipkan lebih dulu, jadi
--  pemulihan selalu bisa dibatalkan (tidak ada data yang hilang).
-- ------------------------------------------------------------
create or replace function public.app_restore_state(p_history_id bigint)
returns jsonb
language plpgsql
security definer
as $$
declare
  h           record;
  cur_version bigint;
  cur_state   jsonb;
  new_version bigint;
begin
  select * into h from public.app_state_history where id = p_history_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select version, state into cur_version, cur_state from public.app_state where id = 1;
  cur_version := coalesce(cur_version, 0);
  new_version := cur_version + 1;

  if cur_state is not null then
    insert into public.app_state_history (version, state, keterangan)
    values (cur_version, cur_state, 'sebelum pulihkan ke v' || h.version);
  end if;

  insert into public.app_state (id, version, state, updated_at)
  values (1, new_version, h.state, now())
  on conflict (id) do update
    set version = excluded.version,
        state   = excluded.state,
        updated_at = now();

  delete from public.app_state_history
   where id not in (select id from public.app_state_history order by id desc limit 30);

  return jsonb_build_object('ok', true, 'version', new_version, 'dari_version', h.version);
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
