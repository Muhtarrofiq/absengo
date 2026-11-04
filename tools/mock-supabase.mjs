// Mock Supabase REST backend untuk pengujian lokal server.js.
// Menerapkan endpoint yang dipakai server.js:
//   POST /rest/v1/rpc/app_save_state
//   GET  /rest/v1/app_state  (id=eq.1)
//   GET  /rest/v1/auth_users (username=eq.X, role=eq.X)
//   POST /rest/v1/auth_users (upsert akun siswa, Prefer: merge-duplicates)
//   PATCH /rest/v1/auth_users (username=eq.X / role=eq.X)
//   DELETE /rest/v1/auth_users (username=eq.X)
//   GET  /rest/v1/auth_sessions (token=eq.X)
//   POST /rest/v1/auth_sessions
//   DELETE /rest/v1/auth_sessions (token=eq.X / username=eq.X)
import http from 'node:http';

// Data in-memory
const appState = []; // {id:1, version, state}
const appStateHistory = []; // riwayat: {id, version, state, keterangan, created_at}
const RIWAYAT_MAKS = 30;
let riwayatSeq = 0;
// Nilai state disimpan sebagai TEKS JSON (persis seperti localStorage),
// jadi harus di-parse dulu sebelum dihitung panjangnya.
function hitungPanjangArray(state, akhiran) {
  if (!state || typeof state !== 'object') return 0;
  return Object.keys(state).filter(k => k.endsWith(akhiran)).reduce((total, k) => {
    let nilai = state[k];
    if (typeof nilai === 'string') {
      try { nilai = JSON.parse(nilai); } catch { return total; }
    }
    return total + (Array.isArray(nilai) ? nilai.length : 0);
  }, 0);
}
function catatRiwayat(version, state, keterangan) {
  if (!state) return;
  appStateHistory.unshift({
    id: ++riwayatSeq,
    version: Number(version) || 0,
    state: JSON.parse(JSON.stringify(state)),
    keterangan: keterangan || '',
    created_at: new Date().toISOString(),
  });
  while (appStateHistory.length > RIWAYAT_MAKS) appStateHistory.pop();
}
const authUsers = [
  { id: 1, username: 'admin', password_hash: 'scrypt$iZ2rfwhTNVnAcXFfJWICOQ==$Z1nACicQwLt6mjRR9+VXUteVCqZWRER38iar9htFowTdvkkMZO8ZeFZgfRIOF+QtP+iduG+cipy5GFVtygT2Uw==', role: 'admin', nama: 'Admin', kelas: null, siswa_id: null, akses: 'sendiri' },
  { id: 2, username: 'guru',  password_hash: 'scrypt$nfTVeZdtyNb1OSmnJvv56w==$acAv8PVd9UOdinw3mmgTlZCuEKq1ah7q06cT2I+4q2UOVJ+ptB0pDdtu4vQJqHyM2SZDejqUz4xAKMQiTLgjLg==', role: 'guru', nama: 'Guru', kelas: null, siswa_id: null, akses: 'sendiri' },
];
const authSessions = [];
let log = (s) => process.stdout.write('[mock] ' + s + '\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  const q0 = Object.fromEntries(url.searchParams.entries());
  // Hilangkan prefiks operator Supabase (eq. , ne. , dst) pada nilai filter
  const strip = (s) => (typeof s === 'string' ? s.replace(/^(eq|neq|lt|lte|gt|gte)\./, '') : s);
  const q = Object.fromEntries(Object.entries(q0).map(([k, v]) => [k, strip(v)]));
  const send = (code, obj, extra = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/json', ...extra });
    res.end(JSON.stringify(obj));
  };
  let body = null;
  if (req.method === 'POST' || req.method === 'PATCH') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  }
  log(`${req.method} ${path} q=${JSON.stringify(q)}`);

  try {
    // RPC app_save_state
    if (path === '/rest/v1/rpc/app_save_state') {
      const p_version = Number(body.p_version || 0);
      const p_state = body.p_state;
      const p_force = !!body.p_force;
      let cur = appState.find(r => r.id === 1);
      const curVersion = cur ? cur.version : 0;
      if (!p_force && p_version !== curVersion) {
        return send(200, { ok: false, code: 'conflict', version: curVersion });
      }
      const newVersion = curVersion + 1;
      if (cur) catatRiwayat(curVersion, cur.state, 'sebelum simpan v' + newVersion);
      if (cur) cur.version = newVersion, cur.state = p_state, cur.updated_at = new Date().toISOString();
      else appState.push({ id: 1, version: newVersion, state: p_state, updated_at: new Date().toISOString() });
      return send(200, { ok: true, version: newVersion });
    }
    // RPC app_list_history
    if (path === '/rest/v1/rpc/app_list_history') {
      const limit = Math.max(1, Math.min(Number(body?.p_limit) || 30, 100));
      const rows = appStateHistory.slice(0, limit).map(h => ({
        id: h.id,
        version: h.version,
        created_at: h.created_at,
        ukuran: Buffer.byteLength(JSON.stringify(h.state), 'utf8'),
        jumlah_siswa: hitungPanjangArray(h.state, 'dataSiswa_v1'),
        jumlah_guru: hitungPanjangArray(h.state, 'dataGuru_v2'),
        jumlah_kehadiran: hitungPanjangArray(h.state, 'dataKehadiran'),
        keterangan: h.keterangan || '',
      }));
      return send(200, rows);
    }

    // RPC app_restore_state
    if (path === '/rest/v1/rpc/app_restore_state') {
      const historyId = Number(body?.p_history_id);
      const h = appStateHistory.find(r => r.id === historyId);
      if (!h) return send(200, { ok: false, code: 'not_found' });
      let cur = appState.find(r => r.id === 1);
      const curVersion = cur ? cur.version : 0;
      const newVersion = curVersion + 1;
      if (cur) catatRiwayat(curVersion, cur.state, 'sebelum pulihkan ke v' + h.version);
      const stateBaru = JSON.parse(JSON.stringify(h.state));
      if (cur) cur.version = newVersion, cur.state = stateBaru, cur.updated_at = new Date().toISOString();
      else appState.push({ id: 1, version: newVersion, state: stateBaru, updated_at: new Date().toISOString() });
      return send(200, { ok: true, version: newVersion, dari_version: h.version });
    }

    // SELECT app_state
    if (path === '/rest/v1/app_state' && req.method === 'GET') {
      const row = appState.find(r => r.id === 1);
      return send(200, row ? [row] : []);
    }
    // SELECT auth_users
    if (path === '/rest/v1/auth_users' && req.method === 'GET') {
      let rows = authUsers;
      if (q.username) rows = rows.filter(u => u.username === q.username);
      if (q.role) rows = rows.filter(u => u.role === q.role);
      return send(200, rows);
    }
    // INSERT / UPSERT auth_users
    if (path === '/rest/v1/auth_users' && req.method === 'POST') {
      const rows = Array.isArray(body) ? body : [body];
      const merge = String(req.headers.prefer || '').includes('merge-duplicates');
      for (const row of rows) {
        const index = authUsers.findIndex(u => u.username === row.username);
        if (index >= 0) {
          if (!merge) {
            return send(409, { message: 'duplicate key value violates unique constraint "auth_users_username_key"' });
          }
          authUsers[index] = { ...authUsers[index], ...row };
        } else {
          authUsers.push({ id: authUsers.length + 1, ...row });
        }
      }
      return send(201, []);
    }
    // PATCH auth_users
    if (path === '/rest/v1/auth_users' && req.method === 'PATCH') {
      const targets = authUsers.filter(u =>
        (!q.username || u.username === q.username) && (!q.role || u.role === q.role)
      );
      targets.forEach(row => Object.assign(row, body));
      return send(200, []);
    }
    // DELETE auth_users
    if (path === '/rest/v1/auth_users' && req.method === 'DELETE') {
      for (let i = authUsers.length - 1; i >= 0; i--) {
        const u = authUsers[i];
        if ((q.username === undefined || u.username === q.username) &&
            (q.role === undefined || u.role === q.role)) {
          authUsers.splice(i, 1);
        }
      }
      return send(200, []);
    }
    // SELECT auth_sessions
    if (path === '/rest/v1/auth_sessions' && req.method === 'GET') {
      let rows = authSessions;
      if (q.token) rows = rows.filter(s => s.token === q.token);
      if (q.username) rows = rows.filter(s => s.username === q.username);
      return send(200, rows);
    }
    // INSERT auth_sessions
    if (path === '/rest/v1/auth_sessions' && req.method === 'POST') {
      authSessions.push(body);
      return send(201, body);
    }
    // DELETE auth_sessions
    if (path === '/rest/v1/auth_sessions' && req.method === 'DELETE') {
      for (let i = authSessions.length - 1; i >= 0; i--) {
        const s = authSessions[i];
        if ((q.token === undefined || s.token === q.token) &&
            (q.username === undefined || s.username === q.username)) {
          authSessions.splice(i, 1);
        }
      }
      return send(200, []);
    }
    return send(404, { message: `mock: path tidak dikenal ${path}` });
  } catch (e) {
    return send(500, { message: 'mock error: ' + e.message });
  }
});

const port = process.env.PORT || 0;
server.listen(port, () => {
  const p = server.address().port;
  process.stdout.write('MOCK_SUPABASE_PORT=' + p + '\n');
});
