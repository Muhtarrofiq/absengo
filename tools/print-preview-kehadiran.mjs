// Membuat pratinjau HTML persis seperti hasil "Cetak Kehadiran Guru".
// Berguna untuk mengecek tampilan cetak di browser sungguhan (Ctrl+P).
// Jalankan: npm install --no-save jsdom && node tools/print-preview-kehadiran.mjs [jumlahKategori]
import fs from 'node:fs';
import path from 'node:path';
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = await import('jsdom')); }
catch { console.error('Butuh jsdom: npm install --no-save jsdom'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const JUMLAH = Math.max(1, Math.min(14, parseInt(process.argv[2] || '4', 10)));

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
await sleep(250);

const SEMUA_KATEGORI = ['Alpa', 'Sakit', 'Keperluan Keluarga', 'Tugas Dinas', 'Izin Khusus', 'Diklat', 'Cuti',
  'Lainnya', 'Sakit Keras', 'Izin Pulang', 'Dinas Luar', 'Studi Banding', 'Haul', 'Ganti Jam'];
const daftarKategori = SEMUA_KATEGORI.slice(0, JUMLAH);

// Data contoh: 24 guru, nama panjang (kasus terburuk untuk lebar kolom).
window.eval(`
  penggunaAktif = { username: 'admin', role: 'admin' };
  akunSiswaLogin = [];
  dataGuru = Array.from({ length: 24 }, (_, i) => ({
    id: 'g' + i, kode: String.fromCharCode(65 + (i % 26)),
    nama: 'Guru Contoh Nama Panjang Nomor ' + (i + 1),
    jabatan: i % 3 === 0 ? 'Guru Tetap' : 'Guru Tidak Tetap',
    jenisKelamin: 'L', aktif: true, honor: {},
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
window.eval('cetakRekapKehadiranGuru()');
await sleep(200);

const isi = window.document.getElementById('printRekapArea').innerHTML || '';
if (!isi.trim()) { console.error('Gagal menghasilkan HTML cetak.'); process.exit(1); }

// Bungkus jadi dokumen utuh + "kertas A4" di layar agar bisa dicek tanpa dialog cetak.
const orientasi = /size:\s*A4\s+landscape/.test(isi) ? 'landscape' : 'portrait';
const dokumen = `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8">
<title>Pratinjau Cetak Kehadiran Guru (${daftarKategori.length} kategori, ${orientasi})</title>
<style>
  body { margin: 0; padding: 20px; background: #6b7280; font-family: system-ui, sans-serif; }
  .alat { max-width: 1100px; margin: 0 auto 14px; background: #fff; border-radius: 10px; padding: 14px 18px;
          display: flex; gap: 16px; align-items: center; flex-wrap: wrap; font-size: 14px; color: #111827; }
  .alat strong { font-size: 15px; }
  .alat button { padding: 9px 20px; background: #2563eb; color: #fff; border: 0; border-radius: 8px;
                 font-weight: 600; cursor: pointer; font-size: 14px; }
  .alat .info { color: #4b5563; font-size: 13px; }
  .kertas { background: #fff; margin: 0 auto; box-shadow: 0 8px 30px rgba(0,0,0,.4);
            padding: 0.8cm; box-sizing: border-box; overflow: hidden; }
  .kertas.portrait { width: 21cm; }
  .kertas.landscape { width: 29.7cm; }
  @media print {
    body { background: #fff; padding: 0; margin: 0; }
    .alat { display: none !important; }
    .kertas { box-shadow: none; padding: 0; width: auto; margin: 0; }
  }
</style></head>
<body>
  <div class="alat">
    <strong>Pratinjau Cetak Kehadiran Guru</strong>
    <span class="info">${daftarKategori.length} kategori &middot; A4 ${orientasi} &middot; kotak putih = batas kertas</span>
    <button onclick="window.print()">🖨️ Buka dialog cetak (Ctrl+P)</button>
    <span class="info">Periksa: kolom paling kanan <b>Prosentase</b> &amp; <b>Alasan Ijin</b> harus utuh di dalam kotak.</span>
  </div>
  <div class="kertas ${orientasi}">
${isi}
  </div>
</body></html>`;

const keluar = path.resolve(process.argv[3] || '/home/user/print-preview-kehadiran.html');
fs.writeFileSync(keluar, dokumen, 'utf8');
console.log(`OK -> ${keluar}`);
console.log(`   kategori: ${daftarKategori.length}, orientasi: ${orientasi}, ukuran: ${(dokumen.length / 1024).toFixed(1)} KB`);
