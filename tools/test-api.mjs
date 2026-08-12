// Uji end-to-end kontrak API terhadap mock Supabase.
// Menjalankan mock-supabase + serve-api lalu mensimulasikan alur:
// login admin -> state kosong -> save (migrasi) -> get -> conflict -> logout.
import { spawn } from 'node:child_process';

function start(cmd, args, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [cmd, ...args], { env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (out += d));
    const timer = setInterval(() => {
      const m = out.match(/(MOCK_SUPABASE_PORT|APP_API_PORT)=(\d+)/);
      if (m) {
        clearInterval(timer);
        resolve({ proc: p, port: Number(m[2]) });
      }
    }, 30);
    setTimeout(() => { clearInterval(timer); resolve({ proc: p, port: 0, out }); }, 5000);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  -> ' + extra : '')); }
}

const mock = await start('tools/mock-supabase.mjs', [], {});
const mockPort = mock.port;
console.log('mock supabase port:', mockPort);

const api = await start('tools/serve-api.mjs', [], {
  SUPABASE_URL: 'http://127.0.0.1:' + mockPort,
  SUPABASE_SERVICE_ROLE_KEY: 'test-key',
});
const apiPort = api.port;
console.log('app api port:', apiPort);
await sleep(200);

const BASE = `http://127.0.0.1:${apiPort}`;
async function call(route, method = 'GET', body = null, token = '') {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(`${BASE}/?route=${encodeURIComponent(route)}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

console.log('\n-- 1. Login tanpa konfigurasi env (harusnya 500 not configured di kenyataan; di sini env ada) --');
console.log('-- 2. Login admin salah password --');
let r = await call('auth/login', 'POST', { username: 'admin', password: 'wrong' });
check('login salah password => 401', r.status === 401 && r.data.ok === false);

console.log('\n-- 3. Login admin benar --');
r = await call('auth/login', 'POST', { username: 'admin', password: 'admin123' });
check('login benar => ok + token + user', r.status === 200 && r.data.ok === true && !!r.data.token && r.data.user.role === 'admin');
const token = r.data.token;

console.log('\n-- 4. auth/me dengan token --');
r = await call('auth/me', 'GET', null, token);
check('me => user admin', r.status === 200 && r.data.ok === true && r.data.user.role === 'admin');

console.log('\n-- 5. state/get (masih kosong) --');
r = await call('state/get', 'GET', null, token);
check('state kosong => state null version 0', r.status === 200 && r.data.state === null && r.data.version === 0);

console.log('\n-- 6. state/save migrasi (force=true, version 0) --');
const snapshot = { 'tahunAjaranList': '["2025/2026"]', 'tahunAjaranAktif': '2025/2026', 'pengaturan': '{"namaSekolah":"X"}' };
r = await call('state/save', 'PUT', { state: snapshot, version: 0, force: true }, token);
check('save => version 1', r.status === 200 && r.data.ok === true && r.data.version === 1);
const v1 = r.data.version;

console.log('\n-- 7. state/get setelah save --');
r = await call('state/get', 'GET', null, token);
check('state tersimpan', r.status === 200 && r.data.state['pengaturan'] && r.data.version === 1);

console.log('\n-- 8. state/save versi salah (simulasi konflik perangkat lain) --');
// perangkat lain menambah versi ke 2
await call('state/save', 'PUT', { state: { ...snapshot, pengaturan: '{"namaSekolah":"Y"}' }, version: 1, force: true }, token);
r = await call('state/save', 'PUT', { state: snapshot, version: 1, force: false }, token);
check('konflik => 409', r.status === 409 && r.data.ok === false);

console.log('\n-- 9. state/save versi benar (2) --');
r = await call('state/save', 'PUT', { state: snapshot, version: 2, force: false }, token);
check('save versi 2 => ok', r.status === 200 && r.data.ok === true && r.data.version === 3);

console.log('\n-- 10. update-accounts (admin) --');
r = await call('auth/update-accounts', 'POST', { accounts: { admin: { username: 'admin', password: 'admin999', role: 'admin' }, guru: { username: 'guru', password: 'guru999', role: 'guru' } } }, token);
check('update akun => ok', r.status === 200 && r.data.ok === true);

console.log('\n-- 11. login dengan password baru --');
r = await call('auth/login', 'POST', { username: 'admin', password: 'admin999' });
check('login password baru => ok', r.status === 200 && r.data.ok === true);

console.log('\n-- 12. logout --');
r = await call('auth/logout', 'POST', null, token);
check('logout => ok', r.status === 200 && r.data.ok === true);
r = await call('auth/me', 'GET', null, token);
check('token invalid setelah logout => 401', r.status === 401);

console.log('\n-- 13. state/get tanpa token => 401 --');
r = await call('state/get', 'GET', null, '');
check('tanpa token => 401', r.status === 401);

console.log('\n-- 14. route tidak dikenal => 404 --');
r = await call('bogus/route', 'GET', null, token);
check('route bogus => 404', r.status === 404);

console.log('\n-- 15. update-accounts oleh guru => 403 --');
let g = await call('auth/login', 'POST', { username: 'guru', password: 'guru999' });
let gt = g.data.token;
r = await call('auth/update-accounts', 'POST', { accounts: { admin: { username: 'a', password: 'p', role: 'admin' }, guru: { username: 'g', password: 'p', role: 'guru' } } }, gt);
check('guru update akun => 403', r.status === 403);

mock.proc.kill(); api.proc.kill();
console.log(`\n===== HASIL: ${pass} lolos, ${fail} gagal =====`);
process.exit(fail ? 1 : 0);
