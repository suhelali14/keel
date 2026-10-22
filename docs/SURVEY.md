# Pointing the packages at sites nobody here built

The question was whether these tools find anything on pages their authors were
paid to get right, or only on the one project they came from.

Run it yourself:

```bash
chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/survey about:blank
node scripts/survey.mjs --endpoint http://127.0.0.1:9222
```

The list is [`scripts/sites.mjs`](../scripts/sites.mjs) and it is meant to be
edited. One page per site, sequential, 2.5s apart, `robots.txt` honoured — a
measurement, not a crawl.

## The answer

11 pages tested across 6 scripts. **Every one had something.** But the useful
part is not that number, it is which rule found it:

| Rule | Critical | Serious | Moderate | Fires on |
|---|---|---|---|---|
| `line-collision` | 78 | 32 | 0 | **5 of 11 third-party pages** |
| `font-fallback` | 293 | 0 | 676 | critical on **1** page — ours |
| `glyph-clipping` | 0 | 6 | 0 | 2 pages |
| `tracking-damage` | 0 | 0 | 0 | nothing |
| `case-transform` | 0 | 0 | 0 | third-party: nothing |
| `direction-missing` | 0 | 0 | 0 | nothing |
| `physical-text-align` | 0 | 0 | 0 | nothing |

And `@nayaverse/overflow`, run on the same pages, found horizontal overflow on
**4 of 11** — Wikipedia Hindi at 1120px, all three BBC services at 1265px.

**`line-collision` is the rule that earns its place on other people's sites.**
Wikipedia Hindi overlaps its own Devanagari by 2.1px on 14px type at a
line-height of 1.2. BBC Arabic overlaps by 5px on 22px type at 1.36. Those are
visible, they are on pages with real editorial budgets, and nothing else
reports them.

**Four of seven rules fired on nothing at all.** That is recorded here rather
than quietly omitted. A rule that never fires on a real page is either sound
and rare, or wrong and silent, and there is no way to tell from a survey. Each
needs a deliberately broken fixture proving it *can* fire before it is
trusted — `tracking-damage` and `case-transform` have those in the unit tests;
`direction-missing` and `physical-text-align` have them too, but no third-party
evidence that the faults occur in the wild.

## What the survey was actually worth

Not the findings. **It corrected the headline rule four times**, and the first
version of that rule would have been indefensible in public.

**Pass 1 — it fired on all 11 sites, 904 elements.** Any rule that fires
everywhere is broken. Wikipedia and the BBC ship no Indic webfont and let the
system render Devanagari. That is a defensible decision — system Indic faces
are good and a webfont costs 100KB+ a script — and the rule was calling it
critical.

> **Fix:** split the rule in two. A page that ships *no* face for the script
> has made a choice, and is told so at `moderate`. The fault is
> **inconsistency** — the page has a face, proven by other text using it, and
> one stack forgot to name it. Only that is `critical`.

**Pass 2 — BBC Hindi still showed 154 critical.** Something there had
"proven" a Devanagari face. It was this:

```
text: "साइन इन"   rendered: Nirmala UI, Arial
```

Arial is declared, so the rule counted it as proof. Arial drew **the space**.
Nirmala UI drew the Devanagari.

> **Fix:** carry CDP's per-font glyph count instead of discarding it, and
> judge only the font credited with the most glyphs.

**Pass 3 — still wrong, on a subtler run.**

```
text: ", अवधि 9,55"   rendered: Nirmala UI (4), Arial (7)
```

Four Devanagari characters against seven digits and commas. Arial legitimately
holds the most glyphs, and `dominantScript` still calls the run Devanagari
because digits belong to no script. "Most glyphs" only identifies the script's
font when the run is mostly that script.

> **Fix:** a `scriptPurity` gate. Below 0.6 of the drawable characters, the
> run is skipped rather than guessed at. 0.6 rather than a bare majority
> because a Devanagari conjunct of three characters becomes one or two glyphs,
> so the script needs a clear majority of characters before it can be assumed
> to hold a majority of glyphs.

**Pass 4 — BBC Arabic showed 241 critical.** Its proof:

```
text: "عربي"   declared: times new roman   rendered: Times New Roman (4)
```

Times New Roman carries Arabic on Windows. So a declared family really did
draw the Arabic — but BBC Arabic ships no Arabic webfont. A system Latin font
happening to cover the script is not evidence that anyone chose a face for it.

> **Fix:** coverage requires `isCustomFont` — a face the page actually loaded
> through `@font-face`. CDP reports it per font and it was being thrown away.

**After all four:** `font-fallback` is critical on exactly one page in the
survey — the one that shipped a Devanagari webfont, served it, paid for it,
and never named it in the body stack. Which is the bug the rule was written
for.

## The conclusion worth drawing

The packages are worth something, and less than the first run suggested.

- **`line-collision` is the strongest claim.** It fires on major publishers,
  the faults are visible, and no other tool reports them.
- **`font-fallback` is narrow and correct.** It is a specific finding about a
  specific kind of waste — a font you ship and do not use — and it is rarer
  than one project implied. It is also the one that needed four corrections to
  be honest, and all four came from this survey.
- **`overflow` fires on 4 of 11 major sites**, which is a better hit rate than
  expected for a mature tool category.
- **Four rules have no field evidence at all.** Honest position: they are
  unit-tested, not validated.

None of this is extrapolated beyond 11 pages. A real version of this would
survey a few hundred, the way [the WebAIM
Million](https://webaim.org/projects/million/) does for accessibility, and
report rates rather than counts.

## Before publishing any of it

Aggregate numbers are fine to publish; a named company's bug in a marketing
post is a different thing. These are read-only measurements of public pages,
which is ordinary, but the courteous path for a specific fault is a bug report
to that team, not a screenshot in a launch thread. Wikipedia in particular
takes [Phabricator](https://phabricator.wikimedia.org/) tickets and would
rather have the collision report than read about it.
