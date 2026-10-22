# Prior art

Checked before building further, because most of what a new toolkit wants to
do is already done, usually better, by someone who has been doing it for
years. The useful question is not "could we build this" but "is there a hole".

Searched 2026-10-21. Where a box says **solved**, building it would be
duplicating mature work, and the honest recommendation is to use the existing
thing and say so in our own README.

---

## 1. Post-deploy verification pinned to a build id

**Status: a real hole.**

A search for a tool that asserts "the public URL is serving *this* commit, and
every route answers" turned up no dedicated npm package. The closest match is
an agent skill, [`deploy-smoke-test`](https://tessl.io/registry/matthew-a-carr/deploy-smoke-test),
which compares the live Vercel production deployment against the current
`main` commit — but it is Vercel-specific, shells out to the Vercel CLI, and
is distributed as a skill rather than a library.

What exists instead, and why none of it closes the hole:

| Tool | Does | Why it is not this |
|---|---|---|
| Checkly, Datadog Synthetics, Pingdom | Scheduled monitoring from outside | Tells you the site is up, not that it is the build you shipped. Runs on a timer, not as a deploy gate |
| `wait-on` | Waits for a URL to respond | No build identity, no route assertions |
| Playwright / Cypress smoke tests | Anything you write | You write and maintain it; heavyweight for "did the deploy land" |
| Lighthouse CI | Performance and a11y budgets | Not routing, not build identity |
| Platform deploy previews | A URL per deploy | The question is whether *production* moved |

The generic pattern people describe is "expose the commit on a `/version`
endpoint and compare" — which is this package, unbuilt.

**Decision: build it.** Done, as `@nayaverse/verify-deploy`.

---

## 2. Environment and configuration validation

**Status: solved, thoroughly.**

[t3-env](https://github.com/t3-oss/t3-env), [envalid](https://github.com/af/envalid),
plain [Zod](https://zod.dev), [arkenv](https://arkenv.js.org/docs/arkenv/comparison)
and [@zap-studio/env](https://jsr.io/@zap-studio/env) all do typed, validated,
fail-at-startup configuration. A
[2026 guide](https://www.pkgpulse.com/guides/best-env-variable-management-nodejs-2026)
puts t3-env as the default for TypeScript stacks and envalid as the solid
standalone option.

Writing another general env validator would be pure duplication.

**But three things none of them do**, all of which came from running many
deployments of one codebase:

1. **Many sources in one pass.** One file per tenant, a rule that must hold
   for all of them, and a report that names which tenant failed. Every library
   above validates `process.env` — one environment, one process.
2. **Healing a value that is neither a secret nor a choice.** If a newly
   required variable follows from the tenant's own name, the right behaviour
   is to write it, not to fail. That turns a rolled-back deploy into a log
   line.
3. **Printing the command that fixes it.** When the source cannot be written —
   a file owned by root, a secrets manager — the failure should carry the
   exact line to run.

**Decision: narrow it.** `@nayaverse/preflight` keeps the multi-source,
healing and fix-command behaviour, and its README should point at t3-env for
single-process validation rather than competing with it. It is built and
tested; the README needs rewriting to say this plainly.

---

## 3. Horizontal-overflow detection across breakpoints

**Status: a real hole for CI.**

The problem is well known and well written up —
[Smashing Magazine](https://www.smashingmagazine.com/2021/04/css-overflow-issues/),
[CSS-Tricks](https://css-tricks.com/?p=175021),
[Polypane](https://polypane.app/blog/strategies-for-dealing-with-horizontal-overflows/) —
and the techniques are agreed: compare `scrollWidth` to `clientWidth`, then
find the elements whose right edge exceeds the viewport.

What exists:

| Tool | Form | Gap |
|---|---|---|
| [Overflow Detector](https://chrome.google.com/webstore/detail/overflow-detector/gpdnihamialibcjfmdnfbjcljnfbgkbc/reviews) | Chrome extension | Manual, one viewport at a time, not in CI |
| [Polypane](https://polypane.app/), [Sizzy](https://sizzy.co/blog/fix-horizontal-scroll) | Paid browser | Excellent, and a person has to be looking |
| Console snippets | Copy-paste | Not a test, not a gate, nothing fails |

Nobody ships a packaged, CI-runnable sweep that takes a list of breakpoints,
fails the build, and **names the element**. That is the gap.

A second finding, less discussed anywhere: on Windows, Chrome cannot open a
window narrower than about 494px, so `--window-size=390,844` yields a desktop
layout clipped to 390px — which looks exactly like an overflow bug that is not
there. Only CDP `Emulation.setDeviceMetricsOverride` gives an honest narrow
viewport. Playwright gets this right by default and most people never learn
it; anyone driving Chrome directly walks into it.

**Decision: build it**, as a check that runs against Playwright *or* a bare
CDP connection, rather than as another browser driver.

---

## 4. Prerendering and SEO for SPAs

**Status: solved by frameworks; fragmented for bolt-on.**

[TanStack Start](https://tanstack.com/start/v0/docs/framework/react/guide/static-prerendering)
prerenders to static HTML with control over `page/index.html` versus
`page.html` — the exact routing distinction that broke a site earlier today.
Astro and Vike own this space too. Community bolt-ons like
[vite-plugin-seo-prerender](https://github.com/337547038/vite-plugin-seo-prerender)
exist and carry known drawbacks their own READMEs admit.

If you want prerendering, the answer is to adopt a framework that does it.

**Decision: do not build.** The one piece worth keeping is narrow and not a
prerenderer: **generating the host's routing config from the same route list
that produced the files**, so the file layout and the rewrites cannot
disagree. That disagreement is what shipped a broken homepage, and no
framework does it because each assumes it owns the whole pipeline.

---

## 5. Type-safe i18n

**Status: solved.**

Paraglide (inlang), typesafe-i18n, next-intl and Lingui all do compile-time
checked messages, several with zero runtime. The `Content = typeof en` trick
is genuinely nice and is about fifteen lines in a project — not a package.

**Decision: do not build.** Write it up as a pattern in the docs instead.

---

## 6. Hostname-to-tenant resolution

**Status: not a library.** Around thirty lines, and the interesting part is
the ordering policy, which differs per product.

**Decision: do not build.** Document the trap worth knowing: a bundler inlines
`import.meta.env.X` at build time, so forcing that variable in a test
dead-code-eliminates the resolver you were trying to test.

---

## 7. Provisioning

**Status: solved, by very large projects.** Terraform, Pulumi, SST, Ansible.

**Decision: do not build.** What is worth writing down is the two rules that
are policy rather than code: never store a per-tenant database credential, and
make dry-run the default for anything that creates billable infrastructure.

---

## 8. Script-correctness checking for rendered text

**Searched for:** a tool that reports whether non-Latin text on a live page
rendered in the fonts the stylesheet asked for, whether its lines collide,
whether tracking has broken a connected script.

**Found:** nothing that does this.

- **Pseudo-localisation tools** (`pseudo-localization`, 141 stars; the same
  feature in Chrome DevTools and in several i18n frameworks) transform Latin
  into accented Latin and pad it to simulate German length. They test that a
  layout survives longer strings and wider diacritics. They do not render
  Devanagari, Arabic or Thai, so they cannot surface anything about how those
  scripts actually lay out.
- **axe-core** (7,685 stars) and **Lighthouse** (30,921) check contrast, roles,
  labels and structure. Neither inspects the resolved font of a text run, and
  neither has a notion of a script's typographic requirements.
- **Visual-regression tools** (Percy, Chromatic, BackstopJS) catch a change
  against a previous screenshot. They cannot catch a page that has always
  been wrong, which is the normal state of a language nobody on the team
  reads.
- **`melliforge/fitlocale`** is the closest in intent and was pushed on
  2026-10-21 with 0 stars. Somebody else has seen the same gap, which is a
  reason to move rather than a reason not to.

**Evidence the problem is real and long-standing:** the W3C Indic
internationalisation list has a 2013 thread on `letter-spacing` breaking the
shirorekha
([public-i18n-indic](https://lists.w3.org/Archives/Public/public-i18n-indic/2013OctDec/0013.html)),
and Spotify has an open community thread about Devanagari lyrics rendering
with overlapping lines
([community.spotify.com](https://community.spotify.com/t5/Other-Podcasts-Partners-etc/Please-fix-the-line-height-of-lyrics-in-Devnagari-Script/td-p/5342153)).
These are not obscure projects without the means to fix them. They are
projects with no way to *find* them.

**Verdict: build.** `CSS.getPlatformFontsForNode` makes the hard part a single
protocol call, nothing packages it, and the first run against this repo's own
production site returned 469 findings behind a green build.

## Where this leaves the plan

| Was planned | Now |
|---|---|
| `verify-deploy` | **Build** — a real hole, and built |
| `preflight` | **Narrow** — keep multi-source, healing, fix commands; point at t3-env for the rest |
| `probe` | **Build, narrowed** — the overflow sweep, as a check rather than a driver |
| `prerender` | **Drop** — keep only route-config generation, if anything |
| `lingo` | **Drop** — document the pattern |
| `tenant` | **Drop** — document the trap |
| `provision` | **Drop** — document the two rules |

Seven packages becomes **two and a half**, and the project gets much easier to
explain: *things that catch deployment lies, which nobody else packages.*

That is also the better route to adoption. Tools get picked up for a small API
surface and an unsolved problem, not for breadth — and a toolkit that
duplicates envalid, Astro and Terraform invites the reader to notice.
