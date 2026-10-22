# @nayaverse/glyphcheck

Find the text faults you cannot see in a script you cannot read.

```bash
npx @nayaverse/glyphcheck https://example.com/hi
```

```
https://example.com/hi
  scripts   Devanagari
  examined  374 text element(s) at 390px, 1280px

critical  font-fallback  -  128 elements, every width
  Devanagari text rendered in Nirmala UI, which the stylesheet never asked for.
  fix  Name a Devanagari face in this stack. A Latin face carries no Devanagari
       glyphs, so the browser walks the stack per glyph and takes the first font
       that has them -- which is whatever the operating system supplies once your
       own families run out.

    main > p.lede
      "तुम्ही काय विकता, काय शिल्लक आहे"
      declared: ibm plex sans variable, ibm plex sans | rendered: Nirmala UI
```

Your CI is green. The page scores 100 on Lighthouse. The font file serves with
a `200`. The stylesheet names the right family. And the whole page is set in
the Windows UI font, because a Latin face has no Devanagari glyphs and the
stack ran out of your fonts before it reached one that did.

Nobody on the team reads Marathi, so nobody notices. The customers who do read
it assume the site just looks like that.

## This was found this way

The first thing this tool was ever pointed at was the author's own production
site. It found **469 text faults** across two languages, including every
paragraph of Marathi and Hindi rendering in `Nirmala UI` instead of the IBM
Plex Sans Devanagari the build was shipping, serving and paying for.

That bug had survived a typechecked build, a prerender step that asserts on
page content, a byte-floor check against the live deployment, a seven-width
overflow sweep, and 25 hand-computed contrast pairs. None of them can see it,
because none of them asks the browser which font actually drew the glyphs.

## What it checks

| Rule | What it means |
|---|---|
| `font-fallback` | The glyphs were drawn by a font your stylesheet never named. |
| | **critical** when the page ships a face for that script and one stack forgot it. **moderate** when the page ships none, which is a strategy to confirm rather than a bug. |
| `line-collision` | Lines of text overlap, so one line's marks sit inside another's. |
| `glyph-clipping` | Text is cut off by a box whose height was decided by Latin. |
| `tracking-damage` | `letter-spacing` is severing a script whose letters connect. |
| `case-transform` | `text-transform` on a script that has no letter case. |
| `direction-missing` | Right-to-left text laid out left to right. |
| `physical-text-align` | `text-align: left/right` hard-coded inside `rtl`. |

Across 28 scripts: Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil,
Telugu, Kannada, Malayalam, Sinhala, Thai, Lao, Khmer, Myanmar, Tibetan,
Arabic, Hebrew, Syriac, Thaana, Ethiopic, Hangul, Kana, Han, Armenian,
Georgian, Greek, Cyrillic, Latin.

The rules are script-aware, not language-aware, because typography is. Marathi
and Hindi are different languages in one script and need identical treatment;
Punjabi is written in two scripts that need opposite treatment. So the table
keys on the script, and the same rule asks a different question of each one:

- `letter-spacing: 0.1em` on Devanagari is a **finding** — it breaks the
  shirorekha, the line along the top that the letters hang from, and the word
  becomes a row of dashes.
- The same declaration on Tamil is **not** a finding. Tamil has stacked marks
  but no connecting headline, so tracking there is a style choice.
- `text-transform: uppercase` on Cyrillic is **fine**. On Devanagari it is a
  finding — not because it looks wrong, but because it does nothing, which
  means the rule was written for Latin and never re-read. Where the element
  mixes scripts it uppercases only the Latin half.

## Why it needs a browser

There is no web API that tells you which font drew a run of text.
`document.fonts` tells you which faces *loaded*. `getComputedStyle().fontFamily`
tells you which were *asked for*. Both said the page above was correct.

The Chrome DevTools Protocol has `CSS.getPlatformFontsForNode`, which answers
the real question per element, with a glyph count:

```json
{ "text": "थेट मजकुराकडे जा",
  "used": ["Nirmala UI (14 glyphs)", "IBM Plex Sans (2 glyphs)"] }
```

That command is the whole reason this check did not already exist.

## Install

```bash
npm i -D @nayaverse/glyphcheck
```

Needs a Chrome with remote debugging, which every CI runner already has:

```bash
chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/gc about:blank
npx glyphcheck https://example.com/hi
```

Already running Playwright? Skip the browser setup and check the page you are
already on — which matters, because the state worth checking is often three
clicks into a flow and has no URL of its own:

```ts
import { checkPage } from '@nayaverse/glyphcheck/playwright';
import { expect, test } from '@playwright/test';

test('the Hindi checkout is set in the fonts we ship', async ({ page }) => {
  await page.goto('/hi/checkout');
  await page.getByRole('button', { name: 'आगे बढ़ें' }).click();

  const result = await checkPage(page);
  expect(result.findings, result.findings.map((f) => f.summary).join('\n')).toEqual([]);
});
```

Chromium only. `CSS.getPlatformFontsForNode` is a Chrome command, and no other
engine exposes the resolved font.

## In CI

```yaml
- name: Every script renders in the fonts we ship
  run: |
    chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/gc about:blank &
    until curl -sf http://127.0.0.1:9222/json/version >/dev/null; do sleep 1; done
    for page in hi mr ta ar; do
      npx glyphcheck "https://example.com/$page" --ci || fail=1
    done
    exit "${fail:-0}"
```

`--ci` adds one `::error::` annotation per rule, not per element: a hundred
annotations for one line of CSS buries every other check in the run.

Exits non-zero on any finding, so it gates a deploy rather than producing a
report nobody opens.

## Options

```
--widths a,b         viewport widths (default 390,1280)
--height <n>         viewport height (default 900)
--settle-ms <n>      wait after navigation for fonts (default 1200)
--only <a,b>         run just these rules
--skip <a,b>         run everything except these rules
--examples <n>       example elements listed per rule (default 4, 0 for all)
--tracking-em <n>    letter-spacing to tolerate, in em (default 0.015)
--max-elements <n>   stop after this many text elements (default 400)
--endpoint <url>     running Chrome (default http://127.0.0.1:9222)
--ci                 add ::error:: annotations for GitHub Actions
--json               print the full result as JSON
```

More than one width by default, because two of the rules only have an answer
at a given width: lines can only collide once the text wraps, and a box can
only clip once the text is too tall for it. A stylesheet that is right on a
desktop and broken on a phone is the common case.

## As a library

```ts
import { check } from '@nayaverse/glyphcheck';

const result = await check('https://example.com/hi', { widths: [390] });
for (const f of result.findings) {
  console.log(f.impact, f.rule, f.selector, f.summary);
}
```

`analyse(measured, options)` is exported separately and is pure: measurements
in, findings out, no browser. Every rule is tested against numbers typed by
hand rather than against a page that has to be loaded and trusted.

## What it does not do

Worth stating, because a checker that implies more coverage than it has is
worse than none.

- **No tofu detection.** Rendering `□□□` for missing glyphs is the most
  visible fault of all, and it is not here: every way to detect it from
  outside the font file is a heuristic, and a heuristic in a list of measured
  rules drags the credibility of all of them down. Seven rules that are right
  beat eight where one guesses.
- **No shaping verification.** It does not know whether a Devanagari conjunct
  was composed correctly or an Arabic word joined properly — only that the
  font which drew it was one you chose. A broken font that renders is a
  broken font that passes.
- **No translation quality.** It checks typography, not meaning.
- **One physical-offset rule, not the family.** `margin-left` inside `rtl` is
  usually a bug and sometimes deliberate, and a rule with that hit rate
  teaches people to ignore the output. Only `text-align` is checked, where the
  intent is unambiguous.
- **Chromium only**, per above.
- **Font attribution is a proxy, not an oracle.** CDP gives a glyph count per
  font, never which codepoints each drew. So the font credited with the most
  glyphs is taken as the one that drew the script, and a run with fewer than
  60% of its drawable characters in that script is skipped rather than
  guessed at. [docs/SURVEY.md](https://github.com/suhelali14/keel/blob/main/docs/SURVEY.md)
  has the three real pages that forced that rule into shape.
- **Four of the seven rules have no field evidence.** A survey of 11
  multilingual pages fired `line-collision`, `font-fallback` and
  `glyph-clipping`, and nothing else. The other four are unit-tested against
  deliberately broken fixtures, which is not the same as knowing the fault
  happens in the wild.

## Design notes

Three decisions that came out of pointing it at a real page, each of which
turned a wall of true-but-useless output into something readable:

**Severity follows the text, not just the style.** A language picker listing a
bare `اردو` with no `dir="rtl"` renders identically either way — every letter
in it is strongly right-to-left. The same missing attribute around a sentence
with a date or a price in it puts those on the wrong end of the line. The
first is reported as `moderate`, the second as `critical`. Reporting both as
critical is how a checker earns the reputation that gets it switched off.

**A neutral character's position depends on where it sits.** A comma between
two right-to-left letters resolves to right-to-left and lands correctly even
in a left-to-right box. A trailing full stop has only the paragraph direction
to take, and ends up on the left of the sentence. So the rule tests the edges
of the run, not the middle.

**Text hidden for a screen reader is not clipped text.** The `.sr-only`
pattern is a 1px box with `overflow: hidden` holding real text at a real font
size, every line of which escapes on purpose. The first run against a real
page reported seven of them. A box far too short to hold one line of its own
text is the author hiding it, not a layout accident.

## Licence

MIT. Part of [keel](https://github.com/suhelali14/keel).
