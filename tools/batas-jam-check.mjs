// Uji "Batas Jam Pelajaran per Hari" pada Input Kehadiran (massal & individu).
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

// 2026-11-02 = Senin, 2026-11-03 = Selasa
const SENIN = '2026-11-02';
const SELASA = '2026-11-03';

// Guru contoh: jadwal 10 JP tiap hari kerja, Jam ke- 1..10.
window.eval(`
  penggunaAktif = { username: 'admin', role: 'admin' };
  akunSiswaLogin = [];
  localStorage.removeItem('batasJamPerHariGlobal');
  batasJamPerHariCache = null;
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
console.log('\n-- 1. Sebelum batas diisi: perilaku lama tidak berubah --');
{
  check('getBatasJamHari(1) = 0 (tanpa batas)', ev('getBatasJamHari(1)') === 0, String(ev('getBatasJamHari(1)')));
  check('target Senin tetap 10 JP', ev(`getTargetJamGuruTanggal(dataGuru[0], '${SENIN}')`) === 10,
    String(ev(`getTargetJamGuruTanggal(dataGuru[0], '${SENIN}')`)));
  check('jadwal efektif = jadwal mentah', ev('getJamJadwalHarianEfektif(dataGuru[0], 1)') === 10);
  check('ringkasan batas kosong', ev('getRingkasanBatasJam()') === '', ev('getRingkasanBatasJam()'));
}

// ---------------------------------------------------------------------------
console.log('\n-- 2. Isi batas lewat form: Senin 7, Selasa 5 --');
{
  ev(`renderBatasJamPerHariInputs()`);
  const jumlahInput = ev(`document.querySelectorAll('#batasJamPerHariContainer input[id^="batasJamHari"]').length`);
  check('ada 6 input (Senin–Sabtu)', jumlahInput === 6, `${jumlahInput} input`);

  const label = ev(`[...document.querySelectorAll('#batasJamPerHariContainer label')].map(l => l.textContent).join(',')`);
  check('label hari benar', label === 'Senin,Selasa,Rabu,Kamis,Jumat,Sabtu', label);

  ev(`document.getElementById('batasJamHari1').value = '7'`);
  ev(`document.getElementById('batasJamHari2').value = '5'`);
  ev(`simpanBatasJamPerHariDariForm()`);

  check('getBatasJamHari(1) = 7', ev('getBatasJamHari(1)') === 7, String(ev('getBatasJamHari(1)')));
  check('getBatasJamHari(2) = 5', ev('getBatasJamHari(2)') === 5);
  check('hari tanpa batas tetap 0 (Rabu)', ev('getBatasJamHari(3)') === 0);
  const tersimpan = JSON.parse(ev(`localStorage.getItem('batasJamPerHariGlobal')`));
  check('tersimpan ke localStorage', tersimpan['1'] === 7 && tersimpan['2'] === 5, JSON.stringify(tersimpan));
  const info = ev(`document.getElementById('infoBatasJamPerHari').textContent`);
  check('info menyebut batas aktif', /Senin 7/.test(info) && /Selasa 5/.test(info), info);
}

// ---------------------------------------------------------------------------
console.log('\n-- 3. Target JP terpotong sesuai batas hari --');
{
  const targetSenin = ev(`getTargetJamGuruTanggal(dataGuru[0], '${SENIN}')`);
  const targetSelasa = ev(`getTargetJamGuruTanggal(dataGuru[0], '${SELASA}')`);
  const targetRabu = ev(`getTargetJamGuruTanggal(dataGuru[0], '2026-11-04')`);
  check('Senin (jadwal 10, batas 7) -> 7 JP', targetSenin === 7, String(targetSenin));
  check('Selasa (jadwal 10, batas 5) -> 5 JP', targetSelasa === 5, String(targetSelasa));
  check('Rabu (tanpa batas) -> 10 JP', targetRabu === 10, String(targetRabu));

  // Batas adalah maksimum, bukan memaksa naik.
  ev(`dataGuru.push({ id:'g2', kode:'B', nama:'Guru Lima Jam', jabatan:'-', jenisKelamin:'L', aktif:true, honor:{}, jadwalHarian:{1:5,2:5,3:5,4:5,5:5} })`);
  const targetLima = ev(`getTargetJamGuruTanggal(dataGuru[1], '${SENIN}')`);
  check('jadwal 5 dengan batas 7 -> tetap 5 JP', targetLima === 5, String(targetLima));
  ev(`dataGuru.pop()`);
}

// ---------------------------------------------------------------------------
console.log('\n-- 4. Slot jam di atas batas tidak bisa dicentang --');
{
  const slots = ev(`getSlotJamDenganReferensi(dataGuru[0], 7, 10, '${SENIN}')`);
  check('jumlah slot = 10 kolom', slots.length === 10);
  check('jam 1–7 aktif', [1,2,3,4,5,6,7].every(n => slots[n - 1].aktif));
  check('jam 8,9,10 non-aktif', [8,9,10].every(n => slots[n - 1].aktif === false));
  const slotsSelasa = ev(`getSlotJamDenganReferensi(dataGuru[0], 5, 10, '${SELASA}')`);
  check('Selasa hanya jam 1–5 aktif', [1,2,3,4,5].every(n => slotsSelasa[n - 1].aktif) && [6,7,8,9,10].every(n => !slotsSelasa[n - 1].aktif));
}

// ---------------------------------------------------------------------------
console.log('\n-- 5. Rekap: sisa jam tidak dihitung sebagai Absen --');
{
  // Hadir 7 JP di Senin (batas 7 dari jadwal 10).
  ev(`dataKehadiran = [{ id:'k1', guruId:'g1', tanggal:'${SENIN}', jumlah:7, keterangan:'' }]`);
  ev(`taSet('dataKehadiran', dataKehadiran)`);

  const ringkasan = ev(`hitungRingkasanJamKehadiran(dataGuru[0], ['${SENIN}'])`);
  check('hadir = 7 JP', ringkasan.jumlahHadir === 7, String(ringkasan.jumlahHadir));
  check('absen = 0 JP (3 jam sisa diabaikan)', ringkasan.jumlahAbsen === 0, String(ringkasan.jumlahAbsen));
  check('total target harian = 7 JP', ringkasan.totalJamJadwal === 7, String(ringkasan.totalJamJadwal));

  const baris = ev(`getDataRekapKehadiranGuru(11, 2026).find(r => r.guruId === 'g1')`);
  check('rekap: prosentase 100%', Math.round(baris.prosentase) === 100, String(baris.prosentase));
  check('rekap: kolom Absen (JP) = 0', baris.absen === 0, String(baris.absen));

  // Alasan ijin tidak muncul karena tidak ada kekurangan jam.
  const alasan = ev(`getAlasanIzinGuru(dataGuru[0], ['${SENIN}'])`);
  check('tidak ada alasan ijin palsu', alasan === '-', String(alasan));
}

// ---------------------------------------------------------------------------
console.log('\n-- 6. Tampilan Input Massal mengikuti batas --');
{
  ev(`openModalKehadiranMassal()`);
  // Simulasikan pengguna memilih tanggal (memicu onchange) seperti di browser.
  ev(`document.getElementById('kehadiranTanggal').value = '${SENIN}'`);
  ev(`tanggalInputKehadiranBerubah()`);
  ev(`renderInputKehadiranMassal()`);
  await sleep(120);

  const idAman = ev(`String(dataGuru[0].id).replace(/[^A-Za-z0-9_-]/g, '_')`);
  const kotakJam = ev(`document.querySelectorAll('.mass-jam-${idAman}').length`);
  check('hanya 7 kotak centang mengajar (bukan 10)', kotakJam === 7, `${kotakJam} kotak`);

  const kolomTarget = ev(`document.querySelector('#mass-row-${idAman} td:nth-last-child(3)').textContent.trim()`);
  check('kolom Target Mengajar = 7 JP', kolomTarget === '7 JP', kolomTarget);

  ev(`centangSemuaJamMassal()`);
  await sleep(60);
  const totalSetelahCentang = ev(`jumlahJamDariKotak(document.getElementById('mass-row-${idAman}'))`);
  check('centang semua tetap maksimal 7 JP', totalSetelahCentang === 7, String(totalSetelahCentang));
  const teksTotal = ev(`document.getElementById('mass-total-${idAman}').textContent`);
  check('Total Mengajar tampil 7 JP', teksTotal === '7 JP', teksTotal);

  // Simpan: record tersimpan 7 JP, bukan 10.
  ev(`dataKehadiran = [];`);
  ev(`simpanKehadiranMassal()`);
  await sleep(80);
  const record = ev(`dataKehadiran.find(k => k.guruId === 'g1' && k.tanggal === '${SENIN}' && k.isPiket !== true)`);
  check('data tersimpan 7 JP', record && Number(record.jumlah) === 7, record ? String(record.jumlah) : 'tidak ada record');
  const jamKeTersimpan = record && Array.isArray(record.jamKeHadir) ? record.jamKeHadir : [];
  check('jam ke- tersimpan maksimal 7', jamKeTersimpan.every(n => n <= 7), JSON.stringify(jamKeTersimpan));
  check('posisi jam tersimpan lengkap (1–7)', JSON.stringify(jamKeTersimpan) === JSON.stringify([1,2,3,4,5,6,7]), JSON.stringify(jamKeTersimpan));
}

// ---------------------------------------------------------------------------
console.log('\n-- 6b. Posisi centang tersimpan akurat (tanpa batas) --');
{
  // Tanpa batas: centang hanya jam 6 dan 7 -> data harus menyimpan [6,7], bukan [1,2].
  ev(`setBatasJamPerHari({})`);
  ev(`dataKehadiran = []`);
  ev(`document.getElementById('kehadiranTanggal').value = '${SENIN}'`);
  ev(`tanggalInputKehadiranBerubah()`);
  ev(`renderInputKehadiranMassal()`);
  await sleep(80);
  const idAman = ev(`String(dataGuru[0].id).replace(/[^A-Za-z0-9_-]/g, '_')`);
  ev(`document.querySelectorAll('.mass-jam-${idAman}').forEach(cb => { cb.checked = ['6','7'].includes(cb.dataset.jamNomor); })`);
  check('jumlah JP terhitung 2', ev(`jumlahJamDariKotak(document.getElementById('mass-row-${idAman}'))`) === 2);
  ev(`simpanKehadiranMassal()`);
  await sleep(80);
  const rec = ev(`dataKehadiran.find(k => k.guruId === 'g1' && k.tanggal === '${SENIN}')`);
  check('jamKeHadir = [6,7]', rec && JSON.stringify(rec.jamKeHadir) === JSON.stringify([6,7]), rec ? JSON.stringify(rec.jamKeHadir) : 'kosong');
  check('jumlah = 2 JP', rec && Number(rec.jumlah) === 2, rec ? String(rec.jumlah) : '-');

  // Buka ulang: centang harus kembali di jam 6 dan 7, bukan 1 dan 2.
  ev(`renderInputKehadiranMassal()`);
  await sleep(80);
  const tercentang = ev(`[...document.querySelectorAll('.mass-jam-${idAman}:checked')].map(cb => cb.dataset.jamNomor)`);
  check('buka ulang: centang di jam 6,7', JSON.stringify(tercentang) === JSON.stringify(['6','7']), JSON.stringify(tercentang));
}

// ---------------------------------------------------------------------------
console.log('\n-- 7. Kamis (tanpa batas) tetap 10 JP --');
{
  ev(`document.getElementById('kehadiranTanggal').value = '2026-11-05'`);
  ev(`tanggalInputKehadiranBerubah()`);
  ev(`renderInputKehadiranMassal()`);
  await sleep(80);
  const idAman = ev(`String(dataGuru[0].id).replace(/[^A-Za-z0-9_-]/g, '_')`);
  const kotakJam = ev(`document.querySelectorAll('.mass-jam-${idAman}').length`);
  check('Kamis tetap 10 kotak centang', kotakJam === 10, `${kotakJam} kotak`);
}

// ---------------------------------------------------------------------------
console.log('\n-- 8. Kosongkan batas = kembali seperti semula --');
{
  ev(`kosongkanBatasJamPerHari()`);
  await sleep(80);
  check('localStorage kosong', ev(`localStorage.getItem('batasJamPerHariGlobal')`) === '{}');
  check('getBatasJamHari(1) = 0', ev('getBatasJamHari(1)') === 0);
  check('target Senin kembali 10 JP', ev(`getTargetJamGuruTanggal(dataGuru[0], '${SENIN}')`) === 10);
  ev(`document.getElementById('kehadiranTanggal').value = '${SENIN}'`);
  ev(`tanggalInputKehadiranBerubah()`);
  ev(`renderInputKehadiranMassal()`);
  await sleep(80);
  const idAman = ev(`String(dataGuru[0].id).replace(/[^A-Za-z0-9_-]/g, '_')`);
  check('kotak centang kembali 10', ev(`document.querySelectorAll('.mass-jam-${idAman}').length`) === 10);
}

// ---------------------------------------------------------------------------
console.log('\n-- 9. Cetak Kehadiran Guru memakai target yang sudah dibatasi --');
{
  ev(`setBatasJamPerHari({ '1': 7 })`);
  ev(`dataKehadiran = [{ id:'k1', guruId:'g1', tanggal:'${SENIN}', jumlah:7, keterangan:'' }]`);
  ev(`taSet('dataKehadiran', dataKehadiran)`);
  ev(`document.getElementById('printRekapArea').innerHTML = ''`);
  ev(`document.getElementById('rekapBulan').value = '11'`);
  ev(`document.getElementById('rekapTahun').value = '2026'`);
  ev(`cetakRekapKehadiranGuru()`);
  await sleep(150);
  const isiCetak = ev(`document.getElementById('printRekapArea').innerHTML`);
  check('dokumen cetak terbentuk', isiCetak.length > 500, `${isiCetak.length} byte`);
  check('kolom Jml Target menampilkan 7', /<td class="center"><strong>7<\/strong><\/td>/.test(isiCetak), 'tidak ada sel target 7');
  check('tidak ada prosentase 70% di cetakan', !/>70%</.test(isiCetak));
}

console.log(`\n===== BATAS JAM PER HARI: ${pass} lolos, ${fail} gagal =====`);
process.exit(fail ? 1 : 0);
