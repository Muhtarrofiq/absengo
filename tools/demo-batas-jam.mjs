// Membuat halaman demo mandiri untuk mencoba fitur "Batas Jam Pelajaran per Hari".
// Memakai index.html ASLI, hanya menambahkan data contoh ke localStorage sebelum app jalan.
// Jalankan: node tools/demo-batas-jam.mjs [berkas-keluaran]
import fs from 'node:fs';
import path from 'node:path';

const sumber = fs.readFileSync('index.html', 'utf8');
const TA = '2026_2027';

const guruDemo = [
  { id: 'g1', kode: 'A', nama: 'Ahmad Fauzi (jadwal 10 JP)', jabatan: 'Guru Tetap', jenisKelamin: 'L', aktif: true, honor: {}, nip: '198001' },
  { id: 'g2', kode: 'B', nama: 'Siti Aminah (jadwal 8 JP)', jabatan: 'Guru Tetap', jenisKelamin: 'P', aktif: true, honor: {}, nip: '198002' },
  { id: 'g3', kode: 'C', nama: 'Budi Santoso (jadwal 6 JP)', jabatan: 'Guru Tidak Tetap', jenisKelamin: 'L', aktif: true, honor: {}, nip: '198003' },
].map((g, i) => {
  const jp = [10, 8, 6][i];
  return {
    ...g,
    jadwal: { 0: 0, 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 0 },
    jadwalHarian: { 1: jp, 2: jp, 3: jp, 4: jp, 5: jp },
    jamKeHarian: {
      1: Array.from({ length: jp }, (_, n) => n + 1),
      2: Array.from({ length: jp }, (_, n) => n + 1),
      3: Array.from({ length: jp }, (_, n) => n + 1),
      4: Array.from({ length: jp }, (_, n) => n + 1),
      5: Array.from({ length: jp }, (_, n) => n + 1),
    },
  };
});

const seed = {
  tahunAjaranList: [TA],
  tahunAjaranAktif: TA,
  akunLogin_v1: { admin: { username: 'admin', password: 'admin123', role: 'admin' }, guru: { username: 'guru', password: 'guru123', role: 'guru' } },
  sesiLogin_v1: { username: 'admin', role: 'admin' },
  pengaturan: { namaSekolah: 'MTs Contoh Absengo', alamatSekolah: 'Jl. Pendidikan No. 1, Gresik', kepalaSekolah: 'Drs. Contoh Kepala', nipKepala: '19700101 199001 1 001', nbm: '12345', nipMajelis: '' },
  [`ta_${TA}__dataGuru_v2`]: guruDemo,
  [`ta_${TA}__dataKehadiran`]: [],
  [`ta_${TA}__hariLiburList`]: [],
  [`ta_${TA}__keteranganIjinList`]: ['Alpa', 'Sakit', 'Keperluan Keluarga', 'Tugas Dinas'],
  [`ta_${TA}__masterJabatan`]: ['Guru Tetap', 'Guru Tidak Tetap'],
  kehadiranJumlahKolomGlobal: 10,
};

// Hanya menulis kunci yang belum ada, supaya localStorage pengguna tidak ditimpa.
const skripSeed = `<script>
(function () {
  try {
    var seed = ${JSON.stringify(seed)};
    Object.keys(seed).forEach(function (kunci) {
      if (localStorage.getItem(kunci) === null) {
        localStorage.setItem(kunci, typeof seed[kunci] === 'string' ? seed[kunci] : JSON.stringify(seed[kunci]));
      }
    });
  } catch (e) { /* abaikan */ }
})();
</script>`;

// Sisipkan tepat sebelum skrip data utama (yang memuat "// Data Storage").
const penanda = `    <script>
        // Data Storage`;
if (!sumber.includes(penanda)) {
  console.error('Penanda skrip utama tidak ditemukan.');
  process.exit(1);
}
// Auto-login sebagai admin setelah aplikasi selesai dimuat, agar demo bisa
// langsung dipakai tanpa mengisi form login.
const skripLogin = `<script>
document.addEventListener('DOMContentLoaded', function () {
  setTimeout(function () {
    try {
      if (typeof penggunaAktif !== 'undefined' && !penggunaAktif) {
        penggunaAktif = { username: 'admin', role: 'admin' };
        localStorage.setItem('sesiLogin_v1', JSON.stringify(penggunaAktif));
        document.getElementById('loginOverlay').classList.add('hidden');
        terapkanRoleLogin();
        showPage(halamanAwal('admin'));
        showToast('Demo: login sebagai Admin.');
      }
    } catch (e) { console.warn('auto-login demo gagal', e); }
  }, 60);
});
</script>`;

// Banner panduan (hanya ada di berkas demo, tidak menyentuh index.html).
const banner = `<div style="position:fixed;right:16px;bottom:16px;z-index:9999;max-width:290px;
  background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:12px;padding:14px 16px;
  font-family:system-ui,sans-serif;font-size:12.5px;line-height:1.55;box-shadow:0 10px 30px rgba(0,0,0,.45)">
  <div style="font-weight:700;margin-bottom:6px;font-size:13px">Demo: Batas Jam Tampil</div>
  1. Buka menu <b>Input Kehadiran</b> → <b>Input Massal Jam Ke</b><br>
  2. <b>Jumlah Kolom Jam ke-</b> sudah 10<br>
  3. Di bawahnya, isi <b>Batas Jam yang Ditampilkan = 7</b><br>
  4. Tabel langsung hanya menampilkan <b>Jam ke-1 s.d. 7</b><br>
  <span style="color:#94a3b8">Guru A 10 JP, B 8 JP, C 6 JP — semuanya terpotong di 7.</span>
</div>`;

let hasil = sumber.replace(penanda, `${skripSeed}\n${penanda}`);
// Ganti </body> TERAKHIR: index.html punya </body></html> di dalam template cetak.
const posisiBody = hasil.lastIndexOf('</body>');
hasil = hasil.slice(0, posisiBody) + skripLogin + '\n' + banner + '\n' + hasil.slice(posisiBody);

const keluar = path.resolve(process.argv[2] || '/home/user/demo-batas-jam.html');
fs.writeFileSync(keluar, hasil, 'utf8');
console.log(`OK -> ${keluar}`);
console.log(`   ${guruDemo.length} guru contoh (10 JP / 8 JP / 6 JP), tahun ajaran ${TA}`);
console.log(`   login: admin / admin123 — batas jam sengaja dikosongkan agar bisa Anda isi sendiri.`);
