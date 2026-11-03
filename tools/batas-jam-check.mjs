// Uji "Batas Jam per Tanggal" pada Input Kehadiran, plus kolom Jml Absen di daftar kehadiran.
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

const SENIN = '2026-11-02';
const SELASA = '2026-11-03';
const RABU = '2026-11-04';
const ev = kode => window.eval(kode);

// Guru contoh: jadwal 10 JP tiap hari kerja, Jam ke- 1..10.
ev(`
  penggunaAktif = { username: 'admin', role: 'admin' };
  akunSiswaLogin = [];
  localStorage.removeItem('batasJamPerTanggal');
  localStorage.removeItem('batasJamTampilGlobal');
  localStorage.removeItem('batasJamPerHariGlobal');
  batasJamPerTanggalCache = null;
  dataGuru = [{
    id: 'g1', kode: 'A', nama: 'Guru Sepuluh Jam', jabatan: 'Guru Tetap', nip: '1',
    jenisKelamin: 'L', aktif: true, honor: {}, jadwal: { 0: 0, 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 0 },
    jadwalHarian: { 1: 10, 2: 10, 3: 10, 4: 10, 5: 10 },
    jamKeHarian: { 1: [1,2,3,4,5,6,7,8,9,10], 2: [1,2,3,4,5,6,7,8,9,10], 3: [1,2,3,4,5,6,7,8,9,10], 4: [1,2,3,4,5,6,7,8,9,10], 5: [1,2,3,4,5,6,7,8,9,10] }
  }];
  dataKehadiran = [];
  hariLiburList = [];
  taSet('dataGuru_v2', dataGuru);
  taSet('dataKehadiran', dataKehadiran);
  document.getElementById('kehadiranJumlahKolom').value = '10';
`);

// ---------------------------------------------------------------------------
console.log('\n-- 1. Awal: tanpa batas, tidak ada tanggal yang dibatasi --');
{
  check('getBatasJamTanggal(Senin) = 0', ev(`getBatasJamTanggal('${SENIN}')`) === 0);
  check('daftar batas kosong', ev('getDaftarBatasJamTanggal()').length === 0);
  check('target Senin = 10 JP', ev(`getTargetJamGuruTanggal(dataGuru[0], '${SENIN}')`) === 10);
  check('kolom tampil Senin = 10', ev(`getJumlahKolomTampil('${SENIN}')`) === 10);
  check('key lama tidak dipakai lagi',
    ev(`localStorage.getItem('batasJamPerTanggal')`) === null);
}

// ---------------------------------------------------------------------------
console.log('\n-- 2. Isi batas untuk SATU tanggal lewat form --');
{
  ev(`openModalKehadiran()`);
  await sleep(80);
  ev(`document.getElementById('kehadiranTanggal').value = '${SENIN}'; tanggalInputKehadiranBerubah();`);
  await sleep(80);

  const adaInput = ev(`!!document.getElementById('batasJamTanggal')`);
  check('input #batasJamTanggal ada', adaInput);
  check('input lama #batasJamTampil sudah tidak ada', ev(`!document.getElementById('batasJamTampil')`));
  check('label menyebut tanggal terpilih', /Sen 2\/11/.test(ev(`document.getElementById('labelBatasJamTanggal').textContent`)),
    ev(`document.getElementById('labelBatasJamTanggal').textContent`));

  ev(`document.getElementById('batasJamTanggal').value = '7'`);
  ev(`simpanBatasJamTanggalDariForm()`);
  await sleep(80);

  check('getBatasJamTanggal(Senin) = 7', ev(`getBatasJamTanggal('${SENIN}')`) === 7);
  check('SELASA TIDAK ikut dibatasi', ev(`getBatasJamTanggal('${SELASA}')`) === 0);
  check('Rabu TIDAK ikut dibatasi', ev(`getBatasJamTanggal('${RABU}')`) === 0);
  const peta = JSON.parse(ev(`localStorage.getItem('batasJamPerTanggal')`));
  check('tersimpan per tanggal di localStorage', peta[SENIN] === 7 && Object.keys(peta).length === 1, JSON.stringify(peta));
}

// ---------------------------------------------------------------------------
console.log('\n-- 3. Target & kolom hanya berubah di tanggal itu --');
{
  check('target Senin = 7 JP', ev(`getTargetJamGuruTanggal(dataGuru[0], '${SENIN}')`) === 7,
    String(ev(`getTargetJamGuruTanggal(dataGuru[0], '${SENIN}')`)));
  check('target Selasa tetap 10 JP', ev(`getTargetJamGuruTanggal(dataGuru[0], '${SELASA}')`) === 10);
  check('kolom tampil Senin = 7', ev(`getJumlahKolomTampil('${SENIN}')`) === 7);
  check('kolom tampil Selasa = 10', ev(`getJumlahKolomTampil('${SELASA}')`) === 10);

  const slotSenin = ev(`getSlotJamDenganReferensi(dataGuru[0], 7, 10, '${SENIN}')`);
  const slotSelasa = ev(`getSlotJamDenganReferensi(dataGuru[0], 10, 10, '${SELASA}')`);
  check('slot Senin: 1–7 aktif, 8–10 mati',
    slotSenin.slice(0, 7).every(x => x.aktif) && slotSenin.slice(7).every(x => !x.aktif));
  check('slot Selasa: semua 10 aktif', slotSelasa.every(x => x.aktif));
}

// ---------------------------------------------------------------------------
console.log('\n-- 4. Pindah tanggal memuat batas tanggal itu --');
{
  ev(`document.getElementById('kehadiranTanggal').value = '${SENIN}'; tanggalInputKehadiranBerubah();`);
  await sleep(60);
  check('Senin: isian menampilkan 7', ev(`document.getElementById('batasJamTanggal').value`) === '7');
  ev(`document.getElementById('kehadiranTanggal').value = '${SELASA}'; tanggalInputKehadiranBerubah();`);
  await sleep(60);
  check('Selasa: isian kosong (tidak dibatasi)', ev(`document.getElementById('batasJamTanggal').value`) === '');

  ev(`document.getElementById('batasJamTanggal').value = '5'`);
  ev(`simpanBatasJamTanggalDariForm()`);
  await sleep(80);
  check('Selasa kini dibatasi 5', ev(`getBatasJamTanggal('${SELASA}')`) === 5);
  check('Senin tetap 7', ev(`getBatasJamTanggal('${SENIN}')`) === 7);
  check('chip daftar berisi 2 tanggal', ev(`document.querySelectorAll('#daftarBatasJamTanggal span.inline-flex').length`) === 2);
}

// ---------------------------------------------------------------------------
console.log('\n-- 5. Rekap: hadir dipotong & Absen kosong hanya di tanggal yang dibatasi --');
{
  // Senin tercatat 10 JP (batas 7), Selasa tercatat 10 JP (batas 5).
  ev(`dataKehadiran = [
    { id:'k1', guruId:'g1', tanggal:'${SENIN}', jumlah:10, keterangan:'' },
    { id:'k2', guruId:'g1', tanggal:'${SELASA}', jumlah:10, keterangan:'' }
  ]; taSet('dataKehadiran', dataKehadiran);`);

  const r = ev(`hitungRingkasanJamKehadiran(dataGuru[0], ['${SENIN}','${SELASA}'])`);
  check('hadir dipotong = 7 + 5 = 12', r.jumlahHadir === 12, String(r.jumlahHadir));
  check('target = 7 + 5 = 12', r.totalJamJadwal === 12, String(r.totalJamJadwal));
  check('absen 0 (kedua tanggal penuh)', r.jumlahAbsen === 0, String(r.jumlahAbsen));
  check('rincianAbsen kosong', (r.rincianAbsen || []).length === 0);

  // Selasa kurang: catat 3 JP (batas 5) -> absen 2 hanya di Selasa.
  ev(`dataKehadiran = [
    { id:'k1', guruId:'g1', tanggal:'${SENIN}', jumlah:10, keterangan:'' },
    { id:'k2', guruId:'g1', tanggal:'${SELASA}', jumlah:3, keterangan:'' }
  ]; taSet('dataKehadiran', dataKehadiran);`);
  const r2 = ev(`hitungRingkasanJamKehadiran(dataGuru[0], ['${SENIN}','${SELASA}'])`);
  check('hadir = 7 + 3 = 10', r2.jumlahHadir === 10, String(r2.jumlahHadir));
  check('absen = 2 (hanya Selasa)', r2.jumlahAbsen === 2, String(r2.jumlahAbsen));
  check('rincian menyebut Selasa', (r2.rincianAbsen || []).some(x => x.tanggal === SELASA && x.kurang === 2),
    JSON.stringify(r2.rincianAbsen));
  check('Senin tidak masuk rincian', !(r2.rincianAbsen || []).some(x => x.tanggal === SENIN));
}

// ---------------------------------------------------------------------------
console.log('\n-- 6. Daftar list kehadiran: sel harian & kolom Jml Absen --');
{
  ev(`document.getElementById('filterKehadiranDari').value = '${SENIN}'`);
  ev(`document.getElementById('filterKehadiranSampai').value = '2026-11-06'`);
  ev(`renderTabelKehadiran()`);
  await sleep(120);

  const info = ev(`(function(){
    const th = [...document.querySelectorAll('#theadKehadiran th')].map(t => t.textContent.trim());
    const tr = document.querySelector('#tabelKehadiran tr');
    const td = [...tr.children];
    const ambil = nama => {
      const i = th.findIndex(h => new RegExp(nama, 'i').test(h));
      return i < 0 ? null : { teks: td[i].textContent.trim(), title: td[i].getAttribute('title') };
    };
    return {
      harian: td.slice(2, 7).map(x => x.textContent.trim()),
      hadir: ambil('Jml Hadir'), absen: ambil('Jml Absen'), target: ambil('Jml Jam Target')
    };
  })()`);

  check('target baris = 12 JP (7 + 5)', info.target.teks === '12', info.target.teks);
  check('hadir baris = 10 JP', info.hadir.teks === '10', info.hadir.teks);
  check('Jml Absen = 2', info.absen.teks === '2', info.absen.teks);
  check('tooltip Jml Absen menyebut tanggal & jumlah',
    /Sel 3\/11\/26 \(2 JP\)/.test(info.absen.title || ''), info.absen.title);
  check('sel Senin menampilkan 7j (dipotong dari 10)', /^7j/.test(info.harian[0]), info.harian[0]);
  check('sel Senin menandai +3 yang dipotong', /\+3/.test(info.harian[0]), info.harian[0]);
  check('sel Selasa menampilkan 3j tanpa potongan', /^3j/.test(info.harian[1]) && !/\+/.test(info.harian[1]), info.harian[1]);
  check('sel Rabu tetap kosong (tidak ada data)', info.harian[2] === '-', info.harian[2]);
}

// ---------------------------------------------------------------------------
console.log('\n-- 7. Daftar: tanggal penuh -> Jml Absen kosong --');
{
  ev(`dataKehadiran = [
    { id:'k1', guruId:'g1', tanggal:'${SENIN}', jumlah:10, keterangan:'' },
    { id:'k2', guruId:'g1', tanggal:'${SELASA}', jumlah:5, keterangan:'' }
  ]; taSet('dataKehadiran', dataKehadiran);`);
  ev(`renderTabelKehadiran()`);
  await sleep(100);
  const info = ev(`(function(){
    const th = [...document.querySelectorAll('#theadKehadiran th')].map(t => t.textContent.trim());
    const tr = document.querySelector('#tabelKehadiran tr');
    const td = [...tr.children];
    const i = th.findIndex(h => /Jml Absen/i.test(h));
    return { teks: td[i].textContent.trim(), title: td[i].getAttribute('title') };
  })()`);
  check('Jml Absen kosong ("-") saat semua tanggal penuh', info.teks === '-', info.teks);
  check('tooltip menjelaskan penuh', /Penuh/.test(info.title || ''), info.title);
}

// ---------------------------------------------------------------------------
console.log('\n-- 8. Input massal mengikuti batas tanggal terpilih --');
{
  ev(`openModalKehadiranMassal()`);
  await sleep(80);
  ev(`document.getElementById('kehadiranTanggal').value = '${SENIN}'; tanggalInputKehadiranBerubah(); renderInputKehadiranMassal();`);
  await sleep(100);
  const kotakSenin = ev(`document.querySelectorAll('.mass-jam-g1').length`);
  check('Senin (batas 7): 7 kotak centang', kotakSenin === 7, `${kotakSenin} kotak`);
  const targetSel = ev(`document.querySelector('#mass-row-g1 td:nth-last-child(3)').textContent.trim()`);
  check('kolom Target Mengajar = 7 JP', targetSel === '7 JP', targetSel);

  ev(`document.getElementById('kehadiranTanggal').value = '${SELASA}'; tanggalInputKehadiranBerubah(); renderInputKehadiranMassal();`);
  await sleep(100);
  check('Selasa (batas 5): 5 kotak centang', ev(`document.querySelectorAll('.mass-jam-g1').length`) === 5);
}

// ---------------------------------------------------------------------------
console.log('\n-- 9. Hapus batas satu tanggal tidak menghapus tanggal lain --');
{
  const tanggalChip = ev(`document.querySelectorAll('#daftarBatasJamTanggal span.inline-flex button')[1]`);
  check('tombol hapus pada chip tersedia', !!tanggalChip);
  ev(`hapusBatasJamTanggalDariDaftar('${SENIN}')`);
  await sleep(80);
  check('Senin kembali tanpa batas', ev(`getBatasJamTanggal('${SENIN}')`) === 0);
  check('Selasa masih dibatasi 5', ev(`getBatasJamTanggal('${SELASA}')`) === 5);
  check('target Senin kembali 10 JP', ev(`getTargetJamGuruTanggal(dataGuru[0], '${SENIN}')`) === 10);

  ev(`document.getElementById('kehadiranTanggal').value = '${SELASA}'; tanggalInputKehadiranBerubah();`);
  await sleep(60);
  ev(`kosongkanBatasJamTanggal()`);
  await sleep(80);
  check('kini tidak ada tanggal dibatasi', ev('getDaftarBatasJamTanggal()').length === 0);
}

// ---------------------------------------------------------------------------
console.log('\n-- 10. Cetak Kehadiran Guru memakai target per tanggal --');
{
  ev(`setBatasJamTanggal('${SENIN}', 7)`);
  ev(`dataKehadiran = [{ id:'k1', guruId:'g1', tanggal:'${SENIN}', jumlah:10, keterangan:'' }]; taSet('dataKehadiran', dataKehadiran);`);
  ev(`document.getElementById('printRekapArea').innerHTML = ''`);
  ev(`document.getElementById('rekapBulan').value = '11'; document.getElementById('rekapTahun').value = '2026';`);
  ev(`cetakRekapKehadiranGuru()`);
  await sleep(150);
  const isi = ev(`document.getElementById('printRekapArea').innerHTML`);
  check('dokumen cetak terbentuk', isi.length > 500, `${isi.length} byte`);
  const d = new JSDOM(isi);
  const th = [...d.window.document.querySelectorAll('table.data-kehadiran thead th')].map(x => x.textContent.trim());
  const tds = [...d.window.document.querySelectorAll('table.data-kehadiran tbody tr')[0].querySelectorAll('td')]
    .map(x => x.textContent.trim());
  const iTarget = th.findIndex(x => /Target/i.test(x));
  const iHadir = th.findIndex(x => /^Kehadiran/i.test(x));
  const iAbsen = th.findIndex(x => /^Absen/i.test(x));
  check('cetak: Jml Target = 7', tds[iTarget] === '7', tds[iTarget]);
  check('cetak: Kehadiran = 7', tds[iHadir] === '7', tds[iHadir]);
  check('cetak: Absen kosong', tds[iAbsen] === '', JSON.stringify(tds[iAbsen]));
}

// ---------------------------------------------------------------------------
console.log('\n-- 11. Jam mengajar di LUAR batas tidak boleh jadi "kurang target" --');
{
  // Kasus laporan pengguna: guru mengajar jam ke-6..10 (5 JP), batas tanggal 7.
  // Kotak yang tersedia hanya jam 6 dan 7 (2 JP), semuanya bisa dicentang.
  const JUMAT = '2026-10-09'; // 9 Oktober 2026
  check('9 Oktober 2026 memang hari Jumat', new Date(JUMAT + 'T00:00:00').getDay() === 5);

  ev(`
    batasJamPerTanggalCache = {};
    setBatasJamTanggal('${JUMAT}', 7);
    dataGuru = [{
      id: 'g9', kode: 'J', nama: 'Guru Jam Sore', jabatan: 'Guru Tetap', nip: '9',
      jenisKelamin: 'L', aktif: true, honor: {}, jadwal: { 0: 0, 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 0 },
      jadwalHarian: { 1: 5, 2: 5, 3: 5, 4: 5, 5: 5 },
      jamKeHarian: { 1: [1,2,3,4,5], 2: [1,2,3,4,5], 3: [1,2,3,4,5], 4: [1,2,3,4,5], 5: [6,7,8,9,10] }
    }];
    taSet('dataGuru_v2', dataGuru);
  `);

  const target = ev(`getTargetJamGuruTanggal(dataGuru[0], '${JUMAT}')`);
  check('target = 2 JP (hanya jam 6,7 yang di dalam batas)', target === 2, String(target));

  const slots = ev(`getSlotJamDenganReferensi(dataGuru[0], 2, 10, '${JUMAT}')`);
  const aktif = slots.filter(x => x.aktif).map(x => x.nomor);
  check('kotak yang tersedia hanya jam 6 dan 7', JSON.stringify(aktif) === JSON.stringify([6, 7]), JSON.stringify(aktif));

  // Semua kotak dicentang -> tidak boleh ada kekurangan.
  ev(`dataKehadiran = [{ id:'k9', guruId:'g9', tanggal:'${JUMAT}', jumlah:2, jamKeHadir:[6,7], keterangan:'' }];
      taSet('dataKehadiran', dataKehadiran);`);
  const r = ev(`hitungRingkasanJamKehadiran(dataGuru[0], ['${JUMAT}'])`);
  check('hadir = 2 JP (semua kotak tercentang)', r.jumlahHadir === 2, String(r.jumlahHadir));
  check('absen = 0 (tidak ada kotak kosong)', r.jumlahAbsen === 0, String(r.jumlahAbsen));

  // Daftar kehadiran: sel tidak berwarna kuning & Jml Absen kosong.
  ev(`document.getElementById('filterKehadiranDari').value = '${JUMAT}'`);
  ev(`document.getElementById('filterKehadiranSampai').value = '${JUMAT}'`);
  ev(`document.getElementById('searchKehadiran').value = ''`);
  ev(`renderTabelKehadiran()`);
  await sleep(120);
  const sel = ev(`(function(){
    const tr = document.querySelector('#tabelKehadiran tr');
    if (!tr) return null;
    const td = [...tr.children];
    const th = [...document.querySelectorAll('#theadKehadiran th')].map(x => x.textContent.trim());
    const iAbsen = th.findIndex(x => /Jml Absen/i.test(x));
    const selHarian = td[2];
    return {
      kelasSel: selHarian.innerHTML,
      absen: td[iAbsen] ? td[iAbsen].textContent.trim() : null
    };
  })()`);
  check('sel tanggal TIDAK kuning (tidak "Kurang dari Target")',
    sel && !/bg-yellow-(300|400)/.test(sel.kelasSel), sel ? sel.kelasSel.slice(0, 120) : 'baris kosong');
  check('sel tanggal TIDAK merah', sel && !/bg-red-(600|700)/.test(sel.kelasSel));
  check('Jml Absen kosong ("-")', sel && sel.absen === '-', sel ? sel.absen : '-');

  // Bila memang kurang (mis. hanya 1 JP tercatat), Absen tetap muncul.
  ev(`dataKehadiran = [{ id:'k9', guruId:'g9', tanggal:'${JUMAT}', jumlah:1, jamKeHadir:[6], keterangan:'' }];
      taSet('dataKehadiran', dataKehadiran);`);
  const r2 = ev(`hitungRingkasanJamKehadiran(dataGuru[0], ['${JUMAT}'])`);
  check('kalau benar-benar kurang: absen = 1', r2.jumlahAbsen === 1, String(r2.jumlahAbsen));
  ev(`renderTabelKehadiran()`);
  await sleep(100);
  const sel2 = ev(`document.querySelector('#tabelKehadiran tr').children[2].innerHTML`);
  check('sel jadi kuning saat memang kurang', /bg-yellow-(300|400)/.test(sel2), sel2.slice(0, 100));
}

// ---------------------------------------------------------------------------
console.log('\n-- 12. Guru dengan jam mengajar semuanya di atas batas --');
{
  const JUMAT = '2026-10-09';
  ev(`
    dataGuru = [{
      id: 'g10', kode: 'S', nama: 'Guru Sore Penuh', jabatan: 'Guru Tetap', nip: '10',
      jenisKelamin: 'L', aktif: true, honor: {}, jadwal: { 0: 0, 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 0 },
      jadwalHarian: { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3 },
      jamKeHarian: { 1: [1,2,3], 2: [1,2,3], 3: [1,2,3], 4: [1,2,3], 5: [8,9,10] }
    }];
    taSet('dataGuru_v2', dataGuru);
    dataKehadiran = [{ id:'k10', guruId:'g10', tanggal:'${JUMAT}', jumlah:3, keterangan:'' }];
    taSet('dataKehadiran', dataKehadiran);
  `);
  const target = ev(`getTargetJamGuruTanggal(dataGuru[0], '${JUMAT}')`);
  check('target = 0 (tidak ada jam di dalam batas)', target === 0, String(target));
  const r = ev(`hitungRingkasanJamKehadiran(dataGuru[0], ['${JUMAT}'])`);
  check('tidak menagih absen', r.jumlahAbsen === 0, String(r.jumlahAbsen));
}

console.log(`\n===== BATAS JAM PER TANGGAL: ${pass} lolos, ${fail} gagal =====`);
process.exit(fail ? 1 : 0);
