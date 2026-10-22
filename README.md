# keel

**Deployment tooling that verifies reality, not the build.**

A keel is the backbone a ship is built on. Nothing else holds unless it does.

---

## The problem this exists for

Almost every deploy pipeline verifies the *artifact*. Very few verify the
*system*. The gap between those two is where production incidents live, and
it is wider than it looks.

Five real failures, all from one day of shipping one small site, all of which
passed every check that existed at the time:

| What the check said | What was true |
|---|---|
| Build green, all 9 pages written, correct bytes, correct language, titles and canonicals present | A third of the site returned **404**. The files were filed under names the host never looks for. |
| Screenshots showed a broken mobile layout | The layout was fine. The browser could not open a window narrower than 494px, so every "390px" capture was a desktop layout clipped. |
| The font name was in the shipped CSS | The font had no such family. The name was right and the file served nothing. |
| The Devanagari font was declared, served a 200, and loaded | Every Marathi and Hindi paragraph was drawn in the **Windows UI font**. A Latin face has no Devanagari glyphs, and the stack ran out of our fonts before it reached one that did. |
| The config check failed, naming app A | The fault was in app B. The check had an `else` branch that assumed only two apps existed. |
| The deployment URL returned 404 and 302 | Routing was fine. The URL was behind an auth wall and the checker was interrogating a login page. |

None of these are exotic. Each one is a check reporting on something
*adjacent* to the truth, confidently.

**keel's single discipline:** a check must assert on the thing that actually
serves users, and it must be proven to fail on the condition it exists to
catch. A check nobody has seen fail is a decoration.

---

## Packages

| Package | Does | Tests |
|---|---|---|
| **[@nayaverse/verify-deploy](packages/verify-deploy)** | Stamps a build id into the artifact, then asserts the **public URL** serves *that* build and every declared route answers. | 10 |
| **[@nayaverse/overflow](packages/overflow)** | Finds horizontal overflow at every breakpoint, in CI, and names the element causing it. | 13 |
| **[@nayaverse/preflight](packages/preflight)** | Validates configuration across many sources before anything expensive happens, and writes back what can be computed. | 17 |
| **[@nayaverse/glyphcheck](packages/glyphcheck)** | Asks the browser which font *actually* drew each run of text, and reports the typographic faults nobody can self-detect in a script they cannot read. | 63 |

The first three were published at 0.1.1. `glyphcheck` came last and is the
only one that found a bug in this repo's own production site on its first run
— 469 of them, in two languages, behind a green build.

Four packages, not the seven originally planned. The difference is
[docs/PRIOR-ART.md](docs/PRIOR-ART.md): prerendering, type-safe i18n, tenant
resolution and provisioning are already solved, often better, by Astro,
TanStack Start, Paraglide, t3-env, Terraform and others. Building alternatives
would have been duplication. What survived are the gaps nobody packages, and
the patterns worth writing down live in [docs/PATTERNS.md](docs/PATTERNS.md)
instead of becoming thin libraries.

That is also the better route to adoption. Tools get picked up for a small API
surface and an unsolved problem — and a toolkit that duplicates envalid,
Astro and Terraform invites the reader to notice.

---

## Honest scope

Each package says in its own README where an existing tool is the better
answer. `preflight`'s first section tells you to use t3-env if you only have
one process. `overflow` tells you to use its Playwright adapter rather than
its bundled driver if you already have Playwright.

Three labels are used for anything that touches an external service, and they
mean exactly this:

- **Proven** — runs in production for a real paying customer, with tests
  exercising the shipped module rather than a copy of its logic.
- **Tested** — covered against a real instance or a faithful double, not yet
  carrying production traffic.
- **Contributed** — written and type-checked, never run against the real
  service by a maintainer. A starting point.

---

## What this is not

- **Not a replacement for Terraform, SST, Nx or Turborepo.** Those manage
  infrastructure and monorepos. keel assumes you already deploy somehow and
  adds the layer that checks whether what you deployed is actually serving.
- **Not a framework.** There is no `keel build`, no project template, nothing
  that owns your app's structure. Every package is usable alone, and none of
  them depend on each other.
- **Not a hosting product.** It never needs credentials beyond what your own
  pipeline already holds, and it stores nothing.

---

## Where it came from

Extracted from a single-tenant-per-deployment SaaS: one codebase redeployed
per customer, each with its own database, domain, TLS certificate and
container. That shape makes deployment correctness unusually load-bearing — a
silent failure is not one broken site, it is one broken *customer* — and it is
what produced the discipline above.

The patterns are not specific to it. The failures in that table are the
ordinary failures of shipping anything.

---

## Documentation

| | |
|---|---|
| [docs/VALUE.md](docs/VALUE.md) | What each package solves and what it is worth, measured — 43 lines of shell replaced by 6, 469 text faults found behind a green build, and which packages are not yet earning anything. |
| [docs/SURVEY.md](docs/SURVEY.md) | The packages pointed at 11 pages nobody here built — what they found, and the four times the survey corrected the headline rule before it was fit to publish. |
| [docs/USING-IT.md](docs/USING-IT.md) | The worked before-and-after of swapping hand-rolled deploy checks for these. |
| [docs/PRIOR-ART.md](docs/PRIOR-ART.md) | What already exists, and why three of the seven originally planned packages were not built. |
| [docs/PATTERNS.md](docs/PATTERNS.md) | The patterns worth writing down rather than packaging. |
| [docs/RELEASING.md](docs/RELEASING.md) | Publishing, and the npm traps that cost a version number. |

## Development

```bash
npm install
npm run build
npm test          # 103 tests
```

Node 20+. No runtime dependencies in any package.

## Licence

MIT.
