// Verifikasi skema terhadap Postgres sungguhan (PGlite = Postgres WASM).
// Menjalankan: 1) skema lama, 2) migrasi baru, 3) skema.sql lengkap ulang,
// lalu menguji constraint role/akses, indeks unik siswa_id, dan insert akun siswa.
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

let pass = 0, fail = 0;
const check = (nama, kondisi, extra = '') => {
  if (kondisi) { pass++; console.log('  ✔ ' + nama); }
  else { fail++; console.log('  ✘ ' + nama + (extra ? ' -> ' + extra : '')); }
};
const sql = nama => fs.readFileSync(nama, 'utf8');

const SCHEMA_LAMA = `
create table if not exists public.app_state (
  id integer primary key default 1,
  version bigint not null default 0,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.auth_users (
  id serial primary key,
  username text unique not null,
  password_hash text not null,
  role text not null check (role in ('admin','guru'))
);
create table if not exists public.auth_sessions (
  token text primary key,
  username text not null,
  role text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
`;

async function coba(db, label, fn) {
  try { await fn(); return { ok: true }; }
  catch (e) { console.log(`  [${label}] error: ${String(e.message).split('\n')[0]}`); return { ok: false, error: e.message }; }
}

// ---------- Skenario A: instalasi baru dari schema.sql ----------
console.log('\n-- A. Instalasi baru: schema.sql --');
{
  const db = new PGlite();
  await db.exec(sql('supabase/schema.sql'));
  const cols = await db.query(`
    select column_name, is_nullable, column_default from information_schema.columns
    where table_schema='public' and table_name='auth_users' order by ordinal_position`);
  const nama = cols.rows.map(r => r.column_name);
  check('kolom auth_users lengkap', ['id','username','password_hash','role','nama','kelas','siswa_id','akses'].every(k => nama.includes(k)), nama.join(','));
  check('akses default sendiri', cols.rows.find(r => r.column_name === 'akses')?.column_default?.includes('sendiri'));

  const seed = await db.query(`select username, role from public.auth_users order by username`);
  check('2 akun default ter-seed', seed.rows.length === 2 && seed.rows[0].role === 'admin');

  const idx = await db.query(`select indexname from pg_indexes where tablename='auth_users'`);
  const daftarIdx = idx.rows.map(r => r.indexname);
  check('indeks unik siswa_id ada', daftarIdx.includes('auth_users_siswa_id_key'), daftarIdx.join(','));

  // role siswa diterima
  let r = await coba(db, 'insert siswa', () => db.query(
    `insert into auth_users (username, password_hash, role, nama, kelas, siswa_id, akses)
     values ('S001','scrypt$x$y','siswa','Ahmad','VII A','s1','sendiri')`));
  check('insert akun siswa diterima', r.ok);

  // role asing ditolak
  r = await coba(db, 'role asing', () => db.query(
    `insert into auth_users (username, password_hash, role) values ('X1','h','kepala')`));
  check('role di luar daftar ditolak', !r.ok);

  // akses asing ditolak
  r = await coba(db, 'akses asing', () => db.query(
    `insert into auth_users (username, password_hash, role, kelas, siswa_id, akses)
     values ('S002','h','siswa','VII A','s2','semua')`));
  check('akses di luar sendiri/kelas ditolak', !r.ok);

  // dua akun untuk satu siswa ditolak
  r = await coba(db, 'duplikat siswa', () => db.query(
    `insert into auth_users (username, password_hash, role, kelas, siswa_id)
     values ('S003','h','siswa','VII A','s1')`));
  check('satu siswa dua akun ditolak', !r.ok);

  // banyak akun dengan siswa_id NULL tetap boleh (admin/guru)
  r = await coba(db, 'null ganda', () => db.query(
    `insert into auth_users (username, password_hash, role) values ('adm2','h','admin'), ('guru2','h','guru')`));
  check('siswa_id NULL boleh berulang', r.ok);

  // upsert akun (dipakai API) berjalan
  r = await coba(db, 'upsert', () => db.query(
    `insert into auth_users (username, password_hash, role, nama, kelas, siswa_id, akses)
     values ('S001','scrypt$x$y','siswa','Ahmad Fauzi','VIII B','s1','kelas')
     on conflict (username) do update set nama=excluded.nama, kelas=excluded.kelas, siswa_id=excluded.siswa_id, akses=excluded.akses`));
  const upd = await db.query(`select kelas from auth_users where username='S001'`);
  check('upsert memperbarui kelas', r.ok && upd.rows[0].kelas === 'VIII B');

  // function app_save_state (plpgsql) berfungsi
  const simpan = await db.query(`select public.app_save_state(0, '{"a":1}'::jsonb, false) as hasil`);
  check('app_save_state v1', simpan.rows[0].hasil?.ok === true && Number(simpan.rows[0].hasil.version) === 1);
  const konflik = await db.query(`select public.app_save_state(0, '{"a":2}'::jsonb, false) as hasil`);
  check('deteksi konflik versi', konflik.rows[0].hasil?.ok === false && konflik.rows[0].hasil.code === 'conflict');
  const paksa = await db.query(`select public.app_save_state(0, '{"a":3}'::jsonb, true) as hasil`);
  check('force save => versi 2', paksa.rows[0].hasil?.ok === true && Number(paksa.rows[0].hasil.version) === 2);

  // schema.sql dijalankan ulang harus aman
  r = await coba(db, 'schema ulang', () => db.exec(sql('supabase/schema.sql')));
  check('schema.sql idempotent (dijalankan 2x)', r.ok);
  const seedLagi = await db.query(`select count(*)::int as n from auth_users where username in ('admin','guru')`);
  check('akun default tidak terduplikasi', seedLagi.rows[0].n === 2);

  await db.close();
}

// ---------- Skenario B: upgrade database lama ----------
console.log('\n-- B. Upgrade dari skema lama (hanya tabel admin/guru) --');
{
  const db = new PGlite();
  await db.exec(SCHEMA_LAMA);
  await db.query(`insert into auth_users (username, password_hash, role) values ('admin','h','admin'), ('guru','h','guru')`);
  await db.exec(sql('supabase/migrate-akses-siswa.sql'));

  const cols = await db.query(`
    select column_name from information_schema.columns
    where table_schema='public' and table_name='auth_users'`);
  const nama = cols.rows.map(r => r.column_name);
  check('kolom siswa ditambahkan', ['nama','kelas','siswa_id','akses'].every(k => nama.includes(k)), nama.join(','));

  const akun = await db.query(`select username, akses from auth_users order by username`);
  check('akun lama tetap utuh', akun.rows.length === 2 && akun.rows[0].username === 'admin');
  check('akses default terisi untuk akun lama', akun.rows.every(r => r.akses === 'sendiri'));

  let r = await coba(db, 'siswa setelah migrasi', () => db.query(
    `insert into auth_users (username, password_hash, role, kelas, siswa_id) values ('S001','h','siswa','VII A','s1')`));
  check('akun siswa bisa dibuat setelah migrasi', r.ok);

  r = await coba(db, 'migrasi ulang', () => db.exec(sql('supabase/migrate-akses-siswa.sql')));
  check('migrasi idempotent (dijalankan 2x)', r.ok);

  const cekAkses = await coba(db, 'akses invalid', () => db.query(
    `insert into auth_users (username, password_hash, role, kelas, akses) values ('S9','h','siswa','VII A','all')`));
  check('constraint akses aktif setelah migrasi', !cekAkses.ok);
  await db.close();
}

// ---------- Skenario C: urutan campur (migrasi lalu schema.sql) ----------
console.log('\n-- C. Migrasi lalu schema.sql lengkap --');
{
  const db = new PGlite();
  await db.exec(SCHEMA_LAMA);
  await db.exec(sql('supabase/migrate-akses-siswa.sql'));
  const r = await coba(db, 'schema setelah migrasi', () => db.exec(sql('supabase/schema.sql')));
  check('schema.sql jalan di atas database termigrasi', r.ok);
  const sesi = await db.query(`select column_name from information_schema.columns where table_name='auth_sessions'`);
  const namaSesi = sesi.rows.map(x => x.column_name);
  check('kolom sesi lengkap', ['nama','kelas','siswa_id','akses'].every(k => namaSesi.includes(k)), namaSesi.join(','));
  await db.close();
}

console.log(`\n===== SKEMA: ${pass} lolos, ${fail} gagal =====`);
process.exit(fail ? 1 : 0);
