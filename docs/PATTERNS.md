# Patterns that are not packages

Four things that were planned as libraries and are better as things you know.
Each is short enough to write yourself, and each carries a trap that cost real
time to find. A fifteen-line idea behind a dependency is worse than the idea
written down.

See [PRIOR-ART.md](PRIOR-ART.md) for why each was dropped.

---

## 1. Generate the routing config from the route list

**The one piece of prerendering worth keeping**, and the reason it is not in
the frameworks: each of them assumes it owns the whole pipeline, so the file
layout and the host's rewrite rules are never two things that could disagree.
When you bolt prerendering onto a build yourself, they are.

A site shipped with all nine of its pages written, correct, and checked — and
a third of its routes returning 404, because the host resolves `/x` by looking
for `x.html` and never falls back to `x/index.html`. The locale homepages were
written as `mr/index.html`. Nothing was wrong with the build.

The fix is not "remember the right layout". It is to emit both from one list:

```js
const routes = [
  { path: '/',           file: 'index.html' },
  { path: '/pricing',    file: 'pricing.html' },
  { path: '/mr',         file: 'mr.html' },      // not mr/index.html
  { path: '/mr/pricing', file: 'mr/pricing.html' },
];

for (const r of routes) write(r.file, render(r));

writeConfig({ rewrites: routes.map((r) => ({ source: r.path, destination: `/${r.file}` })) });

// And assert it: a rewrite pointing at a file nobody wrote is the bug.
for (const r of routes) {
  if (!exists(r.file)) throw new Error(`${r.path} -> ${r.file}, which was not written`);
}
```

[TanStack Start](https://tanstack.com/start/v0/docs/framework/react/guide/static-prerendering)
exposes this distinction directly as `autoSubfolderIndex`, which is a good
sign it bites people.

**And verify the result**, because none of the above proves the host agrees:
that is what `@nayaverse/verify-deploy` is for.

---

## 2. Translations whose completeness is a compile error

Use [Paraglide](https://inlang.com/m/gerre34r/library-inlang-paraglideJs),
[typesafe-i18n](https://github.com/ivanhofer/typesafe-i18n) or
[next-intl](https://next-intl.dev) for anything real. If you want the idea
without a dependency, it is one line:

```ts
// en.ts — the source language IS the schema
export const en = { nav: { fares: 'Fares' }, hero: { headline: 'One system' } };
export type Content = typeof en;

// mr.ts — a missing key will not compile
import type { Content } from './en.js';
export const mr: Content = { nav: { fares: 'दर' }, hero: { headline: 'तुमचा धंदा' } };
```

Do **not** write `as const` on the source. With literal types, `Content`
demands every translation be *identical* to English. Widened to `string`, the
compiler enforces the thing that matters: completeness.

### The part nobody mentions: script metrics

Latin type settings destroy Devanagari, and the result looks like a font
problem rather than a CSS one.

- `line-height: 0.88`, normal for condensed Latin caps, **collides** Devanagari
  lines — the script carries matras above the shirorekha and below the baseline.
- `letter-spacing` **breaks the shirorekha**, the continuous line along the top
  that makes the script scannable at all. Tracking must go to zero.
- Devanagari sets wider and taller at the same point size, so a display scale
  tuned for Latin overruns its box.
- `text-transform: uppercase` is a no-op; the script has no case.

```css
:root:lang(hi), :root:lang(mr) { --leading: 1.1; --tracking: 0; }
:lang(hi) .display, :lang(mr) .display { font-size: clamp(2.3rem, 8vw, 5.1rem); }
```

Latin faces have no Devanagari glyphs, so put a Devanagari face *after* the
Latin one in the stack — the browser resolves per glyph, and Latin still comes
from the face you chose.

**And put each language at its own URL with `hreflang`.** A translation
reachable only through a cookie or a toggle is a translation nobody arrives in.

---

## 3. Hostname to tenant

About thirty lines, and the interesting part — the resolution order — differs
per product, so a library would only be in the way.

```ts
export function resolveTenant(hostname: string): string | null {
  if (hostname === 'localhost' || hostname.endsWith('.local')) return DEV_TENANT;
  const parts = hostname.split('.');
  if (hostname.endsWith(PLATFORM_DOMAIN)) return parts[0] ?? null;
  return lookupCustomDomain(hostname);
}
```

### The trap

A bundler inlines `import.meta.env.X` (or `process.env.X`) at build time. So
if your resolver has an override —

```ts
if (import.meta.env.VITE_FORCE_TENANT) return import.meta.env.VITE_FORCE_TENANT;
```

— then building with that variable **set**, in order to test the resolver,
makes the first branch statically true and **dead-code-eliminates the
resolver you were trying to test**. Three builds pass and the hostname path
has never run.

Build with the variable deliberately unset, then read the output and confirm
the resolver survived. Unit-test `resolveTenant()` directly against a list of
hostnames including the near-misses: `dashboards.example.com` and
`my-dashboard.example.com` must **not** match a `dashboard.` prefix rule.

---

## 4. Provisioning: two rules, not a package

Use [Terraform](https://www.terraform.io), [Pulumi](https://www.pulumi.com) or
[SST](https://sst.dev). What is worth writing down is policy, not code.

**Never store a per-tenant database credential.** Hold one API key for the
provider, fetch a connection string at the moment it is needed, drop it after.
A breach of the control plane is then one key to rotate rather than every
customer's data at once. If you ever find yourself adding a `databaseUrl`
column, stop.

**Dry run is the default** for anything that creates billable infrastructure,
and a dry run is *logged as* a dry run. Otherwise a rehearsal is
indistinguishable from the real thing when you read the history back a month
later and try to work out what happened.

A third, smaller: **make every step safe to re-run**. Provisioning fails
halfway far more often than it fails at the start, and a convergent step turns
"repair it by hand" into "run it again".
