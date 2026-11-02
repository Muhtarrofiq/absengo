// Uji "bayangan kepala kolom tabel" pada SEMUA tampilan cetak.
// Jalankan: npm install --no-save jsdom && node tools/print-shadow-check.mjs
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

const sumber = fs.readFileSync('index.html', 'utf8');
const html = sumber
  .replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g, '')
  .replace(/<link[^>]+href="[^"]+"[^>]*>/g, '');

const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const pesan = String(e?.message || e);
  if (!/Could not load|not implemented|fillStyle|getContext|Not implemented/i.test(pesan)) console.log('[jsdom]', pesan);
});
const dom = new JSDOM(html, { url: 'http://localhost/?local', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
window.print = () => { window.__dicetak = (window.__dicetak || 0) + 1; };
window.alert = () => {};
window.confirm = () => true;
// cetakSlipGaji membuka jendela baru; stub agar HTML-nya bisa diperiksa.
window.open = () => ({
  document: { write: isi => { window.__slipHtml = isi; }, close: () => {} },
  focus: () => {}, print: () => {}, close: () => {},
});

// ---------------------------------------------------------------------------
// 1. Fungsi pembangun CSS: cssBayanganKepalaTabel()
// ---------------------------------------------------------------------------
console.log('\n-- 1. Fungsi cssBayanganKepalaTabel() --');
{
  const css = window.eval("cssBayanganKepalaTabel('table.contoh th')");
  check('memakai selector yang diminta', css.includes('table.contoh th {'));
  check('meminta warna ikut tercetak (print-color-adjust)', /print-color-adjust:\s*exact/.test(css));
  check('ada varian -webkit- (Chrome/Safari lama)', /-webkit-print-color-adjust:\s*exact/.test(css));
  check('ada lapisan gradasi', /linear-gradient\(to bottom/.test(css));
  check('ada lapisan box-shadow', /box-shadow:/.test(css));
  check('bayangan ada yang inset (di dalam sel)', /inset 0 -0?\.3em/.test(css));
  check('bayangan ada yang jatuh ke luar', /0 2px 3px rgba\(0, 0, 0, 0?\.2\)/.test(css));
  check('border bawah tebal (jalur aman-cetak)', /border-bottom:\s*3px solid #5f5f5f/.test(css));

  const tipis = window.eval("cssBayanganKepalaTabel('table.leger th', { tebal: 2 })");
  check('opsi tebal: 2 dihormati', /border-bottom:\s*2px solid/.test(tipis)); 

  const redup = window.eval("cssBayanganKepalaTabel('th', { redup: true })");
  check('opsi redup memperkecil alpha', /rgba\(0, 0, 0, 0?\.22\)/.test(redup) && /rgba\(0, 0, 0, 0?\.12\)/.test(redup));

  const kustom = window.eval("cssBayanganKepalaTabel('.slip-detail-table th', { gelap: '#9a9a9a', gradasi: '#fbfbfb 0%, #f3f4f6 60%' })");
  check('opsi gelap & gradasi dihormati', kustom.includes('#9a9a9a') && kustom.includes('#fbfbfb 0%, #f3f4f6 60%'));

  check('tidak ada template literal yang bocor', !css.includes('${') && !kustom.includes('${'));
}

// ---------------------------------------------------------------------------
// 2. Cakupan statis: setiap fungsi cetak memanggil helper
// ---------------------------------------------------------------------------
console.log('\n-- 2. Cakupan seluruh fungsi cetak --');
{
  // Ambil isi fungsi dengan mencocokkan kurung kurawal.
  const badanFungsi = nama => {
    const mulai = sumber.indexOf(`function ${nama}(`);
    if (mulai < 0) return null;
    const buka = sumber.indexOf('{', mulai);
    let dalam = 0;
    for (let i = buka; i < sumber.length; i++) {
      if (sumber[i] === '{') dalam++;
      else if (sumber[i] === '}' && --dalam === 0) return sumber.slice(buka, i + 1);
    }
    return null;
  };

  const wajib = {
    cetakRekapKehadiranGuru: "cssBayanganKepalaTabel('table.data-kehadiran th'",
    cetakRekap: "cssBayanganKepalaTabel('table.data thead th'",
    cetakLegerTahunan: "cssBayanganKepalaTabel('table.leger th'",
    cetakLegerKehadiranTahunan: "cssBayanganKepalaTabel('table.leger th'",
    cetakSlipGaji: "cssBayanganKepalaTabel('.slip-detail-table th'",
    buatKopLaporanSiswa: "cssBayanganKepalaTabel('th'",
  };
  Object.entries(wajib).forEach(([fn, penanda]) => {
    const badan = badanFungsi(fn);
    check(`${fn} memakai bayangan kepala tabel`, !!badan && badan.includes(penanda), badan ? 'penanda tidak ditemukan' : 'fungsi tidak ada');
  });

  // Fungsi yang menumpang pada buatKopLaporanSiswa otomatis ikut terkena.
  const lewatKop = ['cetakAbsensiSaya', 'cetakLaporanTataTertib', 'cetakLaporanAbsensiSiswaPeriode',
    'cetakLaporanAbsensiSiswaHarian', 'cetakLaporanAbsensiSiswaBulanan'];
  lewatKop.forEach(fn => {
    const badan = badanFungsi(fn);
    check(`${fn} lewat buatKopLaporanSiswa`, !!badan && badan.includes('buatKopLaporanSiswa('));
  });

  // cetakSemuaSlip hanya menampilkan toast, tidak mencetak tabel.
  const slip = badanFungsi('cetakSemuaSlip');
  check('cetakSemuaSlip tidak perlu bayangan (hanya toast)', !!slip && !slip.includes('<table'));

  // Jumlah titik sisip helper: 1 definisi + 6 pemakaian.
  const jumlah = (sumber.match(/cssBayanganKepalaTabel\(/g) || []).length;
  check('helper dipakai di 6 blok CSS cetak', jumlah === 7, `ditemukan ${jumlah} kemunculan (harus 7)`);
}

// ---------------------------------------------------------------------------
// 3. Render nyata: bayangan benar-benar menang cascade
// ---------------------------------------------------------------------------
console.log('\n-- 3. Hasil render & cascade CSS --');

// Siapkan data minimal agar semua fungsi cetak bisa berjalan.
window.eval(`
  penggunaAktif = { username: 'admin', role: 'admin' };
  akunSiswaLogin = [];
  dataGuru = Array.from({ length: 6 }, (_, i) => ({
    id: 'g' + i, kode: String.fromCharCode(65 + i), nama: 'Guru Contoh ' + (i + 1),
    jabatan: 'Guru Tetap', jenisKelamin: 'L', aktif: true, honor: {},
    jadwal: { 0: 0, 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 0 }
  }));
  taSet('dataGuru_v2', dataGuru);
  dataKehadiran = []; taSet('dataKehadiran', dataKehadiran);
  hariLiburList = [];
  document.getElementById('rekapBulan').value = '10';
  document.getElementById('rekapTahun').value = '2026';
`);
await sleep(150);

// Integritas CSS: kurung kurawal harus seimbang dan tidak ada blok yatim.
// Bug yang pernah terjadi: CSS tersisip di TENGAH aturan lain sehingga
// selector-nya mustahil cocok (mis. "td.nominal table.leger th").
function periksaIntegritasCss(labelHtml, htmlCetak) {
  const gaya = [...htmlCetak.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  const buka = (gaya.match(/{/g) || []).length;
  const tutup = (gaya.match(/}/g) || []).length;
  check(`${labelHtml}: kurung kurawal CSS seimbang`, buka === tutup, `${buka} buka vs ${tutup} tutup`);
  check(`${labelHtml}: tidak ada aturan CSS terpotong`, !/}\s*\{\s*[a-z-]+\s*:/.test(gaya), 'ada pola "} { deklarasi:"');
  // Setiap aturan yang memuat gradasi harus punya selector kepala tabel yang wajar.
  const aturanGradasi = gaya.matchAll(/([^{}]+)\{[^{}]*linear-gradient[^{}]*\}/g);
  let jumlah = 0;
  for (const m of aturanGradasi) {
    jumlah++;
    const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    check(`${labelHtml}: selector gradasi masuk akal (${sel.slice(0, 40)})`, /(^|[\s,])(th|thead th)$/.test(sel) || /th$/.test(sel));
  }
  check(`${labelHtml}: ada aturan gradasi untuk kepala tabel`, jumlah >= 1, `${jumlah} aturan`);
}

// Periksa CSS hasil render: ambil style, cari aturan untuk elemen th pertama.
function periksaCascade(labelHtml, htmlCetak, selectorTh) {
  periksaIntegritasCss(labelHtml, htmlCetak);
  const d = new JSDOM(htmlCetak);
  const th = d.window.document.querySelector(selectorTh);
  if (!th) { check(`${labelHtml}: elemen ${selectorTh} ada`, false); return; }
  const cs = d.window.getComputedStyle(th);
  const tebal = parseFloat(cs.getPropertyValue('border-bottom-width') || '0');
  const warna = cs.getPropertyValue('border-bottom-color');
  const bayang = cs.getPropertyValue('box-shadow');
  const cetakWarna = cs.getPropertyValue('print-color-adjust');
  const kiri = parseFloat(cs.getPropertyValue('border-left-width') || '0');

  check(`${labelHtml}: border bawah kepala tabel menebal (${tebal}px)`, tebal >= 2, `dapat ${tebal}px`);
  check(`${labelHtml}: border bawah berwarna gelap (${warna})`, /rgb\((\d+), (\d+), (\d+)\)/.test(warna) && (() => {
    const [, r, g, b] = warna.match(/rgb\((\d+), (\d+), (\d+)\)/);
    return Number(r) < 170 && Number(g) < 170 && Number(b) < 170;
  })(), warna);
  check(`${labelHtml}: box-shadow aktif`, /rgba?\(/.test(bayang), `"${bayang}"`);
  check(`${labelHtml}: print-color-adjust exact`, cetakWarna === 'exact', `"${cetakWarna}"`);
  check(`${labelHtml}: border samping tidak ikut berubah (${kiri}px)`, kiri === 1, `dapat ${kiri}px`);
  check(`${labelHtml}: gradasi tertulis di CSS`, /linear-gradient\(to bottom/.test(htmlCetak));
}

const jalur = [
  ['Cetak Kehadiran Guru', 'cetakRekapKehadiranGuru', 'table.data-kehadiran thead th', 'printRekapArea'],
  ['Cetak Rekap Gaji', 'cetakRekap', 'table.data thead th', 'printRekapArea'],
  ['Cetak Leger Tahunan', 'cetakLegerTahunan', 'table.leger thead th', 'printRekapArea'],
  ['Leger Kehadiran Tahunan', 'cetakLegerKehadiranTahunan', 'table.leger thead th', 'printRekapArea'],
];

for (const [label, fn, selector, area] of jalur) {
  window.eval(`document.getElementById('${area}').innerHTML = ''`);
  const hasil = window.eval(`(function(){ try { ${fn}(); return 'ok'; } catch (e) { return 'ERR: ' + e.message; } })()`);
  await sleep(120);
  const isi = window.document.getElementById(area).innerHTML || '';
  check(`${label}: tercetak`, hasil === 'ok' && isi.length > 500, `${hasil} / ${isi.length} byte`);
  if (isi.length > 500) periksaCascade(label, isi, selector);
}

// Slip gaji: HTML-nya ditulis ke jendela baru (di-stub).
{
  window.eval("document.getElementById('perhitunganGajiContainer') && (document.getElementById('perhitunganGajiContainer').innerHTML = '')");
  const hasil = window.eval(`(function(){ try { cetakSlipGaji(); return 'ok'; } catch (e) { return 'ERR: ' + e.message; } })()`);
  await sleep(120);
  const isi = window.__slipHtml || '';
  check('Cetak Slip Gaji: dokumen terbentuk', hasil === 'ok' && isi.length > 500, `${hasil} / ${isi.length} byte`);
  if (isi.length > 500) periksaCascade('Cetak Slip Gaji', isi, 'thead th');
}

// Laporan siswa / tata tertib / absensi saya: lewat buatKopLaporanSiswa.
{
  const tabel = '<table><thead><tr><th>No</th><th>Nama</th></tr></thead><tbody><tr><td class="center">1</td><td>Contoh</td></tr></tbody><tfoot><tr><td colspan="2">TOTAL</td></tr></tfoot></table>';
  const isi = window.eval(`buatKopLaporanSiswa('LAPORAN CONTOH', 'Subjudul', ${JSON.stringify(tabel)}, true)`);
  check('Laporan siswa (buatKopLaporanSiswa): terbentuk', typeof isi === 'string' && isi.length > 500);
  periksaCascade('Laporan siswa', isi, 'thead th');
  check('Laporan siswa: orientasi landscape dipertahankan', /size:\s*A4 landscape/.test(isi));
}

// ---------------------------------------------------------------------------
// 4. Tidak ada regresi pada perbaikan lebar 100%
// ---------------------------------------------------------------------------
console.log('\n-- 4. Regresi lebar kolom (tidak terpotong) --');
{
  window.eval("document.getElementById('printRekapArea').innerHTML = ''");
  window.eval('cetakRekapKehadiranGuru()');
  await sleep(150);
  const isi = window.document.getElementById('printRekapArea').innerHTML || '';
  const d = new JSDOM(isi);
  const ths = [...d.window.document.querySelectorAll('table.data-kehadiran thead th')];
  const total = ths.map(th => parseFloat((th.getAttribute('style') || '').match(/width:\s*([\d.]+)%/)?.[1] || '0'))
    .reduce((a, b) => a + b, 0);
  check('total lebar kolom masih tepat 100%', Math.abs(total - 100) < 0.001, `total = ${total}%`);
  check('jumlah kolom tidak berubah', ths.length === 15, `${ths.length} kolom`);
}

console.log(`\n===== BAYANGAN KEPALA TABEL: ${pass} lolos, ${fail} gagal =====`);
process.exit(fail ? 1 : 0);
