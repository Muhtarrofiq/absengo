// Smoke test UI (jsdom) — mode lokal (?local).
// Jalankan: npm install --no-save jsdom && node tools/ui-smoke.mjs
import fs from 'node:fs';
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = await import('jsdom')); }
catch { console.error('Butuh jsdom: npm install --no-save jsdom'); process.exit(1); }

const htmlAsli = fs.readFileSync('index.html', 'utf8');
// Buang resource eksternal (CDN) agar jsdom tidak mencoba jaringan.
const html = htmlAsli
  .replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g, '')
  .replace(/<link[^>]+href="[^"]+"[^>]*>/g, '');

const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const pesan = String(e?.message || e);
  if (!/Could not load|not implemented/i.test(pesan)) console.log('[jsdom error]', pesan);
});

const dom = new JSDOM(html, {
  url: 'http://localhost/?local',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const { window } = dom;
window.print = () => {};
window.alert = () => {};
window.confirm = () => true;
window.prompt = (_q, d) => d;

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(nama, kondisi, extra = '') {
  if (kondisi) { pass++; console.log('  ✔ ' + nama); }
  else { fail++; console.log('  ✘ ' + nama + (extra ? ' -> ' + extra : '')); }
}
const $ = id => window.document.getElementById(id);
const teks = id => ($(id)?.textContent || '').trim();

await sleep(300);

console.log('\n-- 1. Halaman termuat & overlay login tampil --');
check('overlay login tampil', !$('loginOverlay').classList.contains('hidden'));
check('form login ada', !!$('formLogin'));

console.log('\n-- 2. Login admin (mode lokal) --');
$('loginUsername').value = 'admin';
$('loginPassword').value = 'admin123';
$('formLogin').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(300);
check('overlay login tersembunyi', $('loginOverlay').classList.contains('hidden'));
check('pengguna aktif admin', window.eval("penggunaAktif?.role") === 'admin');
check('halaman dashboard aktif', !$('page-dashboard').classList.contains('hidden'));
check('role admin tampil', $('loginUserRole').textContent.includes('ADMIN'));
check('menu Absensi Saya tersembunyi untuk admin', window.eval(`[...document.querySelectorAll('.nav-btn[data-page]')].filter(b => b.closest('li').style.display !== 'none').map(b => b.dataset.page).join(',')`).split(',').includes('absensi-saya') === false);

console.log('\n-- 3. Buat data siswa, absensi, pelanggaran, dan akun siswa --');
window.eval(`
  dataSiswa = [
    { id: 's1', nisn: 'S001', nama: 'Ahmad', kelas: 'VII A', jenisKelamin: 'L', telepon: '' },
    { id: 's2', nisn: 'S002', nama: 'Budi', kelas: 'VII A', jenisKelamin: 'L', telepon: '' },
    { id: 's3', nisn: 'S003', nama: 'Citra', kelas: 'VIII B', jenisKelamin: 'P', telepon: '' }
  ];
  taSet('dataSiswa_v1', dataSiswa);
  dataAbsensiSiswa = [
    { id: 'a1', siswaId: 's1', tanggal: '2026-10-01', status: 'Hadir', keterangan: '' },
    { id: 'a2', siswaId: 's1', tanggal: '2026-10-02', status: 'Sakit', keterangan: 'Demam' },
    { id: 'a3', siswaId: 's2', tanggal: '2026-10-01', status: 'Alpa', keterangan: '' }
  ];
  taSet('dataAbsensiSiswa_v1', dataAbsensiSiswa);
  dataPelanggaranSiswa = [
    { id: 'p1', siswaId: 's1', nisn: 'S001', namaSiswa: 'Ahmad', kelas: 'VII A', kategori: 'Kerajinan', pelanggaran: 'Tidak mengerjakan tugas', sanksi: 'Teguran', skor: 10, tanggal: '2026-10-03' }
  ];
  taSet('pelanggaranSiswa_v1', dataPelanggaranSiswa);
  akunSiswaLogin = [];
  localStorage.removeItem('akunSiswaLogin_v1');
`);
check('data siswa siap', window.eval('dataSiswa.length') === 3);
check('akses admin ke pengaturan', window.eval("halamanDiizinkan('admin','pengaturan')") === true);

console.log('\n-- 4. Pengaturan: buat akun per kelas lewat UI --');
window.eval("showPage('pengaturan')");
await sleep(150);
check('select kelas terisi', $('siswaAksesKelas').options.length >= 3, `${$('siswaAksesKelas').options.length} opsi`);
check('belum ada akun', window.eval('akunSiswaTampil.length') === 0);
$('siswaAksesKelas').value = 'VII A';
$('siswaAksesScope').value = 'sendiri';
$('siswaAksesPasswordDefault').value = '';
window.eval('buatAkunSiswaKelas()');
await sleep(500);
check('2 akun VII A dibuat (bukan kelas lain)', window.eval('akunSiswaTampil.length') === 2, String(window.eval('akunSiswaTampil.length')));
check('username memakai NISN', window.eval("akunSiswaTampil.map(a => a.username).sort().join(',')") === 'S001,S002');
check('password awal = NISN', window.eval("akunSiswaLogin.find(a => a.username === 'S001')?.password") === 'S001');
check('cakupan awal sendiri', window.eval("akunSiswaTampil.every(a => a.akses === 'sendiri')") === true);
check('akun tersimpan di localStorage', (window.localStorage.getItem('akunSiswaLogin_v1') || '').includes('S001'));
check('badge jumlah akun', teks('badgeJumlahAkunSiswa') === '2 akun', teks('badgeJumlahAkunSiswa'));
check('tabel akun terisi', $('tabelAkunSiswa').textContent.includes('Ahmad'));

window.eval("ubahAksesAkunSiswa('S002', 'kelas')");
await sleep(400);
check('ubah cakupan S002 => kelas', window.eval("akunSiswaLogin.find(a => a.username === 'S002')?.akses") === 'kelas');
check('cakupan S001 tetap sendiri', window.eval("akunSiswaLogin.find(a => a.username === 'S001')?.akses") === 'sendiri');

console.log('\n-- 5. Logout & login siswa --');
window.eval('logoutAplikasi()');
await sleep(200);
check('overlay login tampil lagi', !$('loginOverlay').classList.contains('hidden'));
$('loginUsername').value = 'S001';
$('loginPassword').value = 'S001';
$('formLogin').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(300);
check('login siswa => role siswa', window.eval("penggunaAktif?.role") === 'siswa');
check('halaman Absensi Saya aktif', !$('page-absensi-saya').classList.contains('hidden'));
check('dashboard tersembunyi', $('page-dashboard').classList.contains('hidden'));
check('nama siswa tampil', teks('absensiSayaNama') === 'Ahmad', teks('absensiSayaNama'));
check('kelas tampil', teks('absensiSayaKelas') === 'VII A', teks('absensiSayaKelas'));
check('badge role siswa + kelas', $('loginUserRole').textContent.includes('SISWA') && $('loginUserRole').textContent.includes('VII A'));
check('box tahun ajaran disembunyikan', $('boxTahunAjaranSidebar').style.display === 'none');

console.log('\n-- 6. Hak akses siswa --');
check('siswa tidak boleh buka pengaturan', window.eval("halamanDiizinkan('siswa','pengaturan')") === false);
check('siswa hanya boleh absensi saya', window.eval("halamanDiizinkan('siswa','absensi-saya')") === true);
window.eval("showPage('pengaturan')");
check('pengaturan tetap tersembunyi', $('page-pengaturan').classList.contains('hidden'));
check('siswa tidak boleh menulis server', window.eval('bolehMenulisServer()') === false);
check('menu admin disembunyikan', window.eval("getComputedStyle(document.querySelector('[data-admin-only]')).display") === 'none');

console.log('\n-- 7. Data siswa terfilter di tampilan --');
await sleep(100);
const awalBulan = $('absensiSayaBulan');
awalBulan.value = '10';
$('absensiSayaTahun').value = '2026';
window.eval('renderAbsensiSaya()');
await sleep(100);
check('riwayat absensi hanya milik S001 (2 baris)', ($('tabelRiwayatAbsensiSaya').querySelectorAll('tr').length) === 2);
check('tidak menampilkan absensi siswa lain', !$('tabelRiwayatAbsensiSaya').textContent.includes('Alpa'));
check('total skor tata tertib = 10', teks('totalSkorTataTertibSaya') === '10', teks('totalSkorTataTertibSaya'));
check('pelanggaran tampil', $('tabelTataTertibSaya').textContent.includes('Tidak mengerjakan tugas'));
check('rekap kelas tidak tampil untuk akses sendiri', $('seksiRekapKelasSiswa').classList.contains('hidden'));

console.log('\n-- 8. Akses "seluruh kelas" --');
window.eval('logoutAplikasi()');
await sleep(150);
$('loginUsername').value = 'S002';
$('loginPassword').value = 'S002';
$('formLogin').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(300);
check('login S002 => akses kelas', window.eval("penggunaAktif?.akses") === 'kelas');
window.eval("document.getElementById('absensiSayaBulan').value='10'; document.getElementById('absensiSayaTahun').value='2026'; renderAbsensiSaya();");
await sleep(100);
check('seksi rekap kelas tampil', !$('seksiRekapKelasSiswa').classList.contains('hidden'));
check('rekap kelas berisi 2 siswa VII A', $('tabelRekapKelasSiswa').querySelectorAll('tr').length === 2, String($('tabelRekapKelasSiswa').querySelectorAll('tr').length));
check('rekap kelas tidak memuat kelas lain', !$('tabelRekapKelasSiswa').textContent.includes('Citra'));
check('riwayat pribadi S002 = 1 baris', $('tabelRiwayatAbsensiSaya').querySelectorAll('tr').length === 1);

console.log('\n-- 9. Cetak tidak error --');
let cetakError = '';
try { window.eval('cetakAbsensiSaya()'); } catch (e) { cetakError = e.message; }
check('cetak rekap berjalan tanpa error', !cetakError, cetakError);
check('print area terisi', ($('printRekapArea').innerHTML || '').includes('LAPORAN ABSENSI'));

console.log('\n-- 10. Regresi role guru --');
window.eval('logoutAplikasi()');
await sleep(150);
$('loginUsername').value = 'guru';
$('loginPassword').value = 'guru123';
$('formLogin').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(250);
check('login guru berhasil', window.eval("penggunaAktif?.role") === 'guru');
check('guru boleh input kehadiran', window.eval("halamanDiizinkan('guru','kehadiran')") === true);
check('guru boleh absensi siswa', window.eval("halamanDiizinkan('guru','input-absensi-siswa')") === true);
check('guru tidak boleh pengaturan', window.eval("halamanDiizinkan('guru','pengaturan')") === false);
check('guru tidak melihat menu Absensi Saya', window.eval(`[...document.querySelectorAll('.nav-btn[data-page]')].filter(b => b.closest('li').style.display !== 'none').map(b => b.dataset.page).join(',')`).includes('absensi-saya') === false);
check('halaman awal guru = kehadiran', !$('page-kehadiran').classList.contains('hidden'));

console.log(`\n===== UI: ${pass} lolos, ${fail} gagal =====`);
process.exit(fail ? 1 : 0);
