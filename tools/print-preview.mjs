// Membuat pratinjau HTML untuk SEMUA tampilan cetak (untuk cek kepala kolom tabel).
// Jalankan: npm install --no-save jsdom && node tools/print-preview.mjs [berkas-keluaran]
import fs from 'node:fs';
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = await import('jsdom')); }
catch { console.error('Butuh jsdom: npm install --no-save jsdom'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const html = fs.readFileSync('index.html', 'utf8')
  .replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g, '')
  .replace(/<link[^>]+href="[^"]+"[^>]*>/g, '');

const vc = new VirtualConsole();
vc.on('jsdomError', () => {});
const dom = new JSDOM(html, { url: 'http://localhost/?local', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
window.print = () => {};
window.alert = () => {};
window.confirm = () => true;
window.open = () => ({ document: { write: isi => { window.__slip = isi; }, close: () => {} }, focus: () => {}, print: () => {}, close: () => {} });

await sleep(300);
window.eval(`
  penggunaAktif = { username: 'admin', role: 'admin' };
  akunSiswaLogin = [];
  dataGuru = Array.from({ length: 12 }, (_, i) => ({
    id: 'g' + i, kode: String.fromCharCode(65 + i), nama: 'Guru Contoh Nama Panjang ' + (i + 1),
    jabatan: i % 3 === 0 ? 'Guru Tetap' : 'Guru Tidak Tetap', jenisKelamin: 'L', aktif: true, honor: {},
    jadwal: { 0: 0, 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 0 }
  }));
  taSet('dataGuru_v2', dataGuru);
  dataKehadiran = []; taSet('dataKehadiran', dataKehadiran);
  hariLiburList = [];
  taSet('keteranganIjinList', ['Alpa', 'Sakit', 'Keperluan Keluarga', 'Tugas Dinas']);
  document.getElementById('rekapBulan').value = '10';
  document.getElementById('rekapTahun').value = '2026';
`);
await sleep(150);

const ambil = (fn, area = 'printRekapArea') => {
  try {
    window.eval(`document.getElementById('${area}').innerHTML = ''`);
    window.eval(`${fn}()`);
    return window.document.getElementById(area).innerHTML || '';
  } catch (e) { return ''; }
};

const contohTabel = `<table><thead><tr>
    <th>No</th><th>NIS/NISN</th><th>Nama Siswa</th><th>Kelas</th><th>Jml Hadir</th><th>Status</th>
  </tr></thead><tbody>${Array.from({ length: 8 }, (_, i) =>
    `<tr><td class="center">${i + 1}</td><td>00${i + 1}</td><td>Ahmad Fauzi Contoh Nama Panjang ${i + 1}</td>` +
    `<td class="center">7A</td><td class="center">${20 + i}</td><td class="center">Hadir</td></tr>`).join('')}
  </tbody><tfoot><tr><td colspan="4" class="right">TOTAL</td><td class="center">196</td><td class="center">&nbsp;</td></tr></tfoot></table>`;

const daftar = [];
const tambah = (nama, isi, catatan) => { if (isi && isi.trim().length > 200) daftar.push({ nama, isi, catatan }); };

tambah('Cetak Kehadiran Guru', ambil('cetakRekapKehadiranGuru'), 'Tabel terlebar — cek kolom Prosentase & Alasan Ijin tetap utuh.');
tambah('Cetak Rekap Gaji', ambil('cetakRekap'), 'Tabel gaji bulanan (landscape).');
tambah('Cetak Leger Tahunan', ambil('cetakLegerTahunan'), 'Banyak kolom bulan, font kecil 6.4pt.');
tambah('Leger Kehadiran Tahunan', ambil('cetakLegerKehadiranTahunan'), 'Sama, kolom prosentase tahunan.');
{
  const isi = ambil('cetakSlipGaji');
  const slip = window.__slip || isi;
  tambah('Cetak Slip Gaji', slip, 'Tabel kecil "Komponen / Jumlah" di dalam kartu slip.');
}
tambah('Laporan Siswa / Tata Tertib',
  window.eval(`buatKopLaporanSiswa('LAPORAN ABSENSI SISWA', 'Tanggal: 3 November 2026 | Kelas: 7A', ${JSON.stringify(contohTabel)}, true)`),
  'Dipakai juga oleh Absensi Saya & Laporan Tata Tertib.');

if (!daftar.length) { console.error('Tidak ada tampilan cetak yang berhasil dibuat.'); process.exit(1); }

const bungkus = (isi) => `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: #fff; }
  body { padding: 1.2cm; box-sizing: border-box; font-family: 'Times New Roman', Times, serif; }
</style></head><body>${isi}</body></html>`;

const halaman = `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8">
<title>Pratinjau Cetak — Kepala Kolom Tabel Berbayang</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; }
  header { padding: 16px 20px 12px; }
  h1 { margin: 0 0 4px; font-size: 17px; }
  .sub { margin: 0; font-size: 13px; color: #94a3b8; }
  .bar { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 20px 14px; }
  .bar button { padding: 8px 14px; border: 1px solid #334155; background: #1e293b; color: #cbd5e1;
                border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 500; }
  .bar button:hover { background: #273449; }
  .bar button.aktif { background: #2563eb; border-color: #3b82f6; color: #fff; }
  .alat { display: flex; gap: 18px; align-items: center; padding: 0 20px 12px; font-size: 13px; color: #94a3b8; flex-wrap: wrap; }
  .alat input[type=range] { width: 190px; vertical-align: middle; }
  .alat strong { color: #e2e8f0; font-weight: 600; }
  .bingkai { margin: 0 20px 24px; background: #1e293b; border: 1px solid #334155;
             border-radius: 12px; padding: 14px; overflow: auto; }
  iframe { display: block; margin: 0 auto; background: #fff; border: 0; width: 100%;
           box-shadow: 0 10px 34px rgba(0,0,0,.55); }
  .catatan { font-size: 12.5px; color: #94a3b8; padding: 0 20px 20px; line-height: 1.6; }
  .catatan b { color: #e2e8f0; }
  kbd { background: #334155; border-radius: 4px; padding: 1px 5px; font-size: 11.5px; }
</style></head>
<body>
  <header>
    <h1>Pratinjau Cetak — Kepala Kolom Tabel Berbayang</h1>
    <p class="sub">Ini HTML asli hasil fungsi cetak aplikasi, bukan tiruan. Pilih tampilan, lalu perhatikan kepala tabel.</p>
  </header>
  <div class="bar" id="bar"></div>
  <div class="alat">
    <span>Perbesaran: <strong id="labelZoom">100%</strong></span>
    <input type="range" id="zoom" min="50" max="220" value="100" step="5">
    <span id="catatan"></span>
  </div>
  <div class="bingkai"><iframe id="kanvas"></iframe></div>
  <div class="catatan">
    <b>Cara memastikan bayangan ikut tercetak:</b> tekan <kbd>Ctrl</kbd>+<kbd>P</kbd> di dalam pratinjau,
    lalu di Chrome centang <b>More settings → Background graphics</b>. Kalau opsi itu <i>tidak</i> dicentang,
    bayangan gradasi &amp; box-shadow dibuang browser — <b>tetapi garis bawah kepala tabel yang tebal tetap tercetak</b>,
    itulah lapisan pengaman yang membuat kepala kolom tetap terlihat timbul di kertas hitam-putih.
  </div>
<script>
  const DATA = ${JSON.stringify(daftar)};
  const kanvas = document.getElementById('kanvas');
  const bar = document.getElementById('bar');
  const labelZoom = document.getElementById('labelZoom');
  const catatan = document.getElementById('catatan');
  const zoom = document.getElementById('zoom');

  function ukuranKertas(isi) {
    if (/size:\\s*A4 landscape/.test(isi)) return { w: 1123, h: 794 };
    if (/size:\\s*A4 portrait/.test(isi)) return { w: 794, h: 1123 };
    return { w: 794, h: 1123 };
  }

  function tampilkan(i) {
    const d = DATA[i];
    const k = ukuranKertas(d.isi);
    kanvas.srcdoc = d.isi;
    kanvas.style.width = k.w + 'px';
    kanvas.style.height = k.h + 'px';
    catatan.textContent = d.catatan;
    [...bar.children].forEach((b, j) => b.classList.toggle('aktif', j === i));
    terapkanZoom();
  }

  function terapkanZoom() {
    const s = zoom.value / 100;
    labelZoom.textContent = zoom.value + '%';
    kanvas.style.transform = 'scale(' + s + ')';
    kanvas.style.transformOrigin = 'top center';
    kanvas.style.marginBottom = (kanvas.offsetHeight * (s - 1)) + 'px';
  }

  DATA.forEach((d, i) => {
    const b = document.createElement('button');
    b.textContent = d.nama;
    b.onclick = () => tampilkan(i);
    bar.appendChild(b);
  });
  zoom.oninput = terapkanZoom;
  tampilkan(0);
</script>
</body></html>`;

// Jika diminta berkas tunggal per tampilan, tulis juga versi terpisah.
const keluar = process.argv[2] || '/home/user/print-preview.html';
fs.writeFileSync(keluar, halaman, 'utf8');
console.log(`OK -> ${keluar}`);
console.log(`   ${daftar.length} tampilan cetak: ${daftar.map(d => d.nama).join(', ')}`);
console.log(`   ukuran: ${(halaman.length / 1024).toFixed(1)} KB`);
