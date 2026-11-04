// Uji riwayat snapshot + pemulihan data (api/server.js + mock Supabase + UI jsdom).
// Jalankan: npm install --no-save jsdom && node tools/riwayat-check.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = await import('jsdom')); }
catch { console.error('Butuh jsdom: npm install --no-save jsdom'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(nama, kondisi, extra = '') {
  if (kondisi) { pass++; console.log('  ✔ ' + nama); }
  else { fail++; console.log('  ✘ ' + nama + (extra ? ' -> ' + extra : '')); }
}

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

const mock = await start('tools/mock-supabase.mjs', [], {});
const api = await start('tools/serve-api.mjs', [], {
  SUPABASE_URL: 'http://127.0.0.1:' + mock.port,
  SUPABASE_SERVICE_ROLE_KEY: 'test-key',
});
const API = `http://127.0.0.1:${api.port}`;
await sleep(250);

async function call(route, method = 'GET', body = null, token = '') {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(`${API}/?route=${encodeURIComponent(route)}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const loginAdmin = await call('auth/login', 'POST', { username: 'admin', password: 'admin123' });
const adminToken = loginAdmin.data.token;
const loginGuru = await call('auth/login', 'POST', { username: 'guru', password: 'guru123' });
const guruToken = loginGuru.data.token;

const buatState = (nama) => ({
  tahunAjaranList: '["2025/2026"]',
  tahunAjaranAktif: '2025/2026',
  pengaturan: JSON.stringify({ namaSekolah: nama }),
  'ta_2025_2026__dataSiswa_v1': JSON.stringify([{ id: 's1', nama: nama + ' 1' }, { id: 's2', nama: nama + ' 2' }]),
  'ta_2025_2026__dataGuru_v2': JSON.stringify([{ id: 'g1', nama: 'Guru ' + nama }]),
  'ta_2025_2026__dataKehadiran': JSON.stringify([{ id: 'k1', tanggal: '2026-10-01' }]),
});

// ================= 1. Simpan beberapa versi =================
console.log('\n-- 1. Riwayat terbentuk dari penyimpanan --');
let sekarang = await call('state/get', 'GET', null, adminToken);
for (const nama of ['Versi A', 'Versi B', 'Versi C']) {
  const simpan = await call('state/save', 'PUT', { state: buatState(nama), version: sekarang.data.version, force: false }, adminToken);
  check(`simpan ${nama}`, simpan.status === 200, JSON.stringify(simpan.data));
  sekarang = await call('state/get', 'GET', null, adminToken);
}
check('versi server naik ke 3', Number(sekarang.data.version) === 3, String(sekarang.data.version));

let riwayat = await call('state/history', 'GET', null, adminToken);
check('riwayat bisa dibaca admin', riwayat.status === 200, JSON.stringify(riwayat.data));
check('riwayat berisi 2 versi sebelumnya', riwayat.data.riwayat?.length === 2, String(riwayat.data.riwayat?.length));
const v1 = riwayat.data.riwayat.find(r => r.version === 1);
check('versi 1 tercatat dengan isi Versi A', !!v1);
check('riwayat memuat jumlah siswa', v1?.jumlahSiswa === 2, String(v1?.jumlahSiswa));
check('riwayat memuat jumlah guru', v1?.jumlahGuru === 1, String(v1?.jumlahGuru));
check('riwayat memuat jumlah kehadiran', v1?.jumlahKehadiran === 1, String(v1?.jumlahKehadiran));
check('riwayat memuat ukuran', (v1?.ukuran || 0) > 0, String(v1?.ukuran));
check('riwayat punya waktu', !!v1?.createdAt);

// ================= 2. Pemulihan =================
console.log('\n-- 2. Pulihkan versi lama --');
const pulih = await call('state/restore', 'POST', { historyId: v1.id }, adminToken);
check('pemulihan berhasil', pulih.status === 200 && pulih.data.ok === true, JSON.stringify(pulih.data));
check('versi baru setelah pulih', Number(pulih.data.version) === 4, String(pulih.data.version));
check('melaporkan versi asal', Number(pulih.data.dariVersion) === 1, String(pulih.data.dariVersion));

sekarang = await call('state/get', 'GET', null, adminToken);
check('data kembali ke Versi A', sekarang.data.state.pengaturan.includes('Versi A'), sekarang.data.state.pengaturan);
check('jumlah siswa pada data pulih', JSON.parse(sekarang.data.state['ta_2025_2026__dataSiswa_v1']).length === 2);

riwayat = await call('state/history', 'GET', null, adminToken);
check('versi sebelum pulih ikut diarsipkan', riwayat.data.riwayat.some(r => r.version === 3));
check('versi asal tetap ada di riwayat', riwayat.data.riwayat.some(r => r.version === 1));

// ================= 3. Pemulihan bisa dibatalkan =================
console.log('\n-- 3. Pemulihan bisa dibatalkan --');
const arsipV3 = riwayat.data.riwayat.find(r => r.version === 3);
const batal = await call('state/restore', 'POST', { historyId: arsipV3.id }, adminToken);
check('pulihkan lagi ke versi 3 berhasil', batal.status === 200 && batal.data.ok === true);
sekarang = await call('state/get', 'GET', null, adminToken);
check('data kembali ke Versi C', sekarang.data.state.pengaturan.includes('Versi C'), sekarang.data.state.pengaturan);

// ================= 4. Batas kewenangan =================
console.log('\n-- 4. Batas kewenangan --');
let r = await call('state/history', 'GET', null, '');
check('tanpa token ditolak', r.status === 401, String(r.status));
r = await call('state/history', 'GET', null, guruToken);
check('guru tidak boleh melihat riwayat', r.status === 403, String(r.status));
r = await call('state/restore', 'POST', { historyId: v1.id }, guruToken);
check('guru tidak boleh memulihkan', r.status === 403, String(r.status));
r = await call('state/restore', 'POST', { historyId: 999999 }, adminToken);
check('id riwayat tak dikenal => 404', r.status === 404, String(r.status));
r = await call('state/restore', 'POST', {}, adminToken);
check('tanpa historyId => 400', r.status === 400, String(r.status));
r = await call('state/restore', 'GET', null, adminToken);
check('method salah => 405', r.status === 405, String(r.status));

// Akun siswa read-only.
sekarang = await call('state/get', 'GET', null, adminToken);
await call('auth/siswa-accounts', 'POST', {
  accounts: [{ username: 'S001', password: 'rahasia1', siswaId: 's1', nama: 'Siswa Satu', kelas: 'VII A', akses: 'sendiri' }],
}, adminToken);
await call('state/save', 'PUT', { state: sekarang.data.state, version: sekarang.data.version, force: false }, adminToken);
const loginSiswa = await call('auth/login', 'POST', { username: 'S001', password: 'rahasia1' });
r = await call('state/history', 'GET', null, loginSiswa.data.token);
check('siswa tidak boleh melihat riwayat', r.status === 403, String(r.status));

// ================= 5. Riwayat dipangkas 30 versi =================
console.log('\n-- 5. Riwayat maksimal 30 versi --');
sekarang = await call('state/get', 'GET', null, adminToken);
for (let i = 0; i < 35; i++) {
  const simpan = await call('state/save', 'PUT', { state: buatState('Mundur ' + i), version: sekarang.data.version, force: false }, adminToken);
  sekarang = await call('state/get', 'GET', null, adminToken);
  if (simpan.status !== 200) break;
}
riwayat = await call('state/history', 'GET', null, adminToken);
check('riwayat dipangkas tepat 30', riwayat.data.riwayat?.length === 30, String(riwayat.data.riwayat?.length));
const versiRiwayat = riwayat.data.riwayat.map(x => x.version);
check('riwayat terbaru di urutan pertama', versiRiwayat[0] > versiRiwayat[versiRiwayat.length - 1], versiRiwayat.slice(0, 3).join(','));

// ================= 6. UI Pengaturan =================
console.log('\n-- 6. Halaman Pengaturan: tabel riwayat & tombol pulihkan --');
const html = fs.readFileSync('index.html', 'utf8')
  .replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g, '')
  .replace(/<link[^>]+href="[^"]+"[^>]*>/g, '');
const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const pesan = String(e?.message || e);
  if (!/Could not load|not implemented|fillStyle|Not implemented/i.test(pesan)) console.log('[jsdom error]', pesan);
});
const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.fetch = (input, init) => {
      let url = input;
      if (typeof url === 'string' && url.startsWith('/api/server')) url = API + url;
      return fetch(url, init);
    };
  },
});
const { window } = dom;
window.print = () => {};
window.alert = () => {};
window.confirm = () => true;
await sleep(400);
const $ = id => window.document.getElementById(id);
$('loginUsername').value = 'admin';
$('loginPassword').value = 'admin123';
$('formLogin').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(700);
check('login admin di UI', window.eval('penggunaAktif?.role') === 'admin');

window.eval("showPage('pengaturan')");
await sleep(900);
const barisRiwayat = $('tbodyRiwayatData')?.querySelectorAll('tr') || [];
check('tabel riwayat terisi', barisRiwayat.length === 30, String(barisRiwayat.length));
check('tabel menampilkan tombol Pulihkan', (barisRiwayat[0]?.textContent || '').includes('Pulihkan'));
check('tabel menampilkan versi', (barisRiwayat[0]?.textContent || '').includes('v'));
check('keterangan jumlah versi tampil', ($('infoRiwayatData')?.textContent || '').includes('30'));

const targetId = window.eval('riwayatDataServer[0].id');
const pengaturanSebelum = window.eval("JSON.parse(localStorage.getItem('pengaturan') || '{}').namaSekolah");
const versiSebelum = window.eval('serverStateVersion');
await window.eval(`pulihkanData('${targetId}')`);
await sleep(1400);
sekarang = await call('state/get', 'GET', null, adminToken);
check('server memulihkan data lewat UI', Number(sekarang.data.version) > versiSebelum, String(sekarang.data.version));
check('versi lokal mengikuti server', Number(window.eval('serverStateVersion')) === Number(sekarang.data.version), `${window.eval('serverStateVersion')} vs ${sekarang.data.version}`);
check('data lokal diperbarui dari hasil pemulihan', window.eval("JSON.parse(localStorage.getItem('pengaturan') || '{}').namaSekolah") === JSON.parse(sekarang.data.state.pengaturan).namaSekolah, `${pengaturanSebelum} -> ${window.eval("JSON.parse(localStorage.getItem('pengaturan') || '{}').namaSekolah")}`);
check('riwayat dimuat ulang setelah pemulihan', window.eval('riwayatDataServer.length') === 30);
check('status sinkron kembali tersimpan', window.eval('statusSinkronServer') === 'saved', window.eval('statusSinkronServer'));

// Non-admin tidak melihat kartu riwayat
window.eval('logoutAplikasi()');
await sleep(300);
$('loginUsername').value = 'guru';
$('loginPassword').value = 'guru123';
$('formLogin').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(700);
check('login guru', window.eval('penggunaAktif?.role') === 'guru');
const kartuRiwayat = [...window.document.querySelectorAll('[data-admin-only]')]
  .some(el => (el.textContent || '').includes('Riwayat Data'));
const kartuTersembunyi = [...window.document.querySelectorAll('[data-admin-only]')]
  .filter(el => (el.textContent || '').includes('Riwayat Data'))
  .every(el => el.style.display === 'none');
check('kartu riwayat disembunyikan untuk guru', !kartuRiwayat || kartuTersembunyi);
window.eval("muatRiwayatData()");
await sleep(500);
check('guru tidak bisa memuat riwayat', ($('tbodyRiwayatData')?.textContent || '').includes('Hanya admin'));

window.close();
mock.proc.kill();
api.proc.kill();

console.log(`\n===== RIWAYAT: ${pass} lolos, ${fail} gagal =====`);
process.exit(fail === 0 ? 0 : 1);
