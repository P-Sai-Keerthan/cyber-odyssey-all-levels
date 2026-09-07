/**
 * Round-robin reverse proxy for a LOCAL multi-instance smoke test.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------
 * The Portal's render ceiling is a per-PROCESS limit: Next.js renders Server
 * Components on one JavaScript thread, so 300 simultaneous page loads queue
 * behind a single event loop no matter how fast the database answers. That was
 * measured — deduplicating every repeated query in the render path cut the API
 * waves by 28-54% and moved the page-render wave by 0%.
 *
 * The only way to raise that ceiling is more processes. This script exists so
 * that claim can be TESTED rather than asserted: it fans requests across N
 * already-running Portal instances so the same load harness can be pointed at
 * one address.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SAFE FOR THIS APPLICATION
 * ---------------------------------------------------------------------------
 * The Portal is on PostgreSQL, and its per-request state lives in the database,
 * not in the process:
 *
 *   - sessions      -> `Session` table, looked up by cookie token
 *   - level state   -> `LevelState`
 *   - scores        -> recomputed in-transaction with row locks
 *   - idempotency   -> unique indexes on `IntegrationEvent`
 *
 * So any instance can serve any request. This would NOT have been true on
 * SQLite, where concurrent writers across processes contend for a single file
 * lock.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES *NOT* MAKE SAFE
 * ---------------------------------------------------------------------------
 * The rate limiter is per-process, in-memory. Behind this proxy, N instances
 * mean each client gets roughly N times its intended allowance. That is a real
 * consequence of running replicas and is why `RateLimitStore` exists with a
 * database-backed implementation — see lib/security/rate-limit.
 *
 * DEVELOPMENT / TEST TOOL. Not a production ingress: no TLS, no health checks,
 * no retries, no sticky sessions, no graceful drain. A real deployment puts
 * nginx, Caddy or a cloud load balancer here.
 *
 * Usage:
 *   node scripts/multi-instance-proxy.mjs --port 3002 --targets 3102,3103
 */

import http from 'node:http';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = Number(arg('port', '3002'));
const TARGETS = String(arg('targets', '3102,3103'))
  .split(',')
  .map((p) => Number(p.trim()))
  .filter(Boolean);

if (TARGETS.length === 0) {
  console.error('No targets. Use --targets 3102,3103');
  process.exit(1);
}

let next = 0;
let served = 0;
const perTarget = new Map(TARGETS.map((t) => [t, 0]));

const server = http.createServer((req, res) => {
  // Round robin. Deliberately not least-connections: the point of the test is
  // an even split, so that a latency change is attributable to instance COUNT
  // rather than to the balancing policy.
  const target = TARGETS[next % TARGETS.length];
  next++;
  served++;
  perTarget.set(target, (perTarget.get(target) ?? 0) + 1);

  const proxied = http.request(
    {
      host: '127.0.0.1',
      port: target,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${target}`,
        // Preserved so the application still sees the ORIGINAL client address.
        // The rate limiter must never key on a proxy's own address, or every
        // participant behind it shares one bucket.
        'x-forwarded-for': req.socket.remoteAddress ?? '',
        'x-forwarded-proto': 'http',
      },
    },
    (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(res, { end: true });
    },
  );

  proxied.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`upstream ${target} failed: ${err.message}`);
  });

  req.pipe(proxied, { end: true });
});

server.listen(PORT, () => {
  console.warn(`[proxy] :${PORT} -> ${TARGETS.join(', ')} (round robin)`);
  console.warn('[proxy] DEV/TEST ONLY — no TLS, no health checks, no retries.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.warn(`\n[proxy] served ${served} requests`);
    for (const [t, n] of perTarget) console.warn(`[proxy]   :${t} -> ${n}`);
    server.close(() => process.exit(0));
  });
}
