# What these four packages are worth

An honest accounting of what the `@nayaverse` packages solve, what they cost,
and what they save — measured where measurement was possible, and labelled
where it was not.

## How to read this

**The sample size is one project.** Every "before" number here comes from one
real pipeline deploying one real site for one paying customer. That is enough
to say the bugs were real and the fixes worked. It is not enough to claim an
industry-wide saving, and this document does not.

**What is measured:** lines of code, test counts, the exact diff that replaced
hand-rolled shell, and the exact number of faults found and fixed. All of it
is reproducible from `git log` and `npm test`.

**What is not claimed:** developer-hours saved, money saved, adoption, or any
figure multiplied across "teams" or "developers worldwide". Those numbers get
invented, and one invented number discredits the measured ones next to it.

---

## Summary

| Package | Code¹ | Tests | Deps | Status | What it replaced here |
|---|---|---|---|---|---|
| **verify-deploy** | 381 | 10 | 0 | In CI, production | **43 lines of shell → 6** |
| **overflow** | 563 | 13 | 0 | In CI, production | Screenshots, which gave the wrong answer |
| **preflight** | 364 | 17 | 0 | **Published, not yet used** | Nothing yet |
| **glyphcheck** | 1,081 | 51 | 0 | Published, used by hand | Nothing — no tool did this |
| | **2,389** | **91** | **0** | | |

¹ Lines of actual code, excluding blank lines and comments. The source files
are **3,357 lines** in total, so roughly 29% of them are comments — which is
deliberate in a repo whose whole claim is that it encodes specific failures,
and is why the two figures differ. Tests add a further **1,174 lines**.

Two of the four are genuinely in production. One is published and unused. One
is published and has been run by hand but is not yet a gate. Saying otherwise
would be the easiest lie in this document.

---

## 1. verify-deploy — the only package here with a clean before/after

**The problem.** A build can be green, write every page, with correct bytes,
correct language, titles and canonicals present — and a third of the site can
return 404, because the files are filed under names the host never looks for.
No build-time check can see this. The artifact is perfect. The system is
broken.

**The measured swap.** Commit `2d1c2ea`:

```
43 lines of YAML and shell   ->   6 lines
```

```yaml
- run: |
    npx verify-deploy \
      --site https://www.nayaverse.in \
      --build "${{ github.sha }}" \
      --min-bytes 9000 --retries 8 --wait-ms 15000 \
      --routes ".,pricing,hi,hi/pricing,mr,mr/pricing,robots.txt,sitemap.xml"
```

**But the 43 lines are not the cost.** This is the part that matters, and it
is the whole argument for the package existing:

`git log` on that one workflow file shows **15 commits**. At least three of
them exist only because the live check was wrong in a way that reached
production:

| Commit | What it was fixing |
|---|---|
| `3da3ae5` | Serve the pages at the URLs they call canonical, *and fetch them to prove it* |
| `9e76f8f` | Scope the live check to the app it fits, and stop two deploy paths racing |
| `acbbf23` | Check the address customers use, and pin it to the build being deployed |

Three specific bugs, each found the expensive way:

1. **An auth wall read as a routing fault.** The check interrogated a
   `*.vercel.app` URL behind deployment protection. It answered `404` in 107
   bytes and `302` on `robots.txt`. The obvious reading is "the routing table
   is broken" — so time went into fixing a file layout that was never wrong.
2. **`robots.txt` held to a document's byte floor**, so either it failed or
   the floor was dropped for everything.
3. **The summary printed `0 of 0 route(s) failed`** for a run that failed
   before examining any route. That reads exactly like success.

The package carries fixes for all three. So what a team adopting it skips is
not 37 lines of typing — it is the three production incidents that taught
those 37 lines their shape. That is the real saving, and it is not countable
in lines.

---

## 2. overflow — a capability the pipeline did not have

**The problem.** Responsive breakage was checked by taking screenshots and
looking at them.

**What that cost.** A layout was "fixed" for a bug that did not exist. Chrome
on Windows cannot open a window narrower than roughly 494px, so every "390px"
capture was a desktop layout clipped to 390 — which looks exactly like
horizontal overflow, in a layout that was fine.

The package uses `Emulation.setDeviceMetricsOverride`, which is the only
honest narrow viewport, and names the element:

```
  320px  ok      360px  ok      390px  ok      414px  ok
  768px  ok     1024px  ok     1440px  ok

No horizontal overflow at any of 7 width(s).
```

**Honest accounting:** this step *added* 43 lines to the workflow rather than
removing any, because Chrome has to be started and waited for. It replaced
zero lines of CI and an unbounded amount of looking at pictures. Counting it
as a line saving would be dishonest; it is a correctness saving.

One design decision worth the 563 lines: when several elements are too wide,
the **outermost** is blamed; when nothing is oversized but something is pushed
out, the **innermost** is blamed. Get that backwards and the tool reports the
`<td>` instead of the table, and the person fixing it edits the wrong rule.

---

## 3. preflight — published, and not yet earning anything

**The intended problem.** A deploy that is going to fail should fail in
seconds, not after 2.5 GB has been pulled, a schema has been migrated and a
container has been restarted.

**Status: not wired into anything.** 364 lines, 17 tests, published at 0.1.1,
used by no pipeline including this one. Its README already says to use
[t3-env](https://env.t3.gg/) instead if you only have one process.

It is in this table for completeness, not as a win. A package the author does
not use is visible from a mile away, and the honest thing is to say so here
rather than let the row imply otherwise.

---

## 4. glyphcheck — the one that found something nothing else could

**The problem.** No web API tells you which font actually drew a run of text.
`document.fonts` reports which faces *loaded*. `getComputedStyle` reports
which were *asked for*. Both reported this site as correct.

**What was actually true.** Every Marathi and Hindi paragraph on
`nayaverse.in` was set in **Nirmala UI**, the Windows system font — not the
IBM Plex Sans Devanagari the build was shipping, serving and paying for. A
Latin face has no Devanagari glyphs, so the browser walks the stack per glyph
and takes the first font that has them. The stack ended at `system-ui`, which
is Segoe UI on Windows, which has none either.

**What that bug had already survived:**

- a typechecked build
- a prerender step that asserts on page content and fails on a wrong status word
- a byte-floor check against the live deployment, pinned to the build sha
- a seven-width overflow sweep in three languages
- 25 contrast pairs computed from the shipped stylesheet
- a check that the font family name was present in the served CSS
- the font file itself serving `200`, 77 KB, correct `unicode-range`

Every one of those passed. None of them asks the browser which font drew the
glyphs.

### The measured result

| | Findings |
|---|---|
| First run, `nayaverse.in/mr` | **589** (308 critical) |
| After the fixes | **0**, across 8 pages × 4 widths × 2 languages |

**Seven distinct root causes**, all in CSS, all invisible to everyone on the
project because nobody here reads these scripts well enough to notice a page
is in the wrong font:

1. The `body` stack never named the Devanagari face.
2. Five of six monospace stacks didn't either (`.t-row` was the only correct one).
3. Two Barlow display stacks didn't, so button labels fell to the system font.
4. Nine stencilled voices kept Latin uppercase and tracking in Devanagari —
   the stylesheet said in a comment that they shouldn't, and never did it.
5. Every override was written `:lang(hi) .cls`, which needs an *ancestor* in
   that language. The language switcher puts `lang` on the link itself, so the
   one place Devanagari appears on an English page was the one place nothing
   applied.
6. Display leading clipped the top matras out of a headline by 3px; heading
   leading still collided by 1.6px at 390px. Both measured, not guessed.
7. `lang="ur"` does not imply direction, so the Urdu entry laid out
   left-to-right.

**The fix was 71 lines added, 36 removed — net 35 lines of CSS.** 589 faults,
seven causes, 35 lines. That ratio is the point: these are not 589 problems,
they are seven one-line mistakes repeated across a stylesheet, and the only
hard part was knowing they were there.

### Why no tool did this

Searched and recorded in [PRIOR-ART.md](PRIOR-ART.md) §8:

- **Pseudo-localisation tools** (the most-starred is 141) transform Latin into
  accented Latin. They test that a layout survives longer strings. They never
  render Devanagari, Arabic or Thai, so they cannot surface anything about how
  those scripts lay out.
- **axe-core** (7,685 stars) and **Lighthouse** (30,921) check contrast, roles,
  labels, structure. Neither inspects a resolved font.
- **Visual regression** (Percy, Chromatic, BackstopJS) catches a *change*
  against a previous screenshot. It cannot catch a page that was always
  wrong — which is the normal state of a language nobody on the team reads.

Evidence the problem is real and old: the W3C Indic i18n list has a **2013**
thread on `letter-spacing` breaking the shirorekha, and Spotify has an open
community thread about Devanagari lyrics rendering with overlapping lines.
Those are not projects that lack the means to fix it. They lack a way to
*find* it.

---

## Where the effort actually goes

The line counts above are the least interesting numbers here. Collected in
one place:

| | Measured |
|---|---|
| Lines of shell removed from this pipeline | 43 |
| Lines of package call-site added | 6 |
| Commits to that one workflow file | 15 |
| Production failures that shaped the live check | 3 |
| Text faults found behind a green build | 589 |
| Root causes behind them | 7 |
| CSS lines changed to fix all 589 | 35 net |
| Runtime dependencies across all four packages | 0 |

Read down that list and the pattern is the same each time: **the typing was
never the cost.** Writing 43 lines of `curl` in a loop takes an afternoon.
Discovering that one of them misreads an auth wall as a routing fault takes a
production incident. Discovering that your Marathi pages have been in the
wrong font since launch takes a tool that does not exist.

What these packages package is not code. It is the set of things that had to
go wrong first.

---

## What this does not save

- **Not a replacement for tests.** None of these knows whether the feature
  works. They check that what shipped is what you built, and that it renders.
- **glyphcheck does not verify shaping.** It knows the font that drew a
  Devanagari conjunct was one you chose, not that the conjunct was composed
  correctly. A broken font that renders is a broken font that passes.
- **glyphcheck has no tofu detection.** `□□□` for missing glyphs is the most
  visible fault of all and is deliberately absent: every way to detect it from
  outside the font file is a heuristic, and one heuristic among measured rules
  drags all of them down.
- **overflow and glyphcheck need Chromium.** `CSS.getPlatformFontsForNode` is
  a Chrome DevTools Protocol command; no other engine exposes the resolved
  font.
- **preflight saves nothing today**, per §3.
- **None of this is free to run.** overflow and glyphcheck each need a headless
  Chrome in CI, which is wall-clock time on every deploy.

---

## Two things that would make this accounting better

1. **Wire glyphcheck into the pipeline.** It has found 589 real faults and is
   still run by hand, which means the next one will be found by hand too — or
   not at all. One step, next to the overflow sweep.
2. **Use preflight or drop it.** It is 364 lines and 17 tests of unexercised
   code with a README that points at a better alternative.

---

## Method

Every figure in this document came from one of:

```bash
# Package sizes, excluding blanks and comments
cat packages/*/src/*.ts | grep -vE '^\s*(//|/\*|\*)' | grep -vE '^\s*$' | wc -l

# Test counts
npm test                                    # 91 across four workspaces

# The shell-to-package swap
git show 2d1c2ea -- .github/workflows/deploy-static.yml

# How many times that file was corrected
git log --oneline -- .github/workflows/deploy-static.yml | wc -l

# The 589 findings, and the 0 after
npx glyphcheck https://www.nayaverse.in/mr --widths 390,1280
```

Dependency counts are read from each `package.json`. The 589 and the 0 are
`glyphcheck`'s own output against the live site before the fixes and the built
site after them. No figure here is an estimate, and no figure here is
extrapolated beyond this one project.
