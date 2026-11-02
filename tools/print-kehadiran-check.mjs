// Uji cetak "Rekap Kehadiran Guru": memastikan tabel tidak terpotong.
// Jalankan: npm install --no-save jsdom && node tools/print-kehadiran-check.mjs
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

function buatDom() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const pesan = String(e?.message || e);
    if (!/Could not load|not implemented|fillStyle|getContext/i.test(pesan)) console.log('[jsdom]', pesan);
  });
  const dom = new JSDOM(html, {
    url: 'http://localhost/?local',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;
  window.print = () => { window.__dicetak = (window.__dicetak || 0) + 1; };
  window.alert = () => {};
  window.confirm = () => true;
  return window;
}

// Siapkan data guru + kehadiran, lalu render HTML cetak.
async function siapkanDanCetak(jumlahKategori) {
  const window = buatDom();
  await sleep(250);
  const SEMUA_KATEGORI = ['Alpa', 'Sakit', 'Keperluan Keluarga', 'Tugas Dinas', 'Izin Khusus', 'Diklat', 'Cuti',
    'Lainnya', 'Sakit Keras', 'Izin Pulang', 'Dinas Luar', 'Studi Banding', 'Haul', 'Ganti Jam'];
  const daftarKategori = SEMUA_KATEGORI.slice(0, jumlahKategori);
  window.eval(`
    penggunaAktif = { username: 'admin', role: 'admin' };
    akunSiswaLogin = [];
    dataGuru = Array.from({ length: 24 }, (_, i) => ({
      id: 'g' + i, kode: String.fromCharCode(65 + (i % 26)), nama: 'Guru Contoh Nama Panjang Nomor ' + (i + 1),
      jabatan: 'Guru Tetap', jenisKelamin: 'L', aktif: true, honor: {},
      jadwal: { 0: 0, 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 0 }
    }));
    taSet('dataGuru_v2', dataGuru);
    dataKehadiran = [];
    taSet('dataKehadiran', dataKehadiran);
    hariLiburList = [];
    taSet('keteranganIjinList', ${JSON.stringify(daftarKategori)});
    document.getElementById('rekapBulan').value = '10';
    document.getElementById('rekapTahun').value = '2026';
  `);
  await sleep(100);
  const sebelum = window.__dicetak || 0;
  window.eval('cetakRekapKehadiranGuru()');
  await sleep(150);
  const htmlCetak = window.document.getElementById('printRekapArea').innerHTML || '';
  return { window, htmlCetak, tercetak: (window.__dicetak || 0) > sebelum };
}

console.log('\n-- 1. Kategori default (4) --');
{
  const { htmlCetak, tercetak } = await siapkanDanCetak(4);
  check('window.print() dipanggil', tercetak);
  check('HTML cetak dihasilkan', htmlCetak.includes('REKAP KEHADIRAN GURU'), String(htmlCetak.length));
  check('CSS table-layout: fixed', /table\.data-kehadiran\s*\{[^}]*table-layout:\s*fixed/.test(htmlCetak.replace(/\s+/g, ' ')));
  check('baris tidak terbelah (page-break-inside)', /table\.data-kehadiran tr\s*\{[^}]*page-break-inside:\s*avoid/.test(htmlCetak.replace(/\s+/g, ' ')));
  check('header diulang tiap halaman', /table\.data-kehadiran thead\s*\{\s*display:\s*table-header-group/.test(htmlCetak.replace(/\s+/g, ' ')));
  check('teks panjang membungkus', /overflow-wrap:\s*anywhere/.test(htmlCetak));
  check('A4 portrait untuk 4 kategori', /@page\s*\{\s*size:\s*A4 portrait/.test(htmlCetak));
  check('tidak ada max-width yang memotong', !/max-width:\s*19\.3cm/.test(htmlCetak));

  // Hitung total lebar kolom dari atribut style width pada <th>
  const dom = new JSDOM(htmlCetak);
  const ths = [...dom.window.document.querySelectorAll('table.data-kehadiran thead th')];
  const lebar = ths.map(th => parseFloat((th.getAttribute('style') || '').match(/width:\s*([\d.]+)%/)?.[1] || '0'));
  const total = lebar.reduce((a, b) => a + b, 0);
  const kolomTanpaLebar = ths.filter(th => !/width:/.test(th.getAttribute('style') || '')).length;
  check('semua kolom punya lebar eksplisit', kolomTanpaLebar === 0, `${kolomTanpaLebar} kolom tanpa width`);
  check('TOTAL lebar kolom = 100%', Math.abs(total - 100) < 0.001, `total = ${total}%`);
  check('jumlah kolom = 10 statis + 4 keterangan + 1 alasan', ths.length === 15, `${ths.length} kolom`);

  // Konsistensi jumlah sel: header vs body vs footer
  const tbodyTr = dom.window.document.querySelector('table.data-kehadiran tbody tr');
  const tdBody = tbodyTr ? tbodyTr.querySelectorAll('td').length : 0;
  check('jumlah <td> body = jumlah <th> header', tdBody === ths.length, `${tdBody} vs ${ths.length}`);
  const tfootTds = [...dom.window.document.querySelectorAll('table.data-kehadiran tfoot td')];
  const kolomFooter = tfootTds.reduce((n, td) => n + (parseInt(td.getAttribute('colspan') || '1', 10)), 0);
  check('jumlah kolom footer = header', kolomFooter === ths.length, `${kolomFooter} vs ${ths.length}`);
  check('24 guru tampil', dom.window.document.querySelectorAll('table.data-kehadiran tbody tr').length === 24);
}

console.log('\n-- 2. Kategori banyak (8) -> otomatis landscape --');
{
  const { htmlCetak } = await siapkanDanCetak(8);
  check('A4 landscape untuk 8 kategori', /@page\s*\{\s*size:\s*A4 landscape/.test(htmlCetak));
  const dom = new JSDOM(htmlCetak);
  const ths = [...dom.window.document.querySelectorAll('table.data-kehadiran thead th')];
  const total = ths.map(th => parseFloat((th.getAttribute('style') || '').match(/width:\s*([\d.]+)%/)?.[1] || '0')).reduce((a, b) => a + b, 0);
  check('19 kolom (10 + 8 + 1)', ths.length === 19, `${ths.length}`);
  check('TOTAL lebar kolom tetap 100%', Math.abs(total - 100) < 0.001, `total = ${total}%`);
  const alasan = ths[ths.length - 1].getAttribute('style');
  check('kolom Alasan Ijin tetap punya ruang (>= 4%)', parseFloat(alasan.match(/width:\s*([\d.]+)%/)[1]) >= 4, alasan);
}

console.log('\n-- 3. Matriks semua jumlah kategori (1–14) --');
{
  const hasil = [];
  const baris = [];
  for (let n = 1; n <= 14; n++) {
    const { htmlCetak } = await siapkanDanCetak(n);
    const dom = new JSDOM(htmlCetak);
    const ths = [...dom.window.document.querySelectorAll('table.data-kehadiran thead th')];
    const total = Math.round(ths.map(th => parseFloat((th.getAttribute('style') || '').match(/width:\s*([\d.]+)%/)?.[1] || '0')).reduce((a, b) => a + b, 0) * 10) / 10;
    const alasan = parseFloat((ths[ths.length - 1].getAttribute('style') || '').match(/width:\s*([\d.]+)%/)?.[1] || '0');
    const landscape = /size:\s*A4 landscape/.test(htmlCetak);
    const ok = total === 100 && alasan >= 8 && ths.length === 11 + n && (n > 6 ? landscape : !landscape);
    hasil.push(ok);
    baris.push(`    n=${String(n).padStart(2)}: total=${total}% alasan=${alasan}% kolom=${ths.length} ${landscape ? 'landscape' : 'portrait'} ${ok ? '✓' : '✗'}`);
    if (!ok) console.log(baris[baris.length - 1]);
  }
  check('14 kombinasi: total tepat 100%, alasan >= 8%, orientasi benar', hasil.every(Boolean), `${hasil.filter(Boolean).length}/14`);
  console.log(baris.join('\n'));
}

console.log('\n-- 4. Area cetak dibersihkan setelah dialog cetak ditutup --');
{
  const { window } = await siapkanDanCetak(8);
  const area = window.document.getElementById('printRekapArea');
  check('area cetak terisi sebelum ditutup', area.innerHTML.length > 100);
  const kejadian = new window.Event('afterprint');
  window.dispatchEvent(kejadian);
  check('area cetak kosong setelah afterprint', area.innerHTML === '');
  // Listener harus dilepas: dispatch ulang tidak error dan tetap kosong.
  let errorKedua = null;
  try { window.dispatchEvent(new window.Event('afterprint')); } catch (e) { errorKedua = e; }
  check('listener afterprint dilepas (tidak menumpuk)', errorKedua === null && area.innerHTML === '');
}

console.log(`\n===== CETAK KEHADIRAN: ${pass} lolos, ${fail} gagal =====`);
process.exit(fail ? 1 : 0);
