# @nayaverse/verify-deploy

**Assert the public URL serves the build you just shipped.**

Zero dependencies. Node 20+. Works with any host, because it is an HTTP client
and a string comparison.

```bash
npm i -D @nayaverse/verify-deploy
```

---

## The two failures this exists for

They pull in opposite directions, which is why most checks catch neither.

**1. Checking the build cannot see a routing fault.**

A site can be perfectly built — every page written, correct bytes, correct
language, titles and canonicals present — and a third of it can return 404,
because the host resolves `/x` to `x.html` and never looks for
`x/index.html`. Nothing about the build is wrong. Nothing in a build-time
check can see it.

**2. Checking a public URL without a build id cannot tell which deploy answered.**

A 200 can come from the deploy you just made, from an older one still
promoted, or from an entirely different project that still owns the domain.
All three look identical.

The build stamp closes the gap. It turns *"the site is up"* into *"the thing I
just shipped is up"*.

---

## Use

### In a pipeline

```yaml
- name: Build
  run: npm run build

- name: Stamp the build
  run: npx verify-deploy stamp --into dist --build "$GITHUB_SHA"

- name: Deploy
  run: ./deploy.sh

- name: Ask the live site
  run: |
    npx verify-deploy \
      --site https://example.com \
      --build "$GITHUB_SHA" \
      --routes ".,pricing,hi,mr,robots.txt,sitemap.xml"
```

### In code

```ts
import { stamp, verify } from '@nayaverse/verify-deploy';

stamp({ into: 'dist', build: process.env.GITHUB_SHA! });

const result = await verify({
  site: 'https://example.com',
  build: process.env.GITHUB_SHA!,
  routes: [
    '/',
    '/pricing',
    { path: '/robots.txt', stamped: false },
    { path: '/', contains: ['One system'], absent: ['localhost:'] },
  ],
  minBytes: 2000,
  retries: { times: 8, waitMs: 15_000 },
});

if (!result.ok) process.exit(1);
```

---

## What it catches

| Condition | Reported as |
|---|---|
| Route returns the wrong status | `returned 404, expected 200` |
| Route returns 200 and almost nothing | `only 13 bytes (floor 2000) — a build that silently did not run` |
| Response redirects off your origin | `redirected off https://example.com — usually deployment protection or an SSO wall, not a routing fault` |
| An older deployment is still promoted | `serving build <old>, not <new>` |
| Another project owns the domain | `never served a build stamp` |
| Required copy was edited away | `missing required copy "..."` |
| A dev host reached production | `contains forbidden string "localhost:"` |

That third row is worth its own note. A raw `*.vercel.app` deployment URL sits
behind deployment protection and answers `404` in 107 bytes and `302` on
`robots.txt`. Reported as status codes, that looks exactly like a broken
routing table, and sends somebody to fix a file layout that was never wrong.
It is named instead.

---

## Notes

**Every route is cache-busted** with a `_vd` query parameter, so a CDN cannot
answer on the deployment's behalf.

**Non-document routes are not held to the document byte floor.** `robots.txt`
is allowed to be 70 bytes; `/pricing` is not.

**The stamp is checked before any route.** Judging routes against whatever
happens to be deployed is how a green check certifies an old deployment.

**On Git Bash, a bare `/` argument is rewritten to your MSYS install path**
before this process sees it, and every request then fails for a reason that
has nothing to do with your site. The CLI detects that and says so, rather
than reporting seven dead routes. Use `--routes ".,pricing"` (no leading
slash) or `MSYS_NO_PATHCONV=1`.

---

## API

### `stamp(options): StampResult`

| Option | Type | Default | |
|---|---|---|---|
| `into` | `string \| string[]` | — | directory to walk, or files |
| `build` | `string` | — | the build id |
| `name` | `string` | `x-build` | meta tag name |
| `extensions` | `string[]` | `['.html']` | when `into` is a directory |

Throws if nothing was stamped. A build that ships no stamp cannot be verified,
and failing at build time is cheaper than discovering it after a deploy.

### `verify(options): Promise<VerifyResult>`

| Option | Type | Default | |
|---|---|---|---|
| `site` | `string` | — | public origin |
| `routes` | `RouteSpec[]` | — | paths, or specs |
| `build` | `string?` | — | omit to check availability only |
| `minBytes` | `number` | `2000` | floor for document routes |
| `stampName` | `string` | `x-build` | must match `stamp` |
| `retries` | `{times, waitMs}` | `{8, 15000}` | waiting for promotion |
| `timeoutMs` | `number` | `30000` | per request |
| `fetchImpl` | `typeof fetch` | global | for tests |
| `onProgress` | `(line) => void` | noop | |

Returns `{ ok, site, build, liveBuild, routes, problems }`. Never throws for a
failed check — `ok` is the answer, so a caller can report before exiting.

---

## Tests

Every test constructs a real HTTP server reproducing a failure that actually
shipped, and requires the check to catch it. A check nobody has seen fail is a
decoration.

```bash
npm test
```

## Licence

MIT.
