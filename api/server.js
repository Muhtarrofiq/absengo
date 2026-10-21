// ============================================================
//  Payroll Guru — Vercel Serverless Function (backend API)
//  Menerapkan kontrak API yang sudah dibangun di dalam index.html
//  (SERVER_MODE): state/get, state/save, auth/login, auth/me,
//  auth/logout, auth/update-accounts, auth/siswa-accounts.
//
//  Backend: Supabase Postgres (via REST, tanpa dependency npm).
//  Env vars yang harus diset di Vercel:
//    SUPABASE_URL             = https://xxxx.supabase.co
//    SUPABASE_SERVICE_ROLE_KEY = service_role key (jangan bocor)
//
//  Kontrol akses SISWA:
//    Akun ber-role 'siswa' terikat pada satu kelas (dan satu siswa).
//    Saat meminta state, server hanya mengirim potongan snapshot yang
//    relevan: data siswa, absensi, dan pelanggaran sesuai cakupan
//    ('sendiri' / 'kelas'). Siswa tidak dapat menyimpan state (read-only).
// ============================================================

import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://erwqapyghnbxznkijnnm.supabase.co';
// Kredensial: diambil dari env Vercel; jika belum di-set, pakai fallback agar
// langsung jalan tanpa seting. Berjalan di sisi server (tidak dikirim ke browser),
// namun simpan repo ini privat agar secret tidak bocor. Cara terbersih tetap env var.
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_E30e9diFRat08kkghXalYQ_avhIWbOr';

const SESSION_DAYS = 30;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---- Supabase REST helpers (tidak butuh paket eksternal) ----
const SB = {
  headers(method = 'GET') {
    return {
      method,
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      ...(method === 'POST' || method === 'PATCH'
        ? { 'Content-Type': 'application/json' }
        : {}),
    };
  },
  async rpc(name, body) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: this.headers('POST'),
      body: JSON.stringify(body || {}),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok) throw new ApiError(500, `Supabase RPC gagal (${res.status}): ${text}`);
    return data;
  },
  async select(table, query) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: this.headers('GET'),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok) throw new ApiError(500, `Supabase select gagal (${res.status}): ${text}`);
    return data;
  },
  async insert(table, body) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: this.headers('POST'),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(500, `Supabase insert gagal (${res.status}): ${text}`);
    }
  },
  async update(table, query, body) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      method: 'PATCH',
      headers: this.headers('PATCH'),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(500, `Supabase update gagal (${res.status}): ${text}`);
    }
  },
  // INSERT ... ON CONFLICT (dipakai untuk menyimpan akun siswa secara massal).
  async upsert(table, query, body) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      method: 'POST',
      headers: { ...this.headers('POST'), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(500, `Supabase upsert gagal (${res.status}): ${text}`);
    }
  },
  async remove(table, query) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      method: 'DELETE',
      headers: this.headers('DELETE'),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(500, `Supabase delete gagal (${res.status}): ${text}`);
    }
  },
};

// ---- Password (scrypt) ----
function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [algo, saltB64, hashB64] = String(stored || '').split('$');
    if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = scryptSync(pw, Buffer.from(saltB64, 'base64'), expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ---- Token / auth ----
function extractToken(req) {
  const auth = req.headers?.authorization || req.headers?.Authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return '';
}
// Bentuk user yang dikirim ke browser (tidak pernah memuat password_hash).
function mapUser(row) {
  return {
    username: String(row?.username || ''),
    role: String(row?.role || ''),
    nama: String(row?.nama || ''),
    kelas: String(row?.kelas || ''),
    siswaId: String(row?.siswa_id ?? row?.siswaId ?? ''),
    akses: row?.akses === 'kelas' ? 'kelas' : 'sendiri',
  };
}
async function getSessionUser(token) {
  if (!token) return null;
  const rows = await SB.select(
    'auth_sessions',
    `select=*&token=eq.${encodeURIComponent(token)}`
  );
  if (!rows || rows.length === 0) return null;
  const s = rows[0];
  if (new Date(s.expires_at).getTime() < Date.now()) return null;
  return mapUser(s);
}
async function requireRole(req, roles) {
  const user = await getSessionUser(extractToken(req));
  if (!user) throw new ApiError(401, 'Sesi tidak valid. Silakan login kembali.');
  const allowed = roles === null || roles === undefined
    ? null
    : (Array.isArray(roles) ? roles : [roles]);
  if (allowed && !allowed.includes(user.role)) {
    throw new ApiError(403, 'Anda tidak berwenang melakukan aksi ini.');
  }
  return user;
}
// Saran yang jelas bila database belum dimigrasikan ke skema siswa.
function withSchemaHint(err) {
  const pesan = String(err?.message || '');
  if (/column .* does not exist|could not find the .* column|schema cache|undefined column/i.test(pesan)) {
    return new ApiError(500, 'Skema database belum diperbarui. Jalankan ulang file supabase/schema.sql di Supabase.');
  }
  return err;
}

// ---- Filter state untuk akun SISWA ----
// Snapshot aplikasi menyimpan SEMUA data sekolah dalam satu nilai. Akun siswa
// tidak boleh menerima data guru/honor/penggajian maupun kelas lain, jadi
// potongan yang dikirim dibatasi di sini (bukan hanya disembunyikan di UI).
const SISWA_STATE_GLOBAL = [
  'tahunAjaranList',
  'tahunAjaranAktif',
  'tahunAjaranKeterangan',
  'pengaturan',
  'tataTertibSiswa_v1',
];
const SISWA_SUFFIX_SISWA = '__dataSiswa_v1';
const SISWA_SUFFIX_ABSENSI = '__dataAbsensiSiswa_v1';
const SISWA_SUFFIX_PELANGGARAN = '__pelanggaranSiswa_v1';

function parseStateArray(raw) {
  try {
    const nilai = JSON.parse(raw);
    return Array.isArray(nilai) ? nilai : null;
  } catch (_) {
    return null;
  }
}

// Cari data siswa milik akun pada tahun ajaran aktif. Dipakai agar
// perpindahan kelas / perubahan NIS otomatis mengikuti data terbaru.
function cariSiswaDiState(state, user) {
  const sumber = state && typeof state === 'object' ? state : {};
  const kode = String(sumber.tahunAjaranAktif || 'default')
    .replace(/[^0-9_/]/g, '_')
    .replace(/\//g, '_');
  const list = parseStateArray(sumber[`ta_${kode}__dataSiswa_v1`]) || [];
  const siswaId = String(user.siswaId || '').trim();
  const username = String(user.username || '').trim();
  return list.find(siswa =>
    (siswaId && String(siswa?.id || '') === siswaId) ||
    (username && String(siswa?.nisn || '') === username)
  ) || null;
}

function filterStateUntukSiswa(state, user) {
  const sumber = state && typeof state === 'object' ? state : {};
  const hasil = {};
  for (const key of SISWA_STATE_GLOBAL) {
    if (sumber[key] !== undefined) hasil[key] = sumber[key];
  }

  const kelas = String(user.kelas || '').trim();
  const siswaId = String(user.siswaId || '').trim();
  const nisn = String(user.username || '').trim();
  const aksesKelas = user.akses === 'kelas';

  const cocokSiswa = (siswa) => {
    if (!siswa || typeof siswa !== 'object') return false;
    if (siswaId && String(siswa.id || '') === siswaId) return true;
    return !siswaId && !!nisn && String(siswa.nisn || '') === nisn;
  };
  const cocokKelas = (siswa) => String(siswa?.kelas || '').trim() === kelas;
  const cocokDataSiswa = (siswa) => (aksesKelas ? cocokKelas(siswa) : cocokSiswa(siswa));

  for (const [key, raw] of Object.entries(sumber)) {
    if (!key.startsWith('ta_')) continue;

    if (key.endsWith(SISWA_SUFFIX_SISWA)) {
      const list = parseStateArray(raw);
      if (!list) continue;
      hasil[key] = JSON.stringify(list.filter(cocokDataSiswa));
      continue;
    }

    if (key.endsWith(SISWA_SUFFIX_ABSENSI)) {
      const list = parseStateArray(raw);
      if (!list) continue;
      const prefixSiswa = key.slice(0, key.length - SISWA_SUFFIX_ABSENSI.length);
      const siswaList = parseStateArray(sumber[prefixSiswa + SISWA_SUFFIX_SISWA]) || [];
      const idDiizinkan = new Set(
        siswaList.filter(cocokDataSiswa).map(siswa => String(siswa.id || ''))
      );
      // Tetap izinkan id siswa pemilik akun meski datanya belum tersinkron.
      if (siswaId) idDiizinkan.add(siswaId);
      hasil[key] = JSON.stringify(
        list.filter(absen => idDiizinkan.has(String(absen?.siswaId || '')))
      );
      continue;
    }

    if (key.endsWith(SISWA_SUFFIX_PELANGGARAN)) {
      const list = parseStateArray(raw);
      if (!list) continue;
      hasil[key] = JSON.stringify(list.filter(item => {
        if (aksesKelas) return String(item?.kelas || '').trim() === kelas;
        if (siswaId && String(item?.siswaId || '') === siswaId) return true;
        return !!nisn && String(item?.nisn || '') === nisn;
      }));
    }
  }

  return hasil;
}

// ---- Handlers ----
async function getState(req) {
  const user = await requireRole(req, null);
  const rows = await SB.select('app_state', 'select=version,state&id=eq.1');
  const scope = user.role === 'siswa' ? 'siswa' : 'all';
  if (!rows || rows.length === 0) return { ok: true, state: null, version: 0, scope };
  if (user.role === 'siswa') {
    // Kelas mengikuti data siswa terbaru, bukan hanya nilai saat login.
    const siswa = cariSiswaDiState(rows[0].state, user);
    if (siswa) {
      user.siswaId = String(siswa.id || user.siswaId || '');
      user.kelas = String(siswa.kelas || user.kelas || '');
      user.nama = String(siswa.nama || user.nama || '');
    }
    return {
      ok: true,
      state: filterStateUntukSiswa(rows[0].state, user),
      version: Number(rows[0].version) || 0,
      scope,
      profile: { nama: user.nama, kelas: user.kelas, siswaId: user.siswaId, akses: user.akses },
    };
  }
  return { ok: true, state: rows[0].state, version: Number(rows[0].version) || 0, scope };
}

async function saveState(req, body) {
  const user = await requireRole(req, null);
  if (user.role === 'siswa') {
    throw new ApiError(403, 'Akun siswa hanya dapat melihat data, tidak dapat mengubahnya.');
  }
  const state = body?.state;
  if (state === undefined || state === null) throw new ApiError(400, 'State wajib dikirim.');
  const version = Number(body?.version) || 0;
  const force = !!body?.force;
  const result = await SB.rpc('app_save_state', {
    p_version: version,
    p_state: state,
    p_force: force,
  });
  if (result && result.ok === false && result.code === 'conflict') {
    throw new ApiError(409, 'Ada perubahan dari perangkat lain.');
  }
  if (!result || result.ok !== true) {
    throw new ApiError(500, 'Gagal menyimpan state.');
  }
  return { ok: true, version: Number(result.version) };
}

async function login(body) {
  const username = String(body?.username || '').trim();
  const password = String(body?.password || '');
  if (!username || !password) throw new ApiError(400, 'Username dan password wajib diisi.');
  const rows = await SB.select(
    'auth_users',
    `select=*&username=eq.${encodeURIComponent(username)}`
  );
  if (!rows || rows.length === 0 || !verifyPassword(password, rows[0].password_hash)) {
    throw new ApiError(401, 'Username atau password tidak sesuai.');
  }
  const user = mapUser(rows[0]);
  if (user.role === 'siswa') {
    // Sinkronkan kelas/nama dengan data siswa terbaru (mis. siswa pindah kelas).
    try {
      const stateRows = await SB.select('app_state', 'select=state&id=eq.1');
      const siswa = stateRows && stateRows[0] ? cariSiswaDiState(stateRows[0].state, user) : null;
      if (siswa) {
        const kelasBaru = String(siswa.kelas || user.kelas || '');
        const namaBaru = String(siswa.nama || user.nama || '');
        const siswaIdBaru = String(siswa.id || user.siswaId || '');
        if (kelasBaru !== user.kelas || namaBaru !== user.nama || siswaIdBaru !== user.siswaId) {
          user.kelas = kelasBaru;
          user.nama = namaBaru;
          user.siswaId = siswaIdBaru;
          try {
            await SB.update(
              'auth_users',
              `username=eq.${encodeURIComponent(user.username)}&role=eq.siswa`,
              { kelas: user.kelas, nama: user.nama, siswa_id: user.siswaId || null }
            );
          } catch (_) {
            // Bila sinkronisasi gagal, login tetap memakai data terbaru dari state.
          }
        }
      }
    } catch (_) {
      // Abaikan: kelas dari akun tetap dipakai.
    }
  }
  if (user.role === 'siswa' && !user.kelas.trim()) {
    throw new ApiError(403, 'Akun siswa belum dihubungkan ke kelas. Hubungi admin sekolah.');
  }
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await SB.insert('auth_sessions', {
    token,
    username: user.username,
    role: user.role,
    nama: user.nama,
    kelas: user.kelas,
    siswa_id: user.siswaId,
    akses: user.akses,
    created_at: new Date().toISOString(),
    expires_at: expires,
  });
  return { ok: true, token, user };
}

async function me(req) {
  const user = await requireRole(req, null);
  return { ok: true, user };
}

async function logout(req) {
  const token = extractToken(req);
  if (token) {
    try { await SB.remove('auth_sessions', `token=eq.${encodeURIComponent(token)}`); } catch (_) {}
  }
  return { ok: true };
}

async function updateAccounts(req, body) {
  const user = await requireRole(req, 'admin');
  const accounts = body?.accounts;
  if (!accounts || !accounts.admin || !accounts.guru) {
    throw new ApiError(400, 'Format akun tidak valid.');
  }
  const list = [
    { role: 'admin', data: accounts.admin },
    { role: 'guru', data: accounts.guru },
  ];
  for (const { role, data } of list) {
    const username = String(data.username || '').trim();
    const password = String(data.password || '');
    if (!username || !password) throw new ApiError(400, `Username/password ${role} wajib diisi.`);
    const fields = { username };
    if (!String(data.password).startsWith('scrypt$')) {
      // Update password hanya jika bukan hash (frontend mengirim plaintext)
      fields.password_hash = hashPassword(password);
    } else {
      fields.password_hash = password;
    }
    await SB.update('auth_users', `role=eq.${encodeURIComponent(role)}`, fields);
  }
  return { ok: true, message: 'Akun login diperbarui.' };
}

// ---- Akun login SISWA (per kelas) ----
const USERNAME_SISWA_VALID = /^[A-Za-z0-9._-]{3,60}$/;

async function listSiswaAccountsRows() {
  const rows = await SB.select(
    'auth_users',
    'select=username,nama,kelas,siswa_id,akses&role=eq.siswa&order=kelas.asc,nama.asc&limit=5000'
  );
  return (rows || []).map(row => ({
    username: String(row.username || ''),
    nama: String(row.nama || ''),
    kelas: String(row.kelas || ''),
    siswaId: String(row.siswa_id || ''),
    akses: row.akses === 'kelas' ? 'kelas' : 'sendiri',
  }));
}

async function listSiswaAccounts(req) {
  await requireRole(req, 'admin');
  return { ok: true, accounts: await listSiswaAccountsRows() };
}

async function revokeSessions(username) {
  try {
    await SB.remove('auth_sessions', `username=eq.${encodeURIComponent(username)}`);
  } catch (_) {
    // Sesi kedaluwarsa dengan sendirinya; kegagalan revoke tidak fatal.
  }
}

async function saveSiswaAccounts(req, body) {
  await requireRole(req, 'admin');
  const input = body?.accounts;
  if (!Array.isArray(input)) {
    throw new ApiError(400, 'Format akun siswa tidak valid (accounts harus array).');
  }
  if (input.length > 2000) {
    throw new ApiError(400, 'Terlalu banyak akun siswa dalam satu permintaan (maks. 2000).');
  }

  const desired = new Map();
  const siswaIdDipakai = new Map();
  for (const raw of input) {
    const username = String(raw?.username || '').trim();
    const kelas = String(raw?.kelas || '').trim();
    const nama = String(raw?.nama || '').trim();
    const siswaId = String(raw?.siswaId ?? raw?.siswa_id ?? '').trim();
    const akses = raw?.akses === 'kelas' ? 'kelas' : 'sendiri';
    const password = raw?.password === undefined || raw?.password === null
      ? ''
      : String(raw.password);
    if (!username) throw new ApiError(400, 'Username/NIS siswa wajib diisi.');
    if (!USERNAME_SISWA_VALID.test(username)) {
      throw new ApiError(400, `Username "${username}" tidak valid (3-60 karakter: huruf, angka, titik, garis bawah, atau minus).`);
    }
    if (!kelas) throw new ApiError(400, `Kelas untuk akun ${username} wajib diisi.`);
    const kunci = username.toLowerCase();
    if (desired.has(kunci)) throw new ApiError(400, `Username "${username}" duplikat dalam daftar.`);
    if (siswaId) {
      if (siswaIdDipakai.has(siswaId)) {
        throw new ApiError(400, 'Satu siswa hanya boleh memiliki satu akun login.');
      }
      siswaIdDipakai.set(siswaId, username);
    }
    desired.set(kunci, { username, kelas, nama, siswaId, akses, password });
  }

  const existing = await SB.select(
    'auth_users',
    'select=username,role,password_hash,siswa_id,kelas,nama&limit=5000'
  );
  const semuaAkun = existing || [];
  const perUsername = new Map(semuaAkun.map(row => [String(row.username).toLowerCase(), row]));
  const akunSiswaLama = semuaAkun.filter(row => row.role === 'siswa');

  // Jangan pernah menimpa akun admin/guru yang sudah ada.
  for (const item of desired.values()) {
    const row = perUsername.get(item.username.toLowerCase());
    if (row && row.role !== 'siswa') {
      throw new ApiError(400, `Username "${item.username}" sudah dipakai akun ${row.role}.`);
    }
  }

  // Hapus akun siswa yang tidak ada lagi di daftar (termasuk sesi loginnya).
  for (const row of akunSiswaLama) {
    if (!desired.has(String(row.username).toLowerCase())) {
      await SB.remove('auth_users', `username=eq.${encodeURIComponent(row.username)}&role=eq.siswa`);
      await revokeSessions(row.username);
    }
  }

  const perluCabutSesi = [];
  const diproses = new Set();
  for (const item of desired.values()) {
    const row = perUsername.get(item.username.toLowerCase());

    // Bila siswa pindah NISN/username, akun lama dengan siswa_id sama dihapus
    // lebih dulu agar tidak melanggar indeks unik auth_users_siswa_id_key.
    if (item.siswaId) {
      const bentrok = akunSiswaLama.find(lama =>
        String(lama.siswa_id || '') === item.siswaId &&
        String(lama.username).toLowerCase() !== item.username.toLowerCase() &&
        !diproses.has(String(lama.username).toLowerCase())
      );
      if (bentrok) {
        diproses.add(String(bentrok.username).toLowerCase());
        await SB.remove('auth_users', `username=eq.${encodeURIComponent(bentrok.username)}&role=eq.siswa`);
        await revokeSessions(bentrok.username);
      }
    }

    const fields = {
      username: item.username,
      role: 'siswa',
      nama: item.nama,
      kelas: item.kelas,
      siswa_id: item.siswaId || null,
      akses: item.akses,
    };
    let passwordBerubah = false;
    if (item.password) {
      fields.password_hash = item.password.startsWith('scrypt$')
        ? item.password
        : hashPassword(item.password);
      passwordBerubah = true;
    } else if (row && row.password_hash) {
      fields.password_hash = row.password_hash;
    } else {
      // Akun baru tanpa password eksplisit: password awal = username (NIS/NISN).
      fields.password_hash = hashPassword(item.username);
      passwordBerubah = true;
    }
    await SB.upsert('auth_users', 'on_conflict=username', fields);
    if (passwordBerubah) perluCabutSesi.push(item.username);
  }

  // Password berubah -> sesi lama siswa tersebut tidak berlaku lagi.
  for (const username of perluCabutSesi) await revokeSessions(username);

  return {
    ok: true,
    accounts: await listSiswaAccountsRows(),
    message: 'Akun siswa diperbarui.',
  };
}

// ---- Router ----
async function dispatch(route, req) {
  const method = (req.method || 'GET').toUpperCase();
  let body = {};
  if (req.body && typeof req.body === 'object') body = req.body;
  else if (req.body && typeof req.body === 'string') {
    try { body = JSON.parse(req.body); } catch (_) {}
  }

  switch (route) {
    case 'state/get': return getState(req);
    case 'state/save':
      if (method !== 'PUT' && method !== 'POST') throw new ApiError(405, 'Method tidak didukung.');
      return saveState(req, body);
    case 'auth/login':
      if (method !== 'POST') throw new ApiError(405, 'Method tidak didukung.');
      return login(body);
    case 'auth/me': return me(req);
    case 'auth/logout': return logout(req);
    case 'auth/update-accounts':
      if (method !== 'POST') throw new ApiError(405, 'Method tidak didukung.');
      return updateAccounts(req, body);
    case 'auth/siswa-accounts':
      if (method === 'GET') return listSiswaAccounts(req);
      if (method === 'POST') return saveSiswaAccounts(req, body);
      throw new ApiError(405, 'Method tidak didukung.');
    default:
      throw new ApiError(404, `Route tidak dikenal: ${route}`);
  }
}

function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json').send(JSON.stringify(payload));
}

// ---- Entry point (Vercel) ----
export default async function handler(req, res) {
  // CORS (berguna jika app diakses dari origin lain / saat dev)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    json(res, 500, { ok: false, message: 'Backend belum dikonfigurasi. Set env SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY di Vercel.' });
    return;
  }

  const route = String(req.query?.route || '');
  try {
    const result = await dispatch(route, req);
    json(res, 200, result);
  } catch (err) {
    const error = withSchemaHint(err);
    const status = error.status || 500;
    json(res, status, { ok: false, message: error.message || 'Terjadi kesalahan server.' });
  }
}
