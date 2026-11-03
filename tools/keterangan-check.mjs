// Uji kelola kolom keterangan (Ijin, Sakit, dll) untuk Cetak Kehadiran Guru.
// Jalankan: npm install --no-save jsdom && node tools/keterangan-check.mjs
import fs from 'node:fs';
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = await import('jsdom')); }
catch { console.error('Butuh jsdom: npm install --no-save jsdom'); process.exit(1); }

let pass = 0, fail = 0;
const check = (nama, kondisi, extra = '') => {
  if (kondisi) { pass++; console.log('  ✔ ' + nama); }
  else { fail++; console.log('  ✘ ' + nama + (extra ? ' -> ' + extra : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const html = fs.readFileSync('index.html', 'utf8')
  .replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g, '')
  .replace(/<link[^>]+href="[^"]+"[^>]*>/g, '');

const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const pesan = String(e?.message || e);
  if (!/Could not load|not implemented|fillStyle|getContext|beginPath/i.test(pesan)) console.log('[jsdom]', pesan);
});
const dom = new JSDOM(html, { url: 'http://localhost/?local', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
window.print = () => {};
window.alert = () => {};
window.confirm = () => true;

await sleep(300);

// ---------------------------------------------------------------------------
// Persiapan data: 3 guru, jadwal 4 JP/hari, beberapa catatan keterangan.
// ---------------------------------------------------------------------------
window.eval(`
  penggunaAktif = { username: 'admin', role: 'admin' };
  akunSiswaLogin = [];
  dataGuru = ['A', 'B', 'C'].map((kode, i) => ({
    id: 'g' + i, kode, nama: 'Guru ' + kode, jabatan: 'Guru Tetap', jenisKelamin: 'L', aktif: true,
    honor: {}, jadwal: { 0: 0, 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 0 }
  }));
  taSet('dataGuru_v2', dataGuru);
  hariLiburList = [];
  document.getElementById('rekapBulan').value = '10';
  document.getElementById('rekapTahun').value = '2026';
  // Dua catatan "Sakit" dan satu "Alpa" pada bulan Oktober 2026.
  dataKehadiran = [
    { id: 'h1', guruId: 'g0', tanggal: '2026-10-05', jumlah: 0, keterangan: 'Sakit', isPiket: false },
    { id: 'h2', guruId: 'g0', tanggal: '2026-10-06', jumlah: 0, keterangan: 'Sakit', isPiket: false },
    { id: 'h3', guruId: 'g1', tanggal: '2026-10-05', jumlah: 0, keterangan: 'Alpa', isPiket: false }
  ];
  taSet('dataKehadiran', dataKehadiran);
  simpanDaftarKeteranganIjin(['Alpa', 'Sakit', 'Keperluan Keluarga', 'Tugas Dinas']);
`);
await sleep(120);

// Cetak & kembalikan judul kolom keterangan (urutan sesuai header).
const cetakHeader = () => {
  window.eval("document.getElementById('printRekapArea').innerHTML = ''");
  window.eval('cetakRekapKehadiranGuru()');
  const isi = window.document.getElementById('printRekapArea').innerHTML || '';
  const d = new JSDOM(isi);
  const semuaTh = [...d.window.document.querySelectorAll('table.data-kehadiran thead th')]
    .map(th => th.textContent.replace(/\s+/g, ' ').trim());
  // 10 kolom statis pertama, sisanya = keterangan + Alasan Ijin di paling kanan
  const keterangan = semuaTh.slice(10, semuaTh.length - 1);
  // Total lebar untuk memastikan tidak ada kolom yang terpotong
  const lebar = [...d.window.document.querySelectorAll('table.data-kehadiran thead th')]
    .map(th => parseFloat((th.getAttribute('style') || '').match(/width:\s*([\d.]+)%/)?.[1] || '0'))
    .reduce((a, b) => a + b, 0);
  return { semuaTh, keterangan, lebar, isi, totalKolom: semuaTh.length };
};

// Buka modal & render baris.
const bukaModal = () => window.eval('bukaEditorKeteranganIjin()');
const barisTampil = () => [...window.document.querySelectorAll('#bodyKeteranganIjin tr')];

// ---------------------------------------------------------------------------
console.log('\n-- 1. Kondisi awal --');
{
  const h = cetakHeader();
  check('4 kolom keterangan default muncul berurutan',
    JSON.stringify(h.keterangan) === JSON.stringify(['Alpa', 'Sakit', 'Keperluan Keluarga', 'Tugas Dinas']),
    JSON.stringify(h.keterangan));
  check('kolom terakhir tetap "Alasan Ijin"', h.semuaTh[h.semuaTh.length - 1] === 'Alasan Ijin', h.semuaTh[h.semuaTh.length - 1]);
  check('total lebar 100%', Math.abs(h.lebar - 100) < 0.001, `${h.lebar}%`);

  bukaModal();
  await sleep(50);
  const baris = barisTampil();
  check('modal menampilkan 4 baris', baris.length === 4, `${baris.length} baris`);
  check('setiap baris punya input teks (bisa diedit)',
    ['ketIjinBaris0', 'ketIjinBaris1', 'ketIjinBaris2', 'ketIjinBaris3']
      .every(id => !!window.document.getElementById(id)));
  check('input berisi nama kategori', window.document.getElementById('ketIjinBaris1').value === 'Sakit');
  const tombolBaris = [...window.document.querySelectorAll('#bodyKeteranganIjin button')];
  check('ada tombol naik/turun/simpan/hapus per baris', tombolBaris.length === 16, `${tombolBaris.length} tombol`);
  check('tombol naik baris pertama dinonaktifkan', tombolBaris[0].disabled === true);
  check('tombol turun baris terakhir dinonaktifkan', tombolBaris[(baris.length - 1) * 4 + 1].disabled === true);
}

// ---------------------------------------------------------------------------
console.log('\n-- 2. Ganti nama kategori (termasuk data lama) --');
{
  // "Sakit" sudah dipakai di 2 catatan kehadiran -> harus ikut berubah.
  window.document.getElementById('ketIjinBaris1').value = 'Sakit / Izin Sakit';
  window.eval('gantiNamaKeteranganIjin(1)');
  await sleep(50);

  const daftar = window.eval('getDaftarKeteranganIjin()');
  check('nama di daftar berubah', daftar[1] === 'Sakit / Izin Sakit', JSON.stringify(daftar));

  const catatan = window.eval('dataKehadiran.map(k => k.keterangan)');
  check('2 catatan "Sakit" ikut diperbarui',
    catatan.filter(k => k === 'Sakit / Izin Sakit').length === 2, JSON.stringify(catatan));
  check('tidak ada sisa "Sakit" lama', !catatan.includes('Sakit'), JSON.stringify(catatan));

  const h = cetakHeader();
  check('cetakan memakai nama baru', h.keterangan.includes('Sakit / Izin Sakit'), JSON.stringify(h.keterangan));
  check('tidak muncul dua kolom Sakit', !h.keterangan.includes('Sakit'), JSON.stringify(h.keterangan));
  check('jumlah kolom tetap 15', h.totalKolom === 15, `${h.totalKolom}`);
  check('total lebar tetap 100%', Math.abs(h.lebar - 100) < 0.001, `${h.lebar}%`);

  // Ganti nama kembali: migrasi data harus berjalan dua arah.
  window.document.getElementById('ketIjinBaris1').value = 'Sakit';
  window.eval('gantiNamaKeteranganIjin(1)');
  await sleep(40);
  const balik = window.eval('dataKehadiran.map(k => k.keterangan)');
  check('ganti nama balik ke "Sakit" juga memigrasi data',
    balik.filter(k => k === 'Sakit').length === 2 && !balik.includes('Sakit / Izin Sakit'), JSON.stringify(balik));
}

// ---------------------------------------------------------------------------
console.log('\n-- 3. Validasi input --');
{
  const sebelum = window.eval('getDaftarKeteranganIjin()').slice();

  window.document.getElementById('ketIjinBaris0').value = 'sAKIT'; // duplikat 'Sakit' (beda kapital)
  window.eval('gantiNamaKeteranganIjin(0)');
  await sleep(30);
  check('nama duplikat ditolak', JSON.stringify(window.eval('getDaftarKeteranganIjin()')) === JSON.stringify(sebelum));
  check('input dikembalikan ke nama asli', window.document.getElementById('ketIjinBaris0').value === 'Alpa');

  window.document.getElementById('ketIjinBaris0').value = '   ';
  window.eval('gantiNamaKeteranganIjin(0)');
  await sleep(30);
  check('nama kosong ditolak', window.eval('getDaftarKeteranganIjin()')[0] === 'Alpa');

  // Spasi berlebih dirapikan
  window.document.getElementById('ketIjinBaris0').value = '  Alpa   Berat ';
  window.eval('gantiNamaKeteranganIjin(0)');
  await sleep(30);
  check('spasi berlebih dirapikan', window.eval('getDaftarKeteranganIjin()')[0] === 'Alpa Berat',
    window.eval('getDaftarKeteranganIjin()')[0]);
  // kembalikan
  window.document.getElementById('ketIjinBaris0').value = 'Alpa';
  window.eval('gantiNamaKeteranganIjin(0)');
  await sleep(30);
}

// ---------------------------------------------------------------------------
console.log('\n-- 3b. Simpan saat blur tidak mengganti elemen input --');
{
  const input = window.document.getElementById('ketIjinBaris2');
  const sebelum = window.eval('getDaftarKeteranganIjin()')[2];
  input.value = 'Keperluan Pribadi';
  window.eval('gantiNamaKeteranganIjin(2, { tanpaRender: true })');
  await sleep(30);

  check('nama tersimpan lewat blur', window.eval('getDaftarKeteranganIjin()')[2] === 'Keperluan Pribadi',
    window.eval('getDaftarKeteranganIjin()')[2]);
  check('elemen input tidak diganti (fokus aman)',
    window.document.getElementById('ketIjinBaris2') === input);
  check('nilai input dirapikan', input.value === 'Keperluan Pribadi', input.value);

  // kembalikan
  input.value = sebelum;
  window.eval('gantiNamaKeteranganIjin(2, { tanpaRender: true })');
  await sleep(30);
  check('bisa dikembalikan', window.eval('getDaftarKeteranganIjin()')[2] === sebelum);
}

// ---------------------------------------------------------------------------
console.log('\n-- 4. Urutan kolom mengikuti daftar --');
{
  const sebelum = window.eval('getDaftarKeteranganIjin()');
  window.eval('geserKeteranganIjin(0, 1)'); // Alpa turun satu
  await sleep(40);
  const sesudah = window.eval('getDaftarKeteranganIjin()');
  check('urutan daftar tertukar', sesudah[0] === sebelum[1] && sesudah[1] === sebelum[0],
    `${JSON.stringify(sebelum)} -> ${JSON.stringify(sesudah)}`);

  const h = cetakHeader();
  check('urutan kolom cetak mengikuti daftar', JSON.stringify(h.keterangan) === JSON.stringify(sesudah),
    `${JSON.stringify(h.keterangan)} vs ${JSON.stringify(sesudah)}`);
  check('total lebar tetap 100%', Math.abs(h.lebar - 100) < 0.001, `${h.lebar}%`);

  // geser melewati batas tidak boleh error / mengubah apa pun
  window.eval('geserKeteranganIjin(0, -1)');
  window.eval(`geserKeteranganIjin(${sesudah.length - 1}, 1)`);
  await sleep(30);
  check('geser di luar batas diabaikan', JSON.stringify(window.eval('getDaftarKeteranganIjin()')) === JSON.stringify(sesudah));

  // kembalikan urutan
  window.eval('geserKeteranganIjin(1, -1)');
  await sleep(30);
}

// ---------------------------------------------------------------------------
console.log('\n-- 5. Tambah & hapus kategori --');
{
  window.document.getElementById('inputKeteranganIjinBaru').value = 'Cuti Tahunan';
  window.eval('tambahKeteranganIjin()');
  await sleep(40);
  let h = cetakHeader();
  check('kategori baru muncul sebagai kolom', h.keterangan.includes('Cuti Tahunan'), JSON.stringify(h.keterangan));
  check('jumlah kolom bertambah jadi 16', h.totalKolom === 16, `${h.totalKolom}`);
  check('total lebar tetap 100%', Math.abs(h.lebar - 100) < 0.001, `${h.lebar}%`);

  // Hapus "Cuti Tahunan" (indeks terakhir)
  const idx = window.eval('getDaftarKeteranganIjin()').indexOf('Cuti Tahunan');
  window.eval(`hapusKeteranganIjin(${idx})`);
  await sleep(40);
  h = cetakHeader();
  check('kategori terhapus hilang dari cetakan', !h.keterangan.includes('Cuti Tahunan'), JSON.stringify(h.keterangan));
  check('jumlah kolom kembali 15', h.totalKolom === 15, `${h.totalKolom}`);
  check('total lebar tetap 100%', Math.abs(h.lebar - 100) < 0.001, `${h.lebar}%`);
}

// ---------------------------------------------------------------------------
console.log('\n-- 6. Banyak kategori: orientasi & lebar tetap aman --');
{
  window.eval(`
    simpanDaftarKeteranganIjin(['Alpa','Sakit','Keperluan Keluarga','Tugas Dinas','Diklat','Cuti','Izin Khusus','Dinas Luar','Studi Banding']);
  `);
  const h = cetakHeader();
  check('9 kategori -> 20 kolom', h.totalKolom === 20, `${h.totalKolom}`);
  check('total lebar tetap 100%', Math.abs(h.lebar - 100) < 0.001, `${h.lebar}%`);
  check('otomatis landscape', /size:\s*A4 landscape/.test(h.isi));

  window.eval("simpanDaftarKeteranganIjin(['Alpa','Sakit','Keperluan Keluarga','Tugas Dinas'])");
  const balik = cetakHeader();
  check('kembali 4 kategori -> portrait', /size:\s*A4 portrait/.test(balik.isi));
  check('total lebar 100% setelah dikembalikan', Math.abs(balik.lebar - 100) < 0.001, `${balik.lebar}%`);
}

// ---------------------------------------------------------------------------
console.log('\n-- 7. Reset ke default --');
{
  window.eval("simpanDaftarKeteranganIjin(['X','Y'])");
  window.eval('resetKeteranganIjinKeDefault()');
  await sleep(40);
  const daftar = window.eval('getDaftarKeteranganIjin()');
  check('reset mengembalikan 4 kategori default',
    JSON.stringify(daftar) === JSON.stringify(['Alpa', 'Sakit', 'Keperluan Keluarga', 'Tugas Dinas']), JSON.stringify(daftar));
  const h = cetakHeader();
  check('cetakan ikut kembali normal', JSON.stringify(h.keterangan) === JSON.stringify(daftar), JSON.stringify(h.keterangan));
}

// ---------------------------------------------------------------------------
console.log('\n-- 8. Tombol tersedia di halaman Rekap --');
{
  const tombol = [...window.document.querySelectorAll('button')]
    .filter(b => /Kelola Keterangan/.test(b.textContent) && /bukaEditorKeteranganIjin/.test(b.getAttribute('onclick') || ''));
  check('tombol "Kelola Keterangan" ada di toolbar rekap', tombol.length === 1, `${tombol.length} tombol`);
  const judul = tombol[0]?.getAttribute('title') || '';
  check('tombol punya keterangan jelas', /kolom keterangan/i.test(judul), judul);

  window.eval('tutupEditorKeteranganIjin()');
  await sleep(30);
  check('modal bisa ditutup', window.document.getElementById('modalKeteranganIjin').style.display === 'none');
}

console.log(`\n===== KELOLA KETERANGAN: ${pass} lolos, ${fail} gagal =====`);
process.exit(fail ? 1 : 0);
