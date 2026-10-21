// Smoke test UI mode server (jsdom + api/server.js + mock Supabase).
// Jalankan: npm install --no-save jsdom && node tools/ui-server-smoke.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = await import('jsdom')); }
catch { console.error('Butuh jsdom: npm install --no-save jsdom'); process.exit(1); }

function start(cmd, args, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [cmd, ...args], { env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (out += d));
    const timer = setInterval(() => {
      const m = out.match(/(MOCK_SUPABASE_PORT|APP_API_PORT)=(\d+)/);
      if (m) { clearInterval(timer); resolve({ proc: p, port: Number(m[2]) }); }
    }, 30);
    setTimeout(() => { clearInterval(timer); resolve({ proc: p, port: 0, out }); }, 5000);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(nama, kondisi, extra = '') {
  if (kondisi) { pass++; console.log('  ✔ ' + nama); }
  else { fail++; console.log('  ✘ ' + nama + (extra ? ' -> ' + extra : '')); }
}

const mock = await start('tools/mock-supabase.mjs', [], {});
const api = await start('tools/serve-api.mjs', [], {
  SUPABASE_URL: 'http://127.0.0.1:' + mock.port,
  SUPABASE_SERVICE_ROLE_KEY: 'test-key',
});
const API = `http://127.0.0.1:${api.port}`;
await sleep(200);

async function call(route, method = 'GET', body = null, token = '') {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(`${API}/?route=${encodeURIComponent(route)}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

// --- Seed data lewat API (seperti admin sungguhan) ---
const login = await call('auth/login', 'POST', { username: 'admin', password: 'admin123' });
const adminToken = login.data.token;
const richState = {
  tahunAjaranList: '["2025/2026"]',
  tahunAjaranAktif: '2025/2026',
  pengaturan: '{"namaSekolah":"Sekolah Uji","kepalaSekolah":"Kepala Uji"}',
  masterJabatan: '["Kepala Sekolah"]',
  'ta_2025_2026__dataSiswa_v1': JSON.stringify([
    { id: 's1', nisn: 'S001', nama: 'Ahmad', kelas: 'VII A', jenisKelamin: 'L', telepon: '' },
    { id: 's2', nisn: 'S002', nama: 'Budi', kelas: 'VII A', jenisKelamin: 'L', telepon: '' },
    { id: 's3', nisn: 'S003', nama: 'Citra', kelas: 'VIII B', jenisKelamin: 'P', telepon: '' },
  ]),
  'ta_2025_2026__dataAbsensiSiswa_v1': JSON.stringify([
    { id: 'a1', siswaId: 's1', tanggal: '2026-10-01', status: 'Hadir', keterangan: '' },
    { id: 'a2', siswaId: 's1', tanggal: '2026-10-02', status: 'Sakit', keterangan: 'Demam' },
    { id: 'a3', siswaId: 's2', tanggal: '2026-10-01', status: 'Alpa', keterangan: '' },
    { id: 'a4', siswaId: 's3', tanggal: '2026-10-01', status: 'Izin', keterangan: '' },
  ]),
  'ta_2025_2026__pelanggaranSiswa_v1': JSON.stringify([
    { id: 'p1', siswaId: 's1', nisn: 'S001', namaSiswa: 'Ahmad', kelas: 'VII A', kategori: 'Kerajinan', pelanggaran: 'Tugas tidak dikerjakan', sanksi: 'Teguran', skor: 10, tanggal: '2026-10-03' },
    { id: 'p2', siswaId: 's3', nisn: 'S003', namaSiswa: 'Citra', kelas: 'VIII B', kategori: 'Kerapian', pelanggaran: 'Seragam tidak rapi', sanksi: 'Teguran', skor: 5, tanggal: '2026-10-03' },
  ]),
  'ta_2025_2026__dataGuru_v2': JSON.stringify([{ id: 'g1', nama: 'Guru Rahasia', gaji: 9000000 }]),
  'ta_2025_2026__riwayatGaji_v2': JSON.stringify([{ id: 'r1', total: 9999999 }]),
  'ta_2025_2026__dataKehadiran': JSON.stringify([{ id: 'k1', guruId: 'g1' }]),
  'ta_2025_2026__masterHonor_v2': JSON.stringify([{ id: '1', nama: 'Honor Pokok' }]),
};
let r = await call('state/get', 'GET', null, adminToken);
r = await call('state/save', 'PUT', { state: richState, version: r.data.version, force: true }, adminToken);
check('seed state tersimpan', r.status === 200);
r = await call('auth/siswa-accounts', 'POST', {
  accounts: [
    { username: 'S001', password: 'rahasia1', siswaId: 's1', nama: 'Ahmad', kelas: 'VII A', akses: 'sendiri' },
    { username: 'S002', password: 'rahasia2', siswaId: 's2', nama: 'Budi', kelas: 'VII A', akses: 'kelas' },
  ],
}, adminToken);
check('seed akun siswa', r.status === 200 && r.data.accounts.length === 2);

// --- Muat UI (mode server) ---
const html = fs.readFileSync('index.html', 'utf8')
  .replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g, '')
  .replace(/<link[^>]+href="[^"]+"[^>]*>/g, '');

const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const pesan = String(e?.message || e);
  if (!/Could not load|not implemented|fillStyle/i.test(pesan)) console.log('[jsdom error]', pesan);
});

const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.__fetchLog = [];
    window.fetch = (input, init) => {
      let url = input;
      let token = '';
      try { token = (init?.headers?.Authorization || '').replace('Bearer ', ''); } catch (_) {}
      if (typeof url === 'string' && url.startsWith('/api/server')) url = API + url;
      window.__fetchLog.push({ url: String(url), method: init?.method || 'GET', token });
      return fetch(url, init);
    };
  },
});
const { window } = dom;
window.print = () => {};
window.alert = () => {};
window.confirm = () => true;
window.prompt = (_q, d) => d;
const $ = id => window.document.getElementById(id);
const teks = id => ($(id)?.textContent || '').trim();
const submitLogin = async (u, p) => {
  $('loginUsername').value = u;
  $('loginPassword').value = p;
  $('formLogin').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(500);
};
await sleep(300);

console.log('\n-- 1. Login admin mode server --');
await submitLogin('admin', 'admin123');
check('login admin berhasil', window.eval("penggunaAktif?.role") === 'admin');
check('state penuh dimuat', window.eval('dataSiswa.length') === 3 && window.eval('dataGuru.length') === 1);
check('token server tersimpan', !!window.localStorage.getItem('serverToken_v1'));

console.log('\n-- 2. Daftar akun siswa dari server --');
window.eval("showPage('pengaturan')");
await sleep(500);
check('akun siswa termuat dari API', window.eval('akunSiswaTampil.length') === 2, String(window.eval('akunSiswaTampil.length')));
check('tabel menampilkan NISN', $('tabelAkunSiswa').textContent.includes('S001'));
check('badge akun', teks('badgeJumlahAkunSiswa') === '2 akun');

$('siswaAksesKelas').value = 'VIII B';
$('siswaAksesScope').value = 'sendiri';
$('siswaAksesPasswordDefault').value = 'rahasia3';
window.eval('buatAkunSiswaKelas()');
await sleep(900);
check('tambah akun kelas VIII B lewat UI', window.eval('akunSiswaTampil.length') === 3, String(window.eval('akunSiswaTampil.length')));
const daftarServer = await call('auth/siswa-accounts', 'GET', null, adminToken);
check('akun S003 tersimpan di server', daftarServer.data.accounts.some(a => a.username === 'S003' && a.kelas === 'VIII B'));
check('akun lama tetap ada', daftarServer.data.accounts.some(a => a.username === 'S001') && daftarServer.data.accounts.some(a => a.username === 'S002'));

console.log('\n-- 3. Logout membersihkan cache data --');
window.eval('logoutAplikasi()');
await sleep(300);
check('overlay login tampil', !$('loginOverlay').classList.contains('hidden'));
check('data guru dibersihkan dari localStorage', !window.localStorage.getItem('ta_2025_2026__dataGuru_v2'));
check('snapshot data siswa dibersihkan', !window.localStorage.getItem('ta_2025_2026__dataSiswa_v1'));

console.log('\n-- 4. Login siswa (akses sendiri) --');
window.__fetchLog.length = 0;
await submitLogin('S001', 'rahasia1');
check('role siswa', window.eval("penggunaAktif?.role") === 'siswa');
check('kelas dari server', window.eval("penggunaAktif?.kelas") === 'VII A');
check('hanya data sendiri', window.eval('dataSiswa.length') === 1 && window.eval("dataSiswa[0].id") === 's1');
check('hanya absensi sendiri', window.eval('dataAbsensiSiswa.length') === 2);
check('hanya pelanggaran sendiri', window.eval('dataPelanggaranSiswa.length') === 1);
check('tidak ada data guru di localStorage', !window.localStorage.getItem('ta_2025_2026__dataGuru_v2'));
check('tidak ada gaji/kehadiran di localStorage', !window.localStorage.getItem('ta_2025_2026__riwayatGaji_v2') && !window.localStorage.getItem('ta_2025_2026__dataKehadiran'));
check('halaman Absensi Saya tampil', !$('page-absensi-saya').classList.contains('hidden'));
check('nama & kelas tampil', teks('absensiSayaNama') === 'Ahmad' && teks('absensiSayaKelas') === 'VII A');
check('menu hanya Absensi Saya', window.eval(`[...document.querySelectorAll('.nav-btn[data-page]')].filter(b => b.closest('li').style.display !== 'none').map(b => b.dataset.page).join(',')`) === 'absensi-saya');

console.log('\n-- 5. Siswa tidak dapat membuka menu admin --');
window.eval("showPage('data-siswa')");
check('halaman data siswa tetap tersembunyi', $('page-data-siswa').classList.contains('hidden'));
check('halaman absensi saya tetap aktif', !$('page-absensi-saya').classList.contains('hidden'));
window.eval("showPage('pengaturan')");
check('halaman pengaturan tetap tersembunyi', $('page-pengaturan').classList.contains('hidden'));
check('siswa tidak bisa menulis', window.eval('bolehMenulisServer()') === false);

console.log('\n-- 6. Tidak ada state/save dari sesi siswa --');
await sleep(800);
const urlRoute = item => decodeURIComponent(item.url);
const simpanSiswa = window.__fetchLog.filter(item => urlRoute(item).includes('state/save'));
check('tidak ada state/save oleh siswa', simpanSiswa.length === 0, JSON.stringify(simpanSiswa));
const getSiswa = window.__fetchLog.filter(item => urlRoute(item).includes('state/get'));
check('state/get memakai token siswa', getSiswa.length >= 1);

console.log('\n-- 7. Rekap & tata tertib siswa --');
window.eval("document.getElementById('absensiSayaBulan').value='10'; document.getElementById('absensiSayaTahun').value='2026'; renderAbsensiSaya();");
await sleep(150);
check('riwayat 2 baris', $('tabelRiwayatAbsensiSaya').querySelectorAll('tr').length === 2);
check('total skor 10', teks('totalSkorTataTertibSaya') === '10');
check('seksi rekap kelas tersembunyi (akses sendiri)', $('seksiRekapKelasSiswa').classList.contains('hidden'));
let err = '';
try { window.eval('cetakAbsensiSaya()'); } catch (e) { err = e.message; }
check('cetak tidak error', !err, err);

console.log('\n-- 8. Login siswa akses satu kelas --');
window.eval('logoutAplikasi()');
await sleep(250);
await submitLogin('S002', 'rahasia2');
check('role siswa akses kelas', window.eval("penggunaAktif?.akses") === 'kelas');
check('data 2 siswa VII A', window.eval('dataSiswa.length') === 2);
check('tanpa siswa kelas lain', !window.eval("dataSiswa.some(s => s.kelas === 'VIII B')"));
check('absensi kelas VII A saja', window.eval('dataAbsensiSiswa.length') === 3);
window.eval("document.getElementById('absensiSayaBulan').value='10'; document.getElementById('absensiSayaTahun').value='2026'; renderAbsensiSaya();");
await sleep(150);
check('rekap kelas tampil', !$('seksiRekapKelasSiswa').classList.contains('hidden'));
check('rekap kelas 2 siswa', $('tabelRekapKelasSiswa').querySelectorAll('tr').length === 2);
check('rekap kelas tidak memuat kelas lain', !$('tabelRekapKelasSiswa').textContent.includes('Citra'));

console.log('\n-- 8b. Siswa pindah kelas saat login => profil & data ikut --');
const stPindah = await call('state/get', 'GET', null, adminToken);
const statePindah = JSON.parse(JSON.stringify(stPindah.data.state));
const daftarPindah = JSON.parse(statePindah['ta_2025_2026__dataSiswa_v1']);
daftarPindah.find(siswa => siswa.id === 's2').kelas = 'VIII B';
statePindah['ta_2025_2026__dataSiswa_v1'] = JSON.stringify(daftarPindah);
r = await call('state/save', 'PUT', { state: statePindah, version: stPindah.data.version, force: true }, adminToken);
check('admin memindahkan siswa via API', r.status === 200);
window.eval('tarikPerubahanServerJikaAda()');
await sleep(900);
check('profil kelas diperbarui otomatis', window.eval("penggunaAktif?.kelas") === 'VIII B', String(window.eval("penggunaAktif?.kelas")));
check('data yang dikirim ikut kelas baru', window.eval('dataSiswa.length') === 2 && window.eval("dataSiswa.every(s => s.kelas === 'VIII B')"));
check('badge kelas diperbarui', $('loginUserRole').textContent.includes('VIII B'), $('loginUserRole').textContent);
window.eval("document.getElementById('absensiSayaBulan').value='10'; document.getElementById('absensiSayaTahun').value='2026'; renderAbsensiSaya();");
await sleep(150);
check('rekap kelas baru tidak memuat kelas lama', !$('tabelRekapKelasSiswa').textContent.includes('Ahmad'));

console.log('\n-- 9. Admin kembali: data penuh lagi --');
window.eval('logoutAplikasi()');
await sleep(250);
await submitLogin('admin', 'admin123');
check('admin melihat data penuh lagi', window.eval('dataSiswa.length') === 3 && window.eval('dataGuru.length') === 1);
check('dashboard aktif untuk admin', !$('page-dashboard').classList.contains('hidden'));

mock.proc.kill(); api.proc.kill();
console.log(`\n===== UI SERVER: ${pass} lolos, ${fail} gagal =====`);
process.exit(fail ? 1 : 0);
