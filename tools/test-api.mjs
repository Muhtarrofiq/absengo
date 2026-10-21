// Uji end-to-end kontrak API terhadap mock Supabase.
// Menjalankan mock-supabase + serve-api lalu mensimulasikan alur:
// login admin -> state kosong -> save (migrasi) -> get -> conflict -> logout.
import { spawn } from 'node:child_process';

function start(cmd, args, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [cmd, ...args], { env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (out += d));
    const timer = setInterval(() => {
      const m = out.match(/(MOCK_SUPABASE_PORT|APP_API_PORT)=(\d+)/);
      if (m) {
        clearInterval(timer);
        resolve({ proc: p, port: Number(m[2]) });
      }
    }, 30);
    setTimeout(() => { clearInterval(timer); resolve({ proc: p, port: 0, out }); }, 5000);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  -> ' + extra : '')); }
}

const mock = await start('tools/mock-supabase.mjs', [], {});
const mockPort = mock.port;
console.log('mock supabase port:', mockPort);

const api = await start('tools/serve-api.mjs', [], {
  SUPABASE_URL: 'http://127.0.0.1:' + mockPort,
  SUPABASE_SERVICE_ROLE_KEY: 'test-key',
});
const apiPort = api.port;
console.log('app api port:', apiPort);
await sleep(200);

const BASE = `http://127.0.0.1:${apiPort}`;
async function call(route, method = 'GET', body = null, token = '') {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(`${BASE}/?route=${encodeURIComponent(route)}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

console.log('\n-- 1. Login tanpa konfigurasi env (harusnya 500 not configured di kenyataan; di sini env ada) --');
console.log('-- 2. Login admin salah password --');
let r = await call('auth/login', 'POST', { username: 'admin', password: 'wrong' });
check('login salah password => 401', r.status === 401 && r.data.ok === false);

console.log('\n-- 3. Login admin benar --');
r = await call('auth/login', 'POST', { username: 'admin', password: 'admin123' });
check('login benar => ok + token + user', r.status === 200 && r.data.ok === true && !!r.data.token && r.data.user.role === 'admin');
const token = r.data.token;

console.log('\n-- 4. auth/me dengan token --');
r = await call('auth/me', 'GET', null, token);
check('me => user admin', r.status === 200 && r.data.ok === true && r.data.user.role === 'admin');

console.log('\n-- 5. state/get (masih kosong) --');
r = await call('state/get', 'GET', null, token);
check('state kosong => state null version 0', r.status === 200 && r.data.state === null && r.data.version === 0);

console.log('\n-- 6. state/save migrasi (force=true, version 0) --');
const snapshot = { 'tahunAjaranList': '["2025/2026"]', 'tahunAjaranAktif': '2025/2026', 'pengaturan': '{"namaSekolah":"X"}' };
r = await call('state/save', 'PUT', { state: snapshot, version: 0, force: true }, token);
check('save => version 1', r.status === 200 && r.data.ok === true && r.data.version === 1);
const v1 = r.data.version;

console.log('\n-- 7. state/get setelah save --');
r = await call('state/get', 'GET', null, token);
check('state tersimpan', r.status === 200 && r.data.state['pengaturan'] && r.data.version === 1);

console.log('\n-- 8. state/save versi salah (simulasi konflik perangkat lain) --');
// perangkat lain menambah versi ke 2
await call('state/save', 'PUT', { state: { ...snapshot, pengaturan: '{"namaSekolah":"Y"}' }, version: 1, force: true }, token);
r = await call('state/save', 'PUT', { state: snapshot, version: 1, force: false }, token);
check('konflik => 409', r.status === 409 && r.data.ok === false);

console.log('\n-- 9. state/save versi benar (2) --');
r = await call('state/save', 'PUT', { state: snapshot, version: 2, force: false }, token);
check('save versi 2 => ok', r.status === 200 && r.data.ok === true && r.data.version === 3);

console.log('\n-- 10. update-accounts (admin) --');
r = await call('auth/update-accounts', 'POST', { accounts: { admin: { username: 'admin', password: 'admin999', role: 'admin' }, guru: { username: 'guru', password: 'guru999', role: 'guru' } } }, token);
check('update akun => ok', r.status === 200 && r.data.ok === true);

console.log('\n-- 11. login dengan password baru --');
r = await call('auth/login', 'POST', { username: 'admin', password: 'admin999' });
check('login password baru => ok', r.status === 200 && r.data.ok === true);

console.log('\n-- 12. logout --');
r = await call('auth/logout', 'POST', null, token);
check('logout => ok', r.status === 200 && r.data.ok === true);
r = await call('auth/me', 'GET', null, token);
check('token invalid setelah logout => 401', r.status === 401);

console.log('\n-- 13. state/get tanpa token => 401 --');
r = await call('state/get', 'GET', null, '');
check('tanpa token => 401', r.status === 401);

console.log('\n-- 14. route tidak dikenal => 404 --');
r = await call('bogus/route', 'GET', null, token);
check('route bogus => 404', r.status === 404);

console.log('\n-- 15. update-accounts oleh guru => 403 --');
let g = await call('auth/login', 'POST', { username: 'guru', password: 'guru999' });
let gt = g.data.token;
r = await call('auth/update-accounts', 'POST', { accounts: { admin: { username: 'a', password: 'p', role: 'admin' }, guru: { username: 'g', password: 'p', role: 'guru' } } }, gt);
check('guru update akun => 403', r.status === 403);

console.log('\n-- 16. Siapkan snapshot kaya data (admin) untuk uji filter kelas --');
let adminLogin = await call('auth/login', 'POST', { username: 'admin', password: 'admin999' });
const adminToken = adminLogin.data.token;
check('login admin ulang => ok', adminLogin.status === 200 && !!adminToken);
let stateNow = await call('state/get', 'GET', null, adminToken);
const richState = {
  tahunAjaranList: '["2025/2026"]',
  tahunAjaranAktif: '2025/2026',
  pengaturan: '{"namaSekolah":"Sekolah Uji"}',
  'ta_2025_2026__dataSiswa_v1': JSON.stringify([
    { id: 's1', nisn: 'S001', nama: 'Ahmad', kelas: 'VII A' },
    { id: 's2', nisn: 'S002', nama: 'Budi', kelas: 'VII A' },
    { id: 's3', nisn: 'S003', nama: 'Citra', kelas: 'VIII B' },
  ]),
  'ta_2025_2026__dataAbsensiSiswa_v1': JSON.stringify([
    { id: 'a1', siswaId: 's1', tanggal: '2026-10-01', status: 'Hadir' },
    { id: 'a2', siswaId: 's2', tanggal: '2026-10-01', status: 'Sakit' },
    { id: 'a3', siswaId: 's3', tanggal: '2026-10-01', status: 'Alpa' },
  ]),
  'ta_2025_2026__pelanggaranSiswa_v1': JSON.stringify([
    { id: 'p1', siswaId: 's1', nisn: 'S001', namaSiswa: 'Ahmad', kelas: 'VII A', skor: 10 },
    { id: 'p2', siswaId: 's3', nisn: 'S003', namaSiswa: 'Citra', kelas: 'VIII B', skor: 5 },
  ]),
  'ta_2025_2026__dataGuru_v2': JSON.stringify([{ id: 'g1', nama: 'Guru Rahasia' }]),
  'ta_2025_2026__riwayatGaji_v2': JSON.stringify([{ id: 'r1', total: 9999999 }]),
  'ta_2025_2026__dataKehadiran': JSON.stringify([{ id: 'k1' }]),
  masterJabatan: '["Kepala Sekolah"]',
};
r = await call('state/save', 'PUT', { state: richState, version: stateNow.data.version, force: true }, adminToken);
check('simpan snapshot kaya => ok', r.status === 200 && r.data.ok === true);

console.log('\n-- 17. Buat akun siswa per kelas (admin) --');
const akunSiswa = [
  { username: 'S001', password: 'rahasia1', siswaId: 's1', nama: 'Ahmad', kelas: 'VII A', akses: 'sendiri' },
  { username: 'S002', password: 'rahasia2', siswaId: 's2', nama: 'Budi', kelas: 'VII A', akses: 'kelas' },
];
r = await call('auth/siswa-accounts', 'POST', { accounts: akunSiswa }, adminToken);
check('buat 2 akun siswa => ok', r.status === 200 && r.data.ok === true);
check('akun siswa tersimpan lengkap', r.data.accounts?.length === 2 && r.data.accounts.some(a => a.username === 'S001' && a.kelas === 'VII A'));

console.log('\n-- 18. Daftar akun siswa (admin) tanpa hash password --');
r = await call('auth/siswa-accounts', 'GET', null, adminToken);
check('list akun siswa => 2 akun', r.status === 200 && r.data.accounts.length === 2);
check('tidak membocorkan password_hash', !JSON.stringify(r.data.accounts).includes('password_hash'));

console.log('\n-- 19. Login siswa & batas akses "sendiri" --');
let s1 = await call('auth/login', 'POST', { username: 'S001', password: 'rahasia1' });
check('login siswa => role siswa + kelas', s1.status === 200 && s1.data.user.role === 'siswa' && s1.data.user.kelas === 'VII A');
const s1Token = s1.data.token;
r = await call('auth/me', 'GET', null, s1Token);
check('auth/me siswa => akses sendiri', r.status === 200 && r.data.user.akses === 'sendiri');
r = await call('state/get', 'GET', null, s1Token);
const stateS1 = r.data.state || {};
const siswaS1 = JSON.parse(stateS1['ta_2025_2026__dataSiswa_v1'] || '[]');
const absenS1 = JSON.parse(stateS1['ta_2025_2026__dataAbsensiSiswa_v1'] || '[]');
const tatibS1 = JSON.parse(stateS1['ta_2025_2026__pelanggaranSiswa_v1'] || '[]');
check('state siswa hanya memuat siswanya sendiri', siswaS1.length === 1 && siswaS1[0].id === 's1');
check('state siswa hanya memuat absensinya', absenS1.length === 1 && absenS1[0].siswaId === 's1');
check('state siswa hanya memuat pelanggarannya', tatibS1.length === 1 && tatibS1[0].siswaId === 's1');
check('data guru/gaji tidak terkirim ke siswa', !stateS1['ta_2025_2026__dataGuru_v2'] && !stateS1['ta_2025_2026__riwayatGaji_v2'] && !stateS1['ta_2025_2026__dataKehadiran'] && !stateS1.masterJabatan);
check('pengaturan & tata tertib tetap tersedia', !!stateS1.pengaturan && stateS1.tahunAjaranAktif === '2025/2026');

console.log('\n-- 20. Akses "kelas" hanya satu kelas --');
let s2 = await call('auth/login', 'POST', { username: 'S002', password: 'rahasia2' });
const s2Token = s2.data.token;
r = await call('state/get', 'GET', null, s2Token);
const stateS2 = r.data.state || {};
const siswaS2 = JSON.parse(stateS2['ta_2025_2026__dataSiswa_v1'] || '[]');
const absenS2 = JSON.parse(stateS2['ta_2025_2026__dataAbsensiSiswa_v1'] || '[]');
const tatibS2 = JSON.parse(stateS2['ta_2025_2026__pelanggaranSiswa_v1'] || '[]');
check('akses kelas => 2 siswa kelas VII A saja', siswaS2.length === 2 && siswaS2.every(s => s.kelas === 'VII A'));
check('akses kelas => absensi kelas VII A saja', absenS2.length === 2 && absenS2.every(a => ['s1', 's2'].includes(a.siswaId)));
check('akses kelas => pelanggaran kelas VII A saja', tatibS2.length === 1 && tatibS2[0].siswaId === 's1');

console.log('\n-- 21. Siswa tidak boleh menulis data --');
r = await call('state/save', 'PUT', { state: { hacked: '1' }, version: 999, force: true }, s1Token);
check('siswa state/save => 403', r.status === 403 && r.data.ok === false);
r = await call('auth/siswa-accounts', 'POST', { accounts: [] }, s1Token);
check('siswa ubah akun => 403', r.status === 403);
r = await call('auth/siswa-accounts', 'GET', null, s1Token);
check('siswa lihat daftar akun => 403', r.status === 403);
r = await call('auth/update-accounts', 'POST', { accounts: { admin: { username: 'x', password: 'y' }, guru: { username: 'z', password: 'w' } } }, s1Token);
check('siswa ubah akun admin/guru => 403', r.status === 403);

console.log('\n-- 22. Guru tidak boleh mengelola akun siswa --');
r = await call('auth/siswa-accounts', 'GET', null, gt);
check('guru list akun siswa => 403', r.status === 403);

console.log('\n-- 23. Validasi akun siswa --');
r = await call('auth/siswa-accounts', 'POST', { accounts: [{ username: 'admin', password: 'x', kelas: 'VII A', siswaId: 's9' }] }, adminToken);
check('username admin ditolak => 400', r.status === 400);
r = await call('auth/siswa-accounts', 'POST', { accounts: [{ username: 'S001', password: 'x', kelas: 'VII A', siswaId: 's1' }, { username: 'S001', password: 'y', kelas: 'VII A', siswaId: 's2' }] }, adminToken);
check('username duplikat ditolak => 400', r.status === 400);
r = await call('auth/siswa-accounts', 'POST', { accounts: [{ username: 'S001', password: 'x', kelas: 'VII A', siswaId: 's1' }, { username: 'S009', password: 'x', kelas: 'VII A', siswaId: 's1' }] }, adminToken);
check('satu siswa dua akun ditolak => 400', r.status === 400);

console.log('\n-- 23b. Siswa pindah kelas => akses ikut data terbaru --');
const stAdmin = await call('state/get', 'GET', null, adminToken);
const statePindah = JSON.parse(JSON.stringify(stAdmin.data.state));
const daftarSiswaPindah = JSON.parse(statePindah['ta_2025_2026__dataSiswa_v1']);
daftarSiswaPindah.find(siswa => siswa.id === 's1').kelas = 'VIII B';
statePindah['ta_2025_2026__dataSiswa_v1'] = JSON.stringify(daftarSiswaPindah);
r = await call('state/save', 'PUT', { state: statePindah, version: stAdmin.data.version, force: true }, adminToken);
check('simpan perpindahan kelas => ok', r.status === 200);
r = await call('state/get', 'GET', null, s1Token);
const siswaSetelahPindah = JSON.parse(r.data.state['ta_2025_2026__dataSiswa_v1'] || '[]');
check('sesi lama tetap memakai kelas terbaru', siswaSetelahPindah.length === 1 && siswaSetelahPindah[0].kelas === 'VIII B', JSON.stringify(siswaSetelahPindah));
check('profile kelas diperbarui', r.data.profile && r.data.profile.kelas === 'VIII B');
let s1Ulang = await call('auth/login', 'POST', { username: 'S001', password: 'rahasia1' });
check('login ulang memakai kelas terbaru', s1Ulang.status === 200 && s1Ulang.data.user.kelas === 'VIII B');
r = await call('auth/siswa-accounts', 'GET', null, adminToken);
check('daftar akun ikut diperbarui', r.data.accounts.some(a => a.username === 'S001' && a.kelas === 'VIII B'));

console.log('\n-- 24. Hapus akun siswa mencabut sesi --');
r = await call('auth/siswa-accounts', 'POST', { accounts: [] }, adminToken);
check('hapus semua akun siswa => ok', r.status === 200 && r.data.accounts.length === 0);
r = await call('auth/me', 'GET', null, s1Token);
check('token siswa lama => 401', r.status === 401);
r = await call('auth/login', 'POST', { username: 'S001', password: 'rahasia1' });
check('login siswa terhapus => 401', r.status === 401);

mock.proc.kill(); api.proc.kill();
console.log(`\n===== HASIL: ${pass} lolos, ${fail} gagal =====`);
process.exit(fail ? 1 : 0);
