/**
 * Ask the address customers use whether it is serving the build you shipped.
 *
 * Every failure this is built from passed a green build:
 *
 *   - a site with all nine pages written correctly, a third of which 404'd,
 *     because the host resolves /x to x.html and never to x/index.html;
 *   - a 200 that returned 13 bytes, because the prerender silently did not run;
 *   - a 404 in 107 bytes and a 302 on robots.txt, because the URL under test
 *     was behind an auth wall and the checker was reading a login page;
 *   - a 200 from an older deployment, and from a different project that still
 *     owned the domain.
 *
 * So: the public URL, the build id, and a redirect that leaves the origin is
 * its own named failure rather than a mysterious status code.
 */
import { readStamp } from './stamp.js';

export type RouteSpec =
  | string
  | {
      path: string;
      /** Expected status. Default 200. */
      status?: number;
      /** Minimum bytes. Defaults to `minBytes` for HTML, 1 otherwise. */
      minBytes?: number;
      /** Substrings the body must contain. */
      contains?: string[];
      /** Substrings the body must NOT contain. A dev host, a placeholder. */
      absent?: string[];
      /** Skip the build-stamp requirement (robots.txt has no <head>). */
      stamped?: boolean;
    };

export type VerifyOptions = {
  /** Public origin, e.g. https://example.com */
  site: string;
  /** Routes to check. Paths, or specs. */
  routes: RouteSpec[];
  /** The build id that must be live. Omit to check availability only. */
  build?: string;
  /** Byte floor for HTML routes. A 200 that returns nothing is a failure. */
  minBytes?: number;
  /** Meta tag name holding the build id. */
  stampName?: string;
  /** Waiting for the deploy to be promoted to the domain. */
  retries?: { times: number; waitMs: number };
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  /** Called with each line of progress. */
  onProgress?: (line: string) => void;
};

export type RouteResult = {
  path: string;
  url: string;
  status: number | null;
  bytes: number;
  ok: boolean;
  /** Where the response actually came from, if it moved. */
  finalUrl?: string;
  problems: string[];
};

export type VerifyResult = {
  ok: boolean;
  site: string;
  build?: string;
  /** The build id the site actually served, when one was found. */
  liveBuild?: string | null;
  routes: RouteResult[];
  problems: string[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const normalise = (r: RouteSpec) => (typeof r === 'string' ? { path: r } : r);

/** Looks like a document rather than an asset. */
const isDocument = (path: string) => {
  const last = path.split('/').pop() ?? '';
  return !last.includes('.') || last.endsWith('.html');
};

async function get(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<{ status: number | null; body: string; finalUrl: string; error?: string }> {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: control.signal, redirect: 'follow' });
    const body = await res.text();
    return { status: res.status, body, finalUrl: res.url || url };
  } catch (err) {
    return {
      status: null,
      body: '',
      finalUrl: url,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** A cache buster, so a CDN cannot answer for the deployment. */
const bust = (site: string, path: string) => {
  const url = new URL(path, site);
  url.searchParams.set('_vd', Math.random().toString(36).slice(2));
  return url.toString();
};

export async function verify(options: VerifyOptions): Promise<VerifyResult> {
  const {
    site,
    routes,
    build,
    minBytes = 2000,
    stampName,
    retries = { times: 8, waitMs: 15_000 },
    timeoutMs = 30_000,
    fetchImpl = fetch,
    onProgress = () => {},
  } = options;

  if (!site) throw new Error('verify: `site` is required');
  if (routes.length === 0) throw new Error('verify: at least one route is required');

  const origin = new URL(site).origin;
  const result: VerifyResult = { ok: true, site, routes: [], problems: [] };
  if (build) result.build = build;

  // ----------------------------------------------------------------- stamp --
  // Wait for THIS build before judging any route. Checking routes against
  // whatever happens to be deployed is how a green check certifies an old
  // deployment.
  if (build) {
    const first = normalise(routes[0]!).path;
    let live: string | null = null;

    for (let attempt = 1; attempt <= retries.times; attempt++) {
      const res = await get(bust(site, first), timeoutMs, fetchImpl);
      live = res.body ? readStamp(res.body, stampName) : null;
      if (live === build) {
        onProgress(`build ${build} live after ${attempt} attempt(s)`);
        break;
      }
      if (attempt === retries.times) {
        result.ok = false;
        result.problems.push(
          live === null
            ? `${site} never served a build stamp. Either this build did not ship, or ` +
              `another project still owns this domain.`
            : `${site} is serving build ${live}, not ${build}. The deploy did not reach ` +
              `the domain, or an older deployment is still promoted.`,
        );
        break;
      }
      onProgress(
        `attempt ${attempt}/${retries.times}: serving ${live ?? 'no stamp'}, waiting ${retries.waitMs}ms`,
      );
      await sleep(retries.waitMs);
    }
    result.liveBuild = live;
    if (!result.ok) return result;
  }

  // ---------------------------------------------------------------- routes --
  for (const spec of routes.map(normalise)) {
    const url = bust(site, spec.path);
    const res = await get(url, timeoutMs, fetchImpl);
    const bytes = Buffer.byteLength(res.body);
    const expected = spec.status ?? 200;
    const problems: string[] = [];

    if (res.status === null) {
      problems.push(`request failed: ${res.error}`);
    } else {
      if (res.status !== expected) {
        problems.push(`returned ${res.status}, expected ${expected}`);
      }

      // The auth-wall case, named rather than left as a puzzling status.
      if (res.finalUrl && new URL(res.finalUrl).origin !== origin) {
        problems.push(
          `redirected off ${origin} to ${new URL(res.finalUrl).origin} — ` +
            `this is usually deployment protection or an SSO wall, not a routing fault`,
        );
      }

      if (res.status === expected) {
        const floor = spec.minBytes ?? (isDocument(spec.path) ? minBytes : 1);
        if (bytes < floor) {
          problems.push(
            `returned ${res.status} but only ${bytes} bytes (floor ${floor}) — ` +
              `a page that resolves but is nearly empty is a build that silently did not run`,
          );
        }
        for (const needle of spec.contains ?? []) {
          if (!res.body.includes(needle)) problems.push(`missing required copy ${JSON.stringify(needle)}`);
        }
        for (const needle of spec.absent ?? []) {
          if (res.body.includes(needle)) problems.push(`contains forbidden string ${JSON.stringify(needle)}`);
        }
        if (build && spec.stamped !== false && isDocument(spec.path)) {
          const live = readStamp(res.body, stampName);
          if (live !== build) {
            problems.push(`serving build ${live ?? 'none'}, expected ${build}`);
          }
        }
      }
    }

    const route: RouteResult = {
      path: spec.path,
      url,
      status: res.status,
      bytes,
      ok: problems.length === 0,
      problems,
    };
    if (res.finalUrl !== url) route.finalUrl = res.finalUrl;
    result.routes.push(route);

    onProgress(
      `  ${spec.path.padEnd(18)} ${String(res.status ?? 'ERR').padStart(3)}  ${String(bytes).padStart(7)} bytes` +
        (problems.length ? `  <- ${problems.length} problem(s)` : ''),
    );
  }

  if (result.routes.some((r) => !r.ok)) result.ok = false;
  return result;
}
