// Uji sinkronisasi lintas perangkat (dua "perangkat" jsdom + api/server.js + mock Supabase).
// Menjamin data tidak hilang saat dua perangkat menulis bersamaan.
// Jalankan: npm install --no-save jsdom && node tools/sinkron-check.mjs
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

// --- Data awal di server ---
const loginAwal = await call('auth/login', 'POST', { username: 'admin', password: 'admin123' });
const adminToken = loginAwal.data.token;
const stateAwal = {
  tahunAjaranList: '["2025/2026"]',
  tahunAjaranAktif: '2025/2026',
  pengaturan: JSON.stringify({ namaSekolah: 'Sekolah Uji', kepalaSekolah: 'Kepala Uji' }),
  masterJabatan: '["Kepala Sekolah"]',
  'ta_2025_2026__dataSiswa_v1': JSON.stringify([{ id: 's1', nisn: 'S001', nama: 'Ahmad', kelas: 'VII A' }]),
  'ta_2025_2026__dataGuru_v2': JSON.stringify([{ id: 'g1', nama: 'Guru Satu', kode: 'A' }]),
  'ta_2025_2026__dataKehadiran': JSON.stringify([{ id: 'k1', guruId: 'g1', tanggal: '2026-10-01', jumlah: 2 }]),
};
let r = await call('state/get', 'GET', null, adminToken);
r = await call('state/save', 'PUT', { state: stateAwal, version: r.data.version, force: true }, adminToken);
check('state awal tersimpan di server', r.status === 200, JSON.stringify(r.data));

const html = fs.readFileSync('index.html', 'utf8')
  .replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g, '')
  .replace(/<link[^>]+href="[^"]+"[^>]*>/g, '');

function buatPerangkat(label) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const pesan = String(e?.message || e);
    if (!/Could not load|not implemented|fillStyle|Not implemented/i.test(pesan)) console.log(`[${label}] jsdom error`, pesan);
  });
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.__fetchLog = [];
      window.__matikanAuthMe = false;
      window.fetch = (input, init) => {
        let url = input;
        if (typeof url === 'string' && url.startsWith('/api/server')) url = API + url;
        window.__fetchLog.push({
          url: String(url),
          method: init?.method || 'GET',
          keepalive: !!init?.keepalive,
        });
        if (window.__matikanAuthMe && String(url).includes('auth%2Fme')) {
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        return fetch(url, init);
      };
    },
  });
  const { window } = dom;
  window.print = () => {};
  window.alert = () => {};
  window.confirm = () => true;
  window.prompt = (_q, d) => d;
  return { dom, window, label };
}

async function loginSebagai(perangkat, u = 'admin', p = 'admin123') {
  const { window } = perangkat;
  window.document.getElementById('loginUsername').value = u;
  window.document.getElementById('loginPassword').value = p;
  window.document.getElementById('formLogin').dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true })
  );
  await sleep(600);
}

const A = buatPerangkat('A');
const B = buatPerangkat('B');
await sleep(400);

// ================= 1. Gabung tiga arah (fungsi murni) =================
console.log('\n-- 1. Gabung tiga arah: tambah data di dua perangkat --');
const ujiGabung = (base, lokal, server) => {
  A.window.__in = JSON.stringify([base, lokal, server]);
  return A.window.eval('JSON.parse(JSON.stringify(gabungStateTigaArah.apply(null, JSON.parse(window.__in))))');
};
const hasil1 = ujiGabung(
  { 'ta_2025_2026__dataSiswa_v1': JSON.stringify([{ id: 's1', nama: 'Ahmad' }]) },
  { 'ta_2025_2026__dataSiswa_v1': JSON.stringify([{ id: 's1', nama: 'Ahmad' }, { id: 's2', nama: 'Budi' }]) },
  { 'ta_2025_2026__dataSiswa_v1': JSON.stringify([{ id: 's1', nama: 'Ahmad' }, { id: 's3', nama: 'Citra' }]) }
);
let siswaGabung = JSON.parse(hasil1.state['ta_2025_2026__dataSiswa_v1']);
check('tambahan perangkat ini tetap ada', siswaGabung.some(s => s.id === 's2'));
check('tambahan perangkat lain tetap ada', siswaGabung.some(s => s.id === 's3'));
check('data lama tidak hilang', siswaGabung.some(s => s.id === 's1'));

console.log('\n-- 2. Gabung tiga arah: sunting & hapus --');
const hasil2 = ujiGabung(
  { 'ta_2025_2026__uji': JSON.stringify([{ id: 'a', nilai: 1 }, { id: 'b', nilai: 2 }]) },
  { 'ta_2025_2026__uji': JSON.stringify([{ id: 'a', nilai: 9 }, { id: 'b', nilai: 2 }]) },
  { 'ta_2025_2026__uji': JSON.stringify([{ id: 'a', nilai: 1 }]) }
);
let arr2 = JSON.parse(hasil2.state['ta_2025_2026__uji']);
check('suntingan lokal menang atas data lama server', arr2.find(x => x.id === 'a').nilai === 9);
check('hapus di server dihormati bila lokal tidak mengubah', !arr2.some(x => x.id === 'b'));

const hasil3 = ujiGabung(
  { 'ta_2025_2026__uji': JSON.stringify([{ id: 'a', nilai: 1 }, { id: 'b', nilai: 2 }]) },
  { 'ta_2025_2026__uji': JSON.stringify([{ id: 'a', nilai: 1 }]) },
  { 'ta_2025_2026__uji': JSON.stringify([{ id: 'a', nilai: 5 }, { id: 'b', nilai: 2 }]) }
);
const arr3 = JSON.parse(hasil3.state['ta_2025_2026__uji']);
check('hapus lokal dihormati bila server tidak mengubah', !arr3.some(x => x.id === 'b'));
check('perubahan server pada entri lain tetap masuk', arr3.find(x => x.id === 'a').nilai === 5);

const hasil4 = ujiGabung(
  { pengaturan: JSON.stringify({ namaSekolah: 'Lama', kepalaSekolah: '-', telepon: '1' }) },
  { pengaturan: JSON.stringify({ namaSekolah: 'Baru Lokal', kepalaSekolah: '-', telepon: '1' }) },
  { pengaturan: JSON.stringify({ namaSekolah: 'Lama', kepalaSekolah: 'Pak Kepala', telepon: '1' }) }
);
const pengaturanGabung = JSON.parse(hasil4.state.pengaturan);
check('pengaturan: suntingan lokal tersimpan', pengaturanGabung.namaSekolah === 'Baru Lokal');
check('pengaturan: suntingan server tersimpan', pengaturanGabung.kepalaSekolah === 'Pak Kepala');
check('pengaturan: kolom lain utuh', pengaturanGabung.telepon === '1');

// ================= 3. Dua perangkat menulis bersamaan =================
console.log('\n-- 3. Dua perangkat menambah data berbeda --');
await loginSebagai(A);
await loginSebagai(B);
check('perangkat A login', A.window.eval('penggunaAktif?.role') === 'admin');
check('perangkat B login', B.window.eval('penggunaAktif?.role') === 'admin');
check('A memuat data server', A.window.eval("dataSiswa.map(s => s.id).join(',')") === 's1');
check('B memuat data server', B.window.eval("dataSiswa.map(s => s.id).join(',')") === 's1');

A.window.eval("dataSiswa.push({ id: 'sA', nisn: 'A01', nama: 'Siswa A', kelas: 'VII A' }); taSet('dataSiswa_v1', dataSiswa);");
await sleep(900);
let sekarang = await call('state/get', 'GET', null, adminToken);
check('tambahan perangkat A sampai ke server', JSON.parse(sekarang.data.state['ta_2025_2026__dataSiswa_v1']).some(s => s.id === 'sA'));

// B belum tahu sA (tidak ada tarik 15 detik dalam pengujian) -> akan 409 lalu gabung.
B.window.eval("dataSiswa.push({ id: 'sB', nisn: 'B01', nama: 'Siswa B', kelas: 'VII A' }); taSet('dataSiswa_v1', dataSiswa);");
await sleep(1800);
sekarang = await call('state/get', 'GET', null, adminToken);
const siswaServer = JSON.parse(sekarang.data.state['ta_2025_2026__dataSiswa_v1']);
check('perangkat B tetap menyimpan datanya', siswaServer.some(s => s.id === 'sB'), JSON.stringify(siswaServer.map(s => s.id)));
check('data perangkat A TIDAK hilang setelah konflik', siswaServer.some(s => s.id === 'sA'), JSON.stringify(siswaServer.map(s => s.id)));
check('data lama tetap ada', siswaServer.some(s => s.id === 's1'));
check('B melihat data gabungan', B.window.eval("dataSiswa.map(s => s.id)").includes('sA') && B.window.eval("dataSiswa.map(s => s.id)").includes('sB'));

// ================= 4. Tarik tidak menimpa perubahan yang belum terkirim =================
console.log('\n-- 4. Perubahan lokal belum terkirim tidak ditimpa tarik server --');
B.window.eval("dataGuru.push({ id: 'gB', nama: 'Guru Baru', kode: 'B' }); taSet('dataGuru_v2', dataGuru); stateKotorServer = true;");
B.window.__fetchLog.length = 0;
await B.window.eval('tarikPerubahanServerJikaAda()');
await sleep(80);
check('data guru baru masih ada setelah tarik', B.window.eval("dataGuru.some(g => g.id === 'gB')"));
check('tidak ada state/get saat data masih kotor', !B.window.__fetchLog.some(f => decodeURIComponent(f.url).includes('state/get')));
await sleep(900);
sekarang = await call('state/get', 'GET', null, adminToken);
check('data guru baru terkirim ke server', JSON.parse(sekarang.data.state['ta_2025_2026__dataGuru_v2']).some(g => g.id === 'gB'));

// ================= 5. Tarik ditunda saat pengguna mengetik =================
console.log('\n-- 5. Tarik ditunda saat pengguna sedang mengetik --');
const inputUji = B.window.document.createElement('input');
B.window.document.body.appendChild(inputUji);
inputUji.focus();
check('deteksi input aktif', B.window.eval('adaInputAktif()') === true);
B.window.__fetchLog.length = 0;
await B.window.eval('tarikPerubahanServerJikaAda()');
check('tidak menarik data saat input fokus', !B.window.__fetchLog.some(f => decodeURIComponent(f.url).includes('state/get')));
inputUji.blur();
check('deteksi tanpa input aktif', B.window.eval('adaInputAktif()') === false);

// ================= 6. Indikator status =================
console.log('\n-- 6. Status sinkron terlihat pengguna --');
const teksStatus = () => (A.window.document.getElementById('statusSinkron')?.textContent || '').trim();
check('label status tersimpan muncul', teksStatus() === 'Tersimpan di server', teksStatus());
check('kotak status terlihat setelah login', !A.window.document.getElementById('statusSinkronBox').classList.contains('hidden'));
A.window.eval("setStatusSinkron('offline')");
check('label status offline muncul', teksStatus().includes('Belum terkirim'), teksStatus());
A.window.eval("setStatusSinkron('saved')");

// ================= 7. Kirim saat halaman ditutup =================
console.log('\n-- 7. Perubahan terakhir terkirim saat halaman ditutup --');
A.window.eval("dataGuru.push({ id: 'gTutup', nama: 'Guru Tutup', kode: 'C' }); taSet('dataGuru_v2', dataGuru);");
A.window.__fetchLog.length = 0;
A.window.eval('kirimStateSaatPerangkatDisembunyikan()');
await sleep(700);
const kirimTutup = A.window.__fetchLog.filter(f => decodeURIComponent(f.url).includes('state/save'));
check('pakai keepalive saat ditutup', kirimTutup.some(f => f.keepalive));
sekarang = await call('state/get', 'GET', null, adminToken);
check('data guru terakhir tersimpan di server', JSON.parse(sekarang.data.state['ta_2025_2026__dataGuru_v2']).some(g => g.id === 'gTutup'));

// ================= 8. Gangguan jaringan tidak menghapus sesi =================
console.log('\n-- 8. Sesi bertahan saat server tidak terjangkau --');
const C = buatPerangkat('C');
await sleep(300);
await loginSebagai(C);
check('perangkat C login', C.window.eval('penggunaAktif?.role') === 'admin');
C.window.__matikanAuthMe = true;
await C.window.eval('initLoginAplikasi()');
await sleep(300);
check('token tetap tersimpan', !!C.window.localStorage.getItem('serverToken_v1'));
check('sesi login tetap ada', !!C.window.localStorage.getItem('sesiLogin_v1'));
check('tetap masuk memakai data perangkat', C.window.eval('penggunaAktif?.role') === 'admin');
check('status jadi offline', C.window.eval('statusSinkronServer') === 'offline');
check('overlay login tidak muncul', C.window.document.getElementById('loginOverlay').classList.contains('hidden'));

// ================= 9. Token kedaluwarsa tetap memaksa login ulang =================
console.log('\n-- 9. Token ditolak server memaksa login ulang --');
const D = buatPerangkat('D');
await sleep(300);
await loginSebagai(D);
D.window.eval("serverToken = 'token-palsu'; localStorage.setItem('serverToken_v1', 'token-palsu');");
await D.window.eval('initLoginAplikasi()');
await sleep(400);
check('token palsu dibuang', !D.window.localStorage.getItem('serverToken_v1'));
check('sesi login dibersihkan', !D.window.localStorage.getItem('sesiLogin_v1'));
check('overlay login tampil', !D.window.document.getElementById('loginOverlay').classList.contains('hidden'));

// ================= 10. Data offline dikirim saat halaman dibuka lagi =================
console.log('\n-- 10. Data yang tertunda saat offline digabung, bukan ditimpa --');
const E = buatPerangkat('E');
await sleep(300);
await loginSebagai(E);
E.window.eval("dataSiswa.push({ id: 'sE', nisn: 'E01', nama: 'Siswa Offline', kelas: 'VII A' }); taSet('dataSiswa_v1', dataSiswa);");
E.window.eval("localStorage.setItem('stateKotor_v1', '1');");
// Perangkat lain menambah data selagi E "offline".
sekarang = await call('state/get', 'GET', null, adminToken);
const stateLain = { ...sekarang.data.state };
const siswaLain = JSON.parse(stateLain['ta_2025_2026__dataSiswa_v1']);
siswaLain.push({ id: 'sLain', nisn: 'L01', nama: 'Siswa Perangkat Lain', kelas: 'VII A' });
stateLain['ta_2025_2026__dataSiswa_v1'] = JSON.stringify(siswaLain);
await call('state/save', 'PUT', { state: stateLain, version: sekarang.data.version, force: false }, adminToken);
await E.window.eval('sinkronDariServer()');
await sleep(1200);
sekarang = await call('state/get', 'GET', null, adminToken);
const siswaAkhir = JSON.parse(sekarang.data.state['ta_2025_2026__dataSiswa_v1']);
check('data perangkat E tidak hilang', siswaAkhir.some(s => s.id === 'sE'), JSON.stringify(siswaAkhir.map(s => s.id)));
check('data perangkat lain tidak hilang', siswaAkhir.some(s => s.id === 'sLain'), JSON.stringify(siswaAkhir.map(s => s.id)));
check('penanda kotor dibersihkan', !E.window.localStorage.getItem('stateKotor_v1'));

// ================= 11. Kunci yang belum dikenal tidak ikut terhapus =================
console.log('\n-- 11. Kunci yang belum ada di perangkat tidak menghapus data server --');
const hasil11 = ujiGabung(
  null,
  { 'ta_2025_2026__dataSiswa_v1': JSON.stringify([{ id: 's1' }]) },
  { 'ta_2025_2026__dataSiswa_v1': JSON.stringify([{ id: 's1' }]), 'ta_2025_2026__dataGuru_v2': JSON.stringify([{ id: 'g9' }]) }
);
check('kunci server yang belum dikenal tetap dipertahankan', !!hasil11.state['ta_2025_2026__dataGuru_v2']);
const hasil12 = ujiGabung(
  { 'ta_2025_2026__dataGuru_v2': JSON.stringify([{ id: 'g9' }]) },
  {},
  { 'ta_2025_2026__dataGuru_v2': JSON.stringify([{ id: 'g9' }]) }
);
check('penghapusan yang disengaja tetap dihormati', hasil12.state['ta_2025_2026__dataGuru_v2'] === undefined);

// ================= 12. Logout membersihkan penanda tertunda =================
console.log('\n-- 12. Logout tidak meninggalkan penanda data tertunda --');
E.window.eval("jadwalkanSinkronServer(999999)");
check('penanda kotor ada sebelum logout', E.window.localStorage.getItem('stateKotor_v1') === '1');
E.window.eval('logoutAplikasi()');
await sleep(300);
check('penanda kotor dibersihkan saat logout', !E.window.localStorage.getItem('stateKotor_v1'));

for (const p of [A, B, C, D, E]) p.dom.window.close();
mock.proc.kill();
api.proc.kill();

console.log(`\n${pass} lolos, ${fail} gagal`);
process.exit(fail === 0 ? 0 : 1);
