// Uji "Batas Jam yang Ditampilkan" (satu isian global) pada Input Kehadiran.
// Jalankan: npm install --no-save jsdom && node tools/batas-jam-check.mjs
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
  const p = String(e?.message || e);
  if (!/Could not load|not implemented|fillStyle|getContext|beginPath|Not implemented/i.test(p)) console.log('[jsdom]', p);
});
const dom = new JSDOM(html, { url: 'http://localhost/?local', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
window.print = () => {};
window.alert = () => {};
window.confirm = () => true;
await sleep(300);

// 2026-11-02 = Senin, 2026-11-03 = Selasa, 2026-11-05 = Kamis
const SENIN = '2026-11-02';
const SELASA = '2026-11-03';
const KAMIS = '2026-11-05';

window.eval(`
  penggunaAktif = { username: 'admin', role: 'admin' };
  akunSiswaLogin = [];
  localStorage.removeItem('batasJamTampilGlobal');
  localStorage.removeItem('batasJamPerHariGlobal');
  batasJamTampilCache = null;
  dataGuru = [{
    id: 'g1', kode: 'A', nama: 'Guru Sepuluh Jam', jabatan: 'Guru Tetap',
    jenisKelamin: 'L', aktif: true, honor: {}, jadwal: { 0: 0, 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 0 },
    jadwalHarian: { 1: 10, 2: 10, 3: 10, 4: 10, 5: 10 },
    jamKeHarian: { 1: [1,2,3,4,5,6,7,8,9,10], 2: [1,2,3,4,5,6,7,8,9,10], 3: [1,2,3,4,5,6,7,8,9,10], 4: [1,2,3,4,5,6,7,8,9,10], 5: [1,2,3,4,5,6,7,8,9,10] }
  }];
  dataKehadiran = [];
  hariLiburList = [];
  taSet('dataGuru_v2', dataGuru);
  taSet('dataKehadiran', dataKehadiran);
  document.getElementById('kehadiranTanggal').value = '${SENIN}';
`);

const ev = ekspresi => window.eval(ekspresi);

// ---------------------------------------------------------------------------
console.log('\n-- 1. Tanpa batas: perilaku lama tidak berubah --');
{
  check('getBatasJamTampil() = 0', ev('getBatasJamTampil()') === 0, String(ev('getBatasJamTampil()')));
  check('getBatasJamHari(1) = 0', ev('getBatasJamHari(1)') === 0);
  check('target Senin tetap 10 JP', ev(`getTargetJamGuruTanggal(dataGuru[0], '${SENIN}')`) === 10);
  check('kolom tampil = jumlah kolom global (10)',
    ev(`document.getElementById('kehadiranJumlahKolom').value = '10'; getJumlahKolomTampil()`) === 10);
}

// ---------------------------------------------------------------------------
console.log('\n-- 2. Satu isian di bawah Jumlah Kolom --');
{
  ev(`openModalKehadiranMassal()`);
  await sleep(150);

  const adaInput = ev(`!!document.getElementById('batasJamTampil')`);
  check('input #batasJamTampil ada', adaInput);

  // Tidak boleh ada lagi isian per hari.
  const sisaPerHari = ev(`document.querySelectorAll('#batasJamPerHariContainer input, [id^="batasJamHari"]').length`);
  check('isian per hari sudah dihapus', sisaPerHari === 0, `${sisaPerHari} isian tersisa`);

  // Posisi: harus muncul setelah input jumlah kolom pada urutan DOM.
  const urutan = ev(`(function(){
    const a = document.getElementById('kehadiranJumlahKolom');
    const b = document.getElementById('batasJamTampil');
    return a && b ? (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? 'sesudah' : 'sebelum') : 'tidak-ada';
  })()`);
  check('posisi isian batas SETELAH jumlah kolom', urutan === 'sesudah', urutan);

  const label = ev(`document.querySelector('label[for=""], #batasJamTampil')?.closest('div')?.parentElement?.querySelector('label')?.textContent.trim()`);
  check('label menyebut Batas Jam', /Batas Jam/i.test(label || ''), String(label).slice(0, 60));

  const placeholder = ev(`document.getElementById('batasJamTampil').getAttribute('placeholder')`);
  check('placeholder menjelaskan kosong = tanpa batas', /tanpa batas/i.test(placeholder || ''), String(placeholder));
}

// ---------------------------------------------------------------------------
console.log('\n-- 3. Isi batas 7 (jumlah kolom 10) lewat form --');
{
  ev(`document.getElementById('kehadiranJumlahKolom').value = '10'`);
  ev(`document.getElementById('batasJamTampil').value = '7'`);
  ev(`simpanBatasJamTampilDariForm()`);
  await sleep(100);

  check('getBatasJamTampil() = 7', ev('getBatasJamTampil()') === 7, String(ev('getBatasJamTampil()')));
  check('tersimpan di localStorage', ev(`localStorage.getItem('batasJamTampilGlobal')`) === '7');
  check('kolom tampil = 7 (dinamis)', ev('getJumlahKolomTampil()') === 7, String(ev('getJumlahKolomTampil()')));
  check('jumlah kolom global tetap 10', ev('getJumlahKolomKehadiran()') === 10);
  const info = ev(`document.getElementById('infoBatasJamTampil').textContent`);
  check('info menjelaskan Jam ke-1 s.d. 7', /1 s\.d\. 7/.test(info), info);
}

// ---------------------------------------------------------------------------
console.log('\n-- 4. Batas berlaku untuk SEMUA hari (bukan per hari) --');
{
  check('Senin -> 7', ev(`getTargetJamGuruTanggal(dataGuru[0], '${SENIN}')`) === 7);
  check('Selasa -> 7', ev(`getTargetJamGuruTanggal(dataGuru[0], '${SELASA}')`) === 7);
  check('Kamis -> 7', ev(`getTargetJamGuruTanggal(dataGuru[0], '${KAMIS}')`) === 7);
  check('getBatasJamHari tidak lagi beda per hari',
    ev('[1,2,3,4,5,6].every(h => getBatasJamHari(h) === 7)'));
}

// ---------------------------------------------------------------------------
console.log('\n-- 5. Batas sebagai maksimum, bukan menambah kolom --');
{
  ev(`dataGuru.push({ id:'g2', kode:'B', nama:'Guru Lima Jam', jabatan:'-', jenisKelamin:'L', aktif:true, honor:{}, jadwalHarian:{1:5,2:5,3:5,4:5,5:5} })`);
  check('jadwal 5 dengan batas 7 -> tetap 5 JP', ev(`getTargetJamGuruTanggal(dataGuru[1], '${SENIN}')`) === 5);
  ev(`dataGuru.pop()`);

  ev(`document.getElementById('kehadiranJumlahKolom').value = '5'`);
  check('batas 7 tapi jumlah kolom 5 -> tampil 5', ev('getJumlahKolomTampil()') === 5, String(ev('getJumlahKolomTampil()')));
  ev(`document.getElementById('kehadiranJumlahKolom').value = '10'`);
}

// ---------------------------------------------------------------------------
console.log('\n-- 6. Slot jam di atas batas tidak bisa dicentang --');
{
  const slots = ev(`getSlotJamDenganReferensi(dataGuru[0], 7, 10, '${SENIN}')`);
  check('jumlah slot = 10 objek', slots.length === 10);
  check('jam 1–7 aktif', [1,2,3,4,5,6,7].every(n => slots[n - 1].aktif));
  check('jam 8,9,10 non-aktif', [8,9,10].every(n => slots[n - 1].aktif === false));
}

// ---------------------------------------------------------------------------
console.log('\n-- 7. Rekap: sisa jam tidak jadi Absen --');
{
  ev(`dataKehadiran = [{ id:'k1', guruId:'g1', tanggal:'${SENIN}', jumlah:7, keterangan:'' }]`);
  ev(`taSet('dataKehadiran', dataKehadiran)`);
  const r = ev(`hitungRingkasanJamKehadiran(dataGuru[0], ['${SENIN}'])`);
  check('hadir 7 JP', r.jumlahHadir === 7);
  check('absen 0 JP', r.jumlahAbsen === 0);
  check('target 7 JP', r.totalJamJadwal === 7);
  const baris = ev(`getDataRekapKehadiranGuru(11, 2026).find(x => x.guruId === 'g1')`);
  check('rekap prosentase 100%', Math.round(baris.prosentase) === 100, String(baris.prosentase));
  check('tidak ada alasan ijin palsu', ev(`getAlasanIzinGuru(dataGuru[0], ['${SENIN}'])`) === '-');
}

// ---------------------------------------------------------------------------
console.log('\n-- 8. Hadir MELEBIHI batas: dipotong & Absen kosong --');
{
  ev(`dataKehadiran = [{ id:'k1', guruId:'g1', tanggal:'${SENIN}', jumlah:10, keterangan:'' }]`);
  const r = ev(`hitungRingkasanJamKehadiran(dataGuru[0], ['${SENIN}'])`);
  check('hadir dipotong jadi 7 JP', r.jumlahHadir === 7, String(r.jumlahHadir));
  check('absen 0 JP', r.jumlahAbsen === 0);
  check('total = 7 JP', r.jumlahTotal === 7);
  const baris = ev(`getDataRekapKehadiranGuru(11, 2026).find(x => x.guruId === 'g1')`);
  check('rekap kehadiran 7 JP', baris.kehadiran === 7, String(baris.kehadiran));

  // Daftar layar: Jml Absen tampil "-"
  ev(`document.getElementById('filterKehadiranDari').value = '${SENIN}'`);
  ev(`document.getElementById('filterKehadiranSampai').value = '2026-11-06'`);
  ev(`renderTabelKehadiran()`);
  await sleep(120);
  const selAbsen = ev(`(function(){
    const th = [...document.querySelectorAll('#theadKehadiran th')].find(t => /Jml Absen/i.test(t.textContent));
    if (!th) return 'kolom-tidak-ada';
    const idx = [...th.parentNode.children].indexOf(th);
    const baris = document.querySelector('#tabelKehadiran tr');
    return baris ? baris.children[idx].textContent.trim() : 'baris-tidak-ada';
  })()`);
  check('daftar layar: Jml Absen kosong ("-")', selAbsen === '-', JSON.stringify(selAbsen));
}

// ---------------------------------------------------------------------------
console.log('\n-- 9. Kurang dari batas tetap dihitung Absen --');
{
  ev(`dataKehadiran = [{ id:'k1', guruId:'g1', tanggal:'${SENIN}', jumlah:5, keterangan:'' }]`);
  const r = ev(`hitungRingkasanJamKehadiran(dataGuru[0], ['${SENIN}'])`);
  check('hadir 5 JP', r.jumlahHadir === 5);
  check('absen 2 JP (7 - 5)', r.jumlahAbsen === 2, String(r.jumlahAbsen));
}

// ---------------------------------------------------------------------------
console.log('\n-- 10. Tabel Input Massal hanya menampilkan kolom sampai batas --');
{
  ev(`dataKehadiran = []`);
  ev(`document.getElementById('batasJamTampil').value = '7'`);
  ev(`simpanBatasJamTampilDariForm()`);
  ev(`document.getElementById('kehadiranTanggal').value = '${SENIN}'`);
  ev(`tanggalInputKehadiranBerubah()`);
  ev(`renderInputKehadiranMassal()`);
  await sleep(120);

  const idAman = ev(`String(dataGuru[0].id).replace(/[^A-Za-z0-9_-]/g, '_')`);
  const kotak = ev(`document.querySelectorAll('.mass-jam-${idAman}').length`);
  check('hanya 7 kotak centang (bukan 10)', kotak === 7, `${kotak} kotak`);

  const headerJam = ev(`[...document.querySelectorAll('#theadInputKehadiranMassal th')].filter(t => /Jam\\s*ke-/.test(t.textContent)).length`);
  check('header tabel hanya Jam ke-1..7', headerJam === 7, `${headerJam} kolom jam`);

  const target = ev(`document.querySelector('#mass-row-${idAman} td:nth-last-child(3)').textContent.trim()`);
  check('kolom Target Mengajar = 7 JP', target === '7 JP', target);

  ev(`centangSemuaJamMassal()`);
  await sleep(60);
  check('centang semua maksimal 7 JP', ev(`jumlahJamDariKotak(document.getElementById('mass-row-${idAman}'))`) === 7);

  ev(`simpanKehadiranMassal()`);
  await sleep(100);
  const rec = ev(`dataKehadiran.find(k => k.guruId === 'g1' && k.tanggal === '${SENIN}')`);
  check('tersimpan 7 JP', rec && Number(rec.jumlah) === 7, rec ? String(rec.jumlah) : '-');
  check('jamKeHadir = [1..7]', rec && JSON.stringify(rec.jamKeHadir) === JSON.stringify([1,2,3,4,5,6,7]),
    rec ? JSON.stringify(rec.jamKeHadir) : '-');
}

// ---------------------------------------------------------------------------
console.log('\n-- 11. Mode individu juga mengikuti batas --');
{
  ev(`document.getElementById('kehadiranGuruId').value = 'g1'`);
  ev(`ubahModeInputKehadiran('individu')`);
  ev(`renderInputKehadiranIndividu()`);
  await sleep(120);
  const slotAktif = ev(`document.querySelectorAll('#slotJamKehadiranIndividu input[data-jam-slot]').length`);
  check('slot jam individu = 7', slotAktif === 7, `${slotAktif} slot`);
}

// ---------------------------------------------------------------------------
console.log('\n-- 12. Cetak Kehadiran Guru memakai batas --');
{
  ev(`document.getElementById('printRekapArea').innerHTML = ''`);
  ev(`document.getElementById('rekapBulan').value = '11'`);
  ev(`document.getElementById('rekapTahun').value = '2026'`);
  ev(`dataKehadiran = [{ id:'k1', guruId:'g1', tanggal:'${SENIN}', jumlah:10, keterangan:'' }]`);
  ev(`taSet('dataKehadiran', dataKehadiran)`);
  ev(`cetakRekapKehadiranGuru()`);
  await sleep(150);
  const isi = ev(`document.getElementById('printRekapArea').innerHTML`);
  check('dokumen cetak terbentuk', isi.length > 500, `${isi.length} byte`);
  check('kolom Jml Target menampilkan 7', /<td class="center"><strong>7<\/strong><\/td>/.test(isi));
  check('kolom Kehadiran 7 (bukan 10)', /<td class="right"[^>]*>7<\/td>/.test(isi));
  check('tidak ada prosentase turun', !/>\d{1,2}%</.test(isi) || !/>70%</.test(isi));
}

// ---------------------------------------------------------------------------
console.log('\n-- 13. Kosongkan batas = kembali seperti semula --');
{
  ev(`kosongkanBatasJamTampil()`);
  await sleep(100);
  check('localStorage kosong', ev(`localStorage.getItem('batasJamTampilGlobal')`) === '0');
  check('getBatasJamTampil() = 0', ev('getBatasJamTampil()') === 0);
  check('target Senin kembali 10 JP', ev(`getTargetJamGuruTanggal(dataGuru[0], '${SENIN}')`) === 10);
  ev(`document.getElementById('kehadiranTanggal').value = '${SENIN}'`);
  ev(`tanggalInputKehadiranBerubah()`);
  ev(`renderInputKehadiranMassal()`);
  await sleep(100);
  const idAman = ev(`String(dataGuru[0].id).replace(/[^A-Za-z0-9_-]/g, '_')`);
  check('kotak centang kembali 10', ev(`document.querySelectorAll('.mass-jam-${idAman}').length`) === 10);
}

// ---------------------------------------------------------------------------
console.log('\n-- 14. Migrasi dari setelan lama (batas per hari) --');
{
  ev(`localStorage.removeItem('batasJamTampilGlobal'); batasJamTampilCache = null;`);
  ev(`localStorage.setItem('batasJamPerHariGlobal', JSON.stringify({ '1': 7, '2': 7, '3': 5 }))`);
  ev(`batasJamTampilCache = null; getBatasJamTampil()`);
  check('nilai terbanyak (7) dipakai sebagai batas awal', ev('getBatasJamTampil()') === 7, String(ev('getBatasJamTampil()')));

  ev(`localStorage.removeItem('batasJamPerHariGlobal'); localStorage.setItem('batasJamTampilGlobal','0'); batasJamTampilCache = null; getBatasJamTampil()`);
  check('tanpa setelan lama -> tanpa batas', ev('getBatasJamTampil()') === 0);
}

console.log(`\n===== BATAS JAM TAMPIL: ${pass} lolos, ${fail} gagal =====`);
process.exit(fail ? 1 : 0);
