/**
 * Every case here is a failure that actually shipped, reproduced against a
 * real HTTP server.
 *
 * A check nobody has seen fail is a decoration, so each test constructs the
 * condition and requires the check to catch it and to say something true
 * about why.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { verify } from '../src/verify.js';

const SHA = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const OLD = '0000000000000000000000000000000000000000';

const page = (build: string | null, body = 'x'.repeat(5000)) =>
  `<!doctype html><html><head>` +
  (build ? `<meta name="x-build" content="${build}" />` : '') +
  `<title>t</title></head><body>${body}</body></html>`;

type Routes = Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => void>;

/** A server, and its origin. Closed by the caller. */
async function serve(routes: Routes): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const handler = routes[path];
    if (!handler) {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end(page(SHA, 'not found'));
      return;
    }
    handler(req, res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const html = (body: string, status = 200) => (_: unknown, res: http.ServerResponse) => {
  res.writeHead(status, { 'content-type': 'text/html' });
  res.end(body);
};

const NO_WAIT = { times: 1, waitMs: 0 };

test('a correctly serving site passes', async () => {
  const s = await serve({
    '/': html(page(SHA)),
    '/pricing': html(page(SHA)),
    '/robots.txt': (_, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nAllow: /\n');
    },
  });
  try {
    const r = await verify({
      site: s.origin,
      build: SHA,
      routes: ['/', '/pricing', '/robots.txt'],
      retries: NO_WAIT,
    });
    assert.equal(r.ok, true, JSON.stringify(r.problems.concat(r.routes.flatMap((x) => x.problems))));
    assert.equal(r.liveBuild, SHA);
  } finally {
    await s.close();
  }
});

test('a route that 404s is caught — the flat-file failure', async () => {
  // Exactly what shipped: /pricing resolved, / and /mr did not, because the
  // host looks for x.html and never x/index.html.
  const s = await serve({ '/': html(page(SHA)), '/pricing': html(page(SHA)) });
  try {
    const r = await verify({ site: s.origin, build: SHA, routes: ['/', '/pricing', '/mr'], retries: NO_WAIT });
    assert.equal(r.ok, false);
    const mr = r.routes.find((x) => x.path === '/mr')!;
    assert.equal(mr.ok, false);
    assert.match(mr.problems.join(' '), /returned 404, expected 200/);
    // and the routes that were fine are still reported fine
    assert.equal(r.routes.find((x) => x.path === '/pricing')!.ok, true);
  } finally {
    await s.close();
  }
});

test('a 200 that returns almost nothing is caught', async () => {
  const s = await serve({ '/': html(page(SHA)), '/pricing': html('<html></html>') });
  try {
    const r = await verify({ site: s.origin, build: SHA, routes: ['/', '/pricing'], retries: NO_WAIT });
    assert.equal(r.ok, false);
    const p = r.routes.find((x) => x.path === '/pricing')!;
    assert.match(p.problems.join(' '), /only \d+ bytes/);
    assert.match(p.problems.join(' '), /silently did not run/);
  } finally {
    await s.close();
  }
});

test('a redirect off the origin is named as protection, not as routing', async () => {
  // The *.vercel.app case: 302 to an SSO login. Reporting that as a routing
  // fault sends somebody to fix a file layout that was never wrong.
  const away = await serve({ '/login': html('<html>sso</html>') });
  const s = await serve({
    '/': html(page(SHA)),
    '/robots.txt': (_, res) => {
      res.writeHead(302, { location: `${away.origin}/login` });
      res.end();
    },
  });
  try {
    const r = await verify({ site: s.origin, build: SHA, routes: ['/', '/robots.txt'], retries: NO_WAIT });
    assert.equal(r.ok, false);
    const robots = r.routes.find((x) => x.path === '/robots.txt')!;
    assert.match(robots.problems.join(' '), /redirected off/);
    assert.match(robots.problems.join(' '), /deployment protection|SSO/);
  } finally {
    await s.close();
    await away.close();
  }
});

test('an older deployment still serving is caught, and says which build it found', async () => {
  const s = await serve({ '/': html(page(OLD)) });
  try {
    const r = await verify({ site: s.origin, build: SHA, routes: ['/'], retries: NO_WAIT });
    assert.equal(r.ok, false);
    assert.equal(r.liveBuild, OLD);
    assert.match(r.problems.join(' '), new RegExp(`serving build ${OLD}`));
    assert.match(r.problems.join(' '), /older deployment is still promoted/);
  } finally {
    await s.close();
  }
});

test('a different project owning the domain is caught — no stamp at all', async () => {
  const s = await serve({ '/': html(page(null)) });
  try {
    const r = await verify({ site: s.origin, build: SHA, routes: ['/'], retries: NO_WAIT });
    assert.equal(r.ok, false);
    assert.match(r.problems.join(' '), /never served a build stamp/);
    assert.match(r.problems.join(' '), /another project still owns this domain/);
  } finally {
    await s.close();
  }
});

test('it waits for promotion rather than failing on the first miss', async () => {
  let hits = 0;
  const s = await serve({
    '/': (_, res) => {
      hits++;
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(page(hits < 3 ? OLD : SHA));
    },
  });
  try {
    const r = await verify({
      site: s.origin,
      build: SHA,
      routes: ['/'],
      retries: { times: 5, waitMs: 1 },
    });
    assert.equal(r.ok, true, r.problems.join(' '));
    assert.ok(hits >= 3, `expected to retry, got ${hits} request(s)`);
  } finally {
    await s.close();
  }
});

test('required and forbidden copy are both enforced', async () => {
  const s = await serve({ '/': html(page(SHA, 'Hello from localhost:5173 and more text ' + 'x'.repeat(5000))) });
  try {
    const r = await verify({
      site: s.origin,
      build: SHA,
      routes: [{ path: '/', contains: ['Hello from'], absent: ['localhost:'] }],
      retries: NO_WAIT,
    });
    assert.equal(r.ok, false);
    const joined = r.routes[0]!.problems.join(' ');
    assert.doesNotMatch(joined, /missing required copy/);
    assert.match(joined, /contains forbidden string/);
  } finally {
    await s.close();
  }
});

test('a non-document route is not held to the document byte floor', async () => {
  const s = await serve({
    '/': html(page(SHA)),
    '/robots.txt': (_, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\n');
    },
  });
  try {
    const r = await verify({ site: s.origin, build: SHA, routes: ['/', '/robots.txt'], retries: NO_WAIT });
    assert.equal(r.ok, true, r.routes.flatMap((x) => x.problems).join(' '));
  } finally {
    await s.close();
  }
});

test('without a build id it checks availability only', async () => {
  const s = await serve({ '/': html(page(null)) });
  try {
    const r = await verify({ site: s.origin, routes: ['/'], retries: NO_WAIT });
    assert.equal(r.ok, true, r.problems.join(' '));
  } finally {
    await s.close();
  }
});
