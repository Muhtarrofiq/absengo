// Mock Supabase REST backend untuk pengujian lokal server.js.
// Menerapkan endpoint yang dipakai server.js:
//   POST /rest/v1/rpc/app_save_state
//   GET  /rest/v1/app_state  (id=eq.1)
//   GET  /rest/v1/auth_users (username=eq.X)
//   POST /rest/v1/auth_sessions
//   DELETE /rest/v1/auth_sessions (token=eq.X)
//   PATCH /rest/v1/auth_users (role=eq.X)
import http from 'node:http';

// Data in-memory
const appState = []; // {id:1, version, state}
const authUsers = [
  { id: 1, username: 'admin', password_hash: 'scrypt$iZ2rfwhTNVnAcXFfJWICOQ==$Z1nACicQwLt6mjRR9+VXUteVCqZWRER38iar9htFowTdvkkMZO8ZeFZgfRIOF+QtP+iduG+cipy5GFVtygT2Uw==', role: 'admin' },
  { id: 2, username: 'guru',  password_hash: 'scrypt$nfTVeZdtyNb1OSmnJvv56w==$acAv8PVd9UOdinw3mmgTlZCuEKq1ah7q06cT2I+4q2UOVJ+ptB0pDdtu4vQJqHyM2SZDejqUz4xAKMQiTLgjLg==', role: 'guru' },
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
      if (cur) cur.version = newVersion, cur.state = p_state, cur.updated_at = new Date().toISOString();
      else appState.push({ id: 1, version: newVersion, state: p_state, updated_at: new Date().toISOString() });
      return send(200, { ok: true, version: newVersion });
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
      return send(200, rows.map(({ username, password_hash, role }) => ({ username, password_hash, role })));
    }
    // SELECT auth_sessions
    if (path === '/rest/v1/auth_sessions' && req.method === 'GET') {
      let rows = authSessions;
      if (q.token) rows = rows.filter(s => s.token === q.token);
      return send(200, rows);
    }
    // INSERT auth_sessions
    if (path === '/rest/v1/auth_sessions' && req.method === 'POST') {
      authSessions.push(body);
      return send(201, body);
    }
    // DELETE auth_sessions
    if (path === '/rest/v1/auth_sessions' && req.method === 'DELETE') {
      if (q.token) {
        const i = authSessions.findIndex(s => s.token === q.token);
        if (i >= 0) authSessions.splice(i, 1);
      }
      return send(200, []);
    }
    // UPDATE auth_users
    if (path === '/rest/v1/auth_users' && req.method === 'PATCH') {
      const row = authUsers.find(u => u.role === q.role);
      if (row) Object.assign(row, body);
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
