// Wrapper untuk menjalankan api/server.js sebagai HTTP server lokal.
// Menerima env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PORT
import http from 'node:http';
import handler from '../api/server.js';

const port = Number(process.env.PORT || 0);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const query = {};
  url.searchParams.forEach((v, k) => { query[k] = v; });
  let body = null;
  req.on('data', c => (body = (body || '') + c));
  req.on('end', () => {
    const adaptedReq = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      query,
      body: body ? body : undefined,
    };
    // Adaptasi res
    const adaptedRes = {
      _status: 200, _headers: {}, _body: '',
      status(s) { this._status = s; return this; },
      setHeader(k, v) { this._headers[k] = v; return this; },
      send(d) { this._body = d; },
      end() {},
    };
    handler(adaptedReq, adaptedRes).then(() => {
      if (!res.headersSent) {
        res.writeHead(adaptedRes._status, { 'Content-Type': 'application/json', ...adaptedRes._headers });
        res.end(adaptedRes._body);
      }
    }).catch(e => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: 'internal: ' + e.message }));
    });
  });
});
server.listen(port, () => process.stdout.write('APP_API_PORT=' + server.address().port + '\n'));
