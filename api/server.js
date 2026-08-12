// ============================================================
//  Payroll Guru — Vercel Serverless Function (backend API)
//  Menerapkan kontrak API yang sudah dibangun di dalam index.html
//  (SERVER_MODE): state/get, state/save, auth/login, auth/me,
//  auth/logout, auth/update-accounts.
//
//  Backend: Supabase Postgres (via REST, tanpa dependency npm).
//  Env vars yang harus diset di Vercel:
//    SUPABASE_URL             = https://xxxx.supabase.co
//    SUPABASE_SERVICE_ROLE_KEY = service_role key (jangan bocor)
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
async function getSessionUser(token) {
  if (!token) return null;
  const rows = await SB.select(
    'auth_sessions',
    `select=username,role,expires_at&token=eq.${encodeURIComponent(token)}`
  );
  if (!rows || rows.length === 0) return null;
  const s = rows[0];
  if (new Date(s.expires_at).getTime() < Date.now()) return null;
  return { username: s.username, role: s.role };
}
function requireAuth(req) {
  // throws jika tidak ada sesi valid
}
async function requireRole(req, role) {
  const user = await getSessionUser(extractToken(req));
  if (!user) throw new ApiError(401, 'Sesi tidak valid. Silakan login kembali.');
  if (role && user.role !== role) throw new ApiError(403, 'Anda tidak berwenang melakukan aksi ini.');
  return user;
}

// ---- Handlers ----
async function getState(req) {
  await requireRole(req, null);
  const rows = await SB.select('app_state', 'select=version,state&id=eq.1');
  if (!rows || rows.length === 0) return { ok: true, state: null, version: 0 };
  return { ok: true, state: rows[0].state, version: Number(rows[0].version) || 0 };
}

async function saveState(req, body) {
  await requireRole(req, null);
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
    `select=username,password_hash,role&username=eq.${encodeURIComponent(username)}`
  );
  if (!rows || rows.length === 0 || !verifyPassword(password, rows[0].password_hash)) {
    throw new ApiError(401, 'Username atau password tidak sesuai.');
  }
  const user = { username: rows[0].username, role: rows[0].role };
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await SB.insert('auth_sessions', {
    token,
    username: user.username,
    role: user.role,
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
    const status = err.status || 500;
    json(res, status, { ok: false, message: err.message || 'Terjadi kesalahan server.' });
  }
}
