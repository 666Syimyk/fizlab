import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { loadServerEnv } from './server-env.mjs';
import worker from '../server/worker.mjs';
const env = loadServerEnv();
const databasePath = path.resolve(process.env.FIZLAB_DB_PATH || 'data.local/fizlab.sqlite');
const port = Number(process.env.PORT || 4174);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const sqlite = new DatabaseSync(databasePath);
sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
const trustProxy = process.env.FIZLAB_TRUST_PROXY === '1';
const DB = {
  async exec(sql) { sqlite.exec(sql); },
  prepare(sql) {
    let args = [];
    const stmt = {
      bind(...values) { args = values; return stmt; },
      async first(column) { const row = sqlite.prepare(sql).get(...args); return column ? row?.[column] ?? null : row ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async run() { return sqlite.prepare(sql).run(...args); },
      runSync() { return sqlite.prepare(sql).run(...args); },
    };
    return stmt;
  },
  async batch(statements) {
    sqlite.exec('BEGIN');
    try { const result = statements.map(stmt => stmt.runSync()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
const root = path.resolve('dist/client');
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf', '.wasm':'application/wasm' };
const ASSETS = { async fetch(request) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url).pathname); }
  catch { return new Response('Invalid URL', { status: 400 }); }
  const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) return new Response('Not found', { status: 404 });
  return new Response(fs.readFileSync(filename), { headers: { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' } });
} };
Object.assign(env, { DB, ASSETS });
// Same durable deletion retry as the production Worker cron, without keeping Node alive.
const deletionRetry = setInterval(() => { void worker.scheduled({}, env).catch(() => console.error('Subscription deletion retry unavailable')); }, 60 * 60 * 1000);
deletionRetry.unref();
function serve(port) {
  const server = http.createServer(async (req, res) => {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (value && !key.toLowerCase().startsWith('oai-')) headers.set(key, Array.isArray(value) ? value.join(',') : value);
      // Only trust forwarded identity when this loopback listener is behind an explicitly trusted proxy.
      const forwardedIP = headers.get('cf-connecting-ip');
      headers.set('cf-connecting-ip', trustProxy && isIP(forwardedIP || '') ? forwardedIP : req.socket.remoteAddress || 'local');
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 65536) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
      // Reconstruct the browser-facing scheme for CORS; IP trust remains opt-in above.
      const scheme = headers.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
      const host = headers.get('host') || `127.0.0.1:${port}`;
      const request = new Request(`${scheme}://${host}${req.url}`, { method: req.method, headers, ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Buffer.concat(chunks) } : {}) });
      const response = await worker.fetch(request, env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch (error) { console.error(error.message); res.writeHead(500); res.end('Server error'); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 100;
  server.listen(port, '127.0.0.1', () => console.log(`SITE http://127.0.0.1:${server.address().port}`));
  const close = () => server.close(() => { sqlite.close(); process.exit(0); });
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
}
serve(port);
