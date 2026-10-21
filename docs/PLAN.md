# Implementation plan

> **Superseded in part.** The prior-art check in [PRIOR-ART.md](PRIOR-ART.md)
> cut this from seven packages to three. `prerender`, `lingo`, `tenant` and
> `provision` are already solved by Astro, TanStack Start, Paraglide, t3-env
> and Terraform; what was worth keeping from them is in
> [PATTERNS.md](PATTERNS.md). This file is kept for the decisions and the
> sequencing reasoning, not as a to-do list.

Written to be argued with. Every phase names what it ships, how it is proven,
and what would make it not worth doing.

## Decisions taken

| Decision | Choice | Consequence |
|---|---|---|
| Audience | Public open source, from day one | README-first, semver, no customer names or infrastructure details in any file |
| Generality | Host-, DB-, framework-agnostic interfaces | Narrow ports, few adapters, each labelled Proven / Tested / Contributed |
| First cut | All four areas: pipeline, prerender, probe, app primitives | Staged across four phases so each is usable alone |
| Repo | Standalone, npm scope `@nayaverse/*` | Publishing under the product name is also reach, which is the point |
| Language | TypeScript, ESM, Node 20+ | Matches the source project; no build step for consumers beyond types |

The name `keel` is day-one cheap to change. If something better turns up
before the first publish, rename costs one commit.

## The through-line

Every package is a check or a thing that makes a check possible. The ordering
below is by **how painful the lesson was and how small the package is**, not
by how interesting it is to build. The smallest, most proven things ship first
so the repo has something real in it within a day rather than a month.

---

## Phase 1 — the discipline, in two packages

The smallest pieces, each born from a specific failure.

### `@nayaverse/preflight`

Validate configuration before anything expensive happens.

```ts
import { preflight, required, derived } from '@nayaverse/preflight';

await preflight({
  // Read from wherever: env files on a server, process.env, a secret store.
  source: envFiles('/srv/app/env/*.env'),
  rules: [
    required('DATABASE_URL', { pattern: /^postgres(ql)?:\/\// }),
    required('JWT_SECRET', { minLength: 16, secret: true }),

    // The one that matters: a value that is not a secret and not a choice
    // can be WRITTEN rather than merely reported missing.
    derived('REDIS_URL', ({ name }) => `redis://redis-${name}:6379`, {
      because: 'one session store per tenant, named by convention',
    }),
  ],
});
```

**The failure it exists for.** A newly required variable was missing from one
tenant's env file. The deploy pulled 2.5 GB, migrated the database, restarted
the container, failed its health check and rolled back — to discover something
knowable in two seconds. `derived` heals it; `required` fails fast and prints
the exact command to fix it.

**Proven by:** a tenant env file missing each rule in turn, asserting the
process exits before any side effect; and `derived` writing a real file and
being idempotent on a second run.

### `@nayaverse/verify-deploy`

Assert the **public URL** serves **this build**.

```ts
import { stamp, verify } from '@nayaverse/verify-deploy';

// At build time: put the commit in the artifact.
stamp({ into: 'dist/**/*.html', build: process.env.GITHUB_SHA });

// After deploy: ask the address customers use.
await verify({
  site: 'https://example.com',
  build: process.env.GITHUB_SHA,   // not "is it up" — "is THIS up"
  routes: ['/', '/pricing', '/robots.txt', '/sitemap.xml'],
  minBytes: 2000,                   // a 200 that returns nothing is a failure
  retries: { times: 8, waitMs: 15000 },
});
```

**The failures it exists for.** Two, pulling in opposite directions:

1. Checking the build cannot see a routing fault. A site can be perfectly
   built and a third of it can 404.
2. Checking a public URL without a build id cannot tell *this* deploy from an
   older one still being served — or from a different project that still owns
   the domain. Both happened.

The build stamp is what closes the gap. It is the difference between "the site
is up" and "the thing I just shipped is up".

**Proven by:** running against a real site with a sha that is not deployed —
it must wait, report the stamp it actually found, and exit non-zero.

**Deliberately not included:** anything that needs host credentials. It is an
HTTP client and a string comparison, which is why it works with any host.

---

## Phase 2 — the frontend half

### `@nayaverse/prerender`

A route table in, crawlable HTML out.

```ts
import { prerender } from '@nayaverse/prerender';

await prerender({
  routes,                            // [{ path, locale, render, head }]
  template: 'dist/index.html',
  out: 'dist',
  origin: 'https://example.com',
  emit: { sitemap: true, robots: true, hreflang: true },
  // Flat files, because a host that resolves /x to x.html will never look
  // for x/index.html. This default is the 404 that started all of this.
  layout: 'flat',
  assert: {
    minMarkupBytes: 9000,
    contains: { '/': ['One system'] },  // copy that must survive an edit
  },
});
```

Framework-agnostic through one interface: a route supplies
`render(): string | Promise<string>`. React is the first adapter
(`react-dom/server`); anything that can produce a string works.

**Also emits the routing config**, so the file layout and the host's rewrites
are generated from one list and cannot disagree. That disagreement is exactly
what shipped a broken homepage.

### `@nayaverse/probe`

Browser verification over the Chrome DevTools Protocol.

```ts
const page = await probe('https://example.com');

await page.overflowSweep([320, 360, 390, 414, 768, 1024, 1440]);  // names the element
await page.contrast({ from: 'dist/assets/index.css', min: 4.5 });
await page.shot('hero', { width: 390, only: '#hero' });
```

**The failure it exists for.** Chrome on Windows cannot open a window narrower
than ~494px, so `--window-size=390,844` produces a *desktop layout clipped to
390px* — which looks exactly like a horizontal-overflow bug. Hours can be
spent fixing a bug that is not there. `Emulation.setDeviceMetricsOverride` is
the only honest way to check a phone layout, and almost nobody knows it.

Contrast is computed **from the stylesheet**, not from a hand-kept list, so it
cannot drift from the tokens actually shipped.

---

## Phase 3 — app primitives

### `@nayaverse/lingo`

Translations whose completeness is a compile error.

```ts
export type Content = typeof en;          // the source language is the schema
export const mr: Content = { /* ... */ }; // a missing key will not compile
```

Zero runtime, no key strings, no `t('some.path')` that silently returns the
path. Ships a locale-prefixed route helper and `hreflang` wiring, because a
translation a crawler cannot reach is a translation nobody arrives in.

Also carries the script-metrics lesson: Latin leading and letter-spacing
destroy Devanagari — tracking breaks the shirorekha, and `line-height: 0.88`
collides the lines. The package ships the per-script overrides rather than
leaving every consumer to discover it.

### `@nayaverse/tenant`

Hostname to tenant, for one bundle serving many customers. Resolution order,
most explicit first, with an escape hatch at every level. Includes the trap
worth documenting: a bundler inlines `import.meta.env.X` at build time, so
forcing that variable in a test **dead-code-eliminates the resolver you were
trying to test**.

---

## Phase 4 — provisioning

The largest and most adapter-heavy, deliberately last: it is the part most
coupled to a specific stack, and the earlier phases are useful without it.

```ts
await provision(tenant, {
  steps: [
    db.create(),        // adapter: Neon | plain Postgres
    db.migrate(),       // shells out to YOUR migration tool, never reimplements it
    host.project(),     // adapter: Vercel | static | none
    runtime.compose(),  // adapter: Docker Compose
    tls.certificate(),  // adapter: certbot
    dns.records(),      // usually manual: it is the customer's registrar
  ],
  convergent: true,     // every step safe to re-run; a half-finished setup heals
  dryRun: !process.env.APPLY,   // the default, because these steps cost money
});
```

Two rules that are not negotiable, both learned expensively:

1. **Never store a per-tenant database credential.** Fetch at the moment of
   use, drop it after. A breach of the control plane is then one API key to
   rotate, not every customer's data at once.
2. **Dry run is the default**, and a dry run is logged as a dry run, so a
   rehearsal can never be mistaken for the real thing when reading history
   back.

---

## Sequencing, and when to stop

| Phase | Ships | Rough size |
|---|---|---|
| 1 | `preflight`, `verify-deploy` | small — mostly extraction |
| 2 | `prerender`, `probe` | medium — `probe` has a CDP client to own |
| 3 | `lingo`, `tenant` | small |
| 4 | `provision` + adapters | large, and open-ended by nature |

**Phase 1 is the gate.** If `verify-deploy` is not obviously useful to
somebody who has never seen this codebase, the premise is wrong and phases 2–4
inherit that. Ship phase 1, use it in anger on a real deploy, and only then
continue.

**What would make this not worth doing:** if it takes attention from selling.
The source project has one paying customer and twenty trades still to build.
A toolkit that makes the next twenty cheap is leverage; a toolkit that becomes
the work is a detour wearing leverage's clothes. The staged plan is the guard:
each phase is independently useful, so stopping after any one of them leaves
something finished rather than something abandoned.

## Open questions

1. **Name.** `keel` is a placeholder with a rationale, not a commitment.
2. **Monorepo tooling.** npm workspaces is enough for seven small packages;
   adding Nx or Turborepo on day one is tooling for a problem not yet present.
3. **`probe`'s CDP client.** Own a small one (~150 lines, zero dependencies,
   total control) or depend on Playwright (large, but everyone has it). The
   source implementation is the small one and it has been sufficient.
4. **Is `provision` a package or a book?** Its value may be the documented
   runbook rather than code, given how much of it is one registrar, one
   dashboard, one `dig`. Decide at phase 4, not now.
