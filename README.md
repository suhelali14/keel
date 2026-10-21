# keel

**Deployment tooling that verifies reality, not the build.**

A keel is the backbone a ship is built on. Nothing else holds unless it does.

---

## The problem this exists for

Almost every deploy pipeline verifies the *artifact*. Very few verify the
*system*. The gap between those two is where production incidents live, and
it is wider than it looks.

Four real failures, all from one day of shipping one small site, all of which
passed every check that existed at the time:

| What the check said | What was true |
|---|---|
| Build green, all 9 pages written, correct bytes, correct language, titles and canonicals present | A third of the site returned **404**. The files were filed under names the host never looks for. |
| Screenshots showed a broken mobile layout | The layout was fine. The browser could not open a window narrower than 494px, so every "390px" capture was a desktop layout clipped. |
| The font name was in the shipped CSS | The font had no such family. The name was right and the file served nothing. |
| The config check failed, naming app A | The fault was in app B. The check had an `else` branch that assumed only two apps existed. |
| The deployment URL returned 404 and 302 | Routing was fine. The URL was behind an auth wall and the checker was interrogating a login page. |

None of these are exotic. Each one is a check reporting on something
*adjacent* to the truth, confidently.

**keel's single discipline:** a check must assert on the thing that actually
serves users, and it must be proven to fail on the condition it exists to
catch. A check nobody has seen fail is a decoration.

---

## Packages

Nothing here is published yet. Status is stated per package and kept honest;
see [docs/PLAN.md](docs/PLAN.md) for sequencing.

| Package | Does | Status |
|---|---|---|
| `@nayaverse/preflight` | Validates configuration *before* expensive work. Fail in two seconds, not after a 2.5 GB pull, a schema migration and a rollback. | planned |
| `@nayaverse/verify-deploy` | Stamps a build id into the artifact, then asserts the **public URL** serves *that* build and every declared route answers. | planned |
| `@nayaverse/prerender` | A route table in, crawlable HTML out: per-route head, canonical, hreflang, sitemap, robots, build stamp. | planned |
| `@nayaverse/probe` | Browser verification over CDP: true device emulation, overflow sweeps, section isolation, contrast computed from the stylesheet. | planned |
| `@nayaverse/lingo` | Translations whose completeness is a compile error, not a runtime blank. | planned |
| `@nayaverse/tenant` | Hostname to tenant, for one bundle serving many customers. | planned |
| `@nayaverse/provision` | Convergent provisioning: steps safe to run on every deploy, so a half-finished setup heals instead of needing repair. | planned |

---

## Generic, honestly

keel's interfaces are host-, database- and framework-agnostic. Its **tested
adapters** are not the same list, and conflating those two is how a toolkit
ends up claiming support it does not have.

Every adapter carries one of three labels, and they mean exactly this:

- **Proven** — runs in production for a real paying customer, and the test
  suite exercises the real module rather than a copy of its logic.
- **Tested** — covered by tests against a real instance or a faithful double,
  not yet carrying production traffic.
- **Contributed** — written and type-checked, never run against the real
  service by a maintainer. Treat it as a starting point.

No adapter is listed without one. If a service you need is missing, the
interfaces are small on purpose: see `docs/ADAPTERS.md` when it lands.

---

## What this is not

- **Not a replacement for Terraform, SST, Nx or Turborepo.** Those manage
  infrastructure and monorepos. keel assumes you already deploy somehow and
  adds the layer that checks whether what you deployed is actually serving.
- **Not a framework.** There is no `keel build`, no project template, nothing
  that owns your app's structure. Every package is usable alone.
- **Not a hosting product.** It never needs credentials beyond what your own
  pipeline already holds, and it stores nothing.

---

## Where it came from

Extracted from a single-tenant-per-deployment SaaS: one codebase redeployed
per customer, each with its own database, domain, TLS certificate and
container. That shape makes deployment correctness unusually load-bearing —
a silent failure is not one broken site, it is one broken *customer* — and it
is what produced the discipline above.

The patterns are not specific to it. The failures in that table are the
ordinary failures of shipping anything.

---

## Licence

MIT.
