# @nayaverse/overflow

**Find horizontal overflow at every breakpoint, in CI, and name the element.**

Zero dependencies. Node 20+. Works through Playwright, Puppeteer, or on its
own.

```bash
npm i -D @nayaverse/overflow
```

---

## Why this is not already solved

The problem is old and well written up —
[Smashing Magazine](https://www.smashingmagazine.com/2021/04/css-overflow-issues/),
[CSS-Tricks](https://css-tricks.com/?p=175021),
[Polypane](https://polypane.app/blog/strategies-for-dealing-with-horizontal-overflows/) —
and the technique is agreed: compare `scrollWidth` to `clientWidth`, then find
the elements whose right edge passes the viewport.

What you can actually install is a
[Chrome extension](https://chrome.google.com/webstore/detail/overflow-detector/gpdnihamialibcjfmdnfbjcljnfbgkbc/reviews),
a paid browser like [Polypane](https://polypane.app/) or
[Sizzy](https://sizzy.co/blog/fix-horizontal-scroll), or a console snippet.
All of them need a person to be looking, at one viewport, at one moment.

Nothing packaged **fails a build** across a list of breakpoints and tells you
which element to change.

---

## Use

### Standalone

```bash
# any Chrome with remote debugging
chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/ovf about:blank

npx overflow https://example.com
npx overflow https://example.com --widths 320,390,768 --tolerance 2
```

```
  320px  OVERFLOW 434px — table#wide-table
  390px  OVERFLOW 364px — table#wide-table
  768px  ok

320px viewport scrolls to 754px (434px of overflow)
  table#wide-table
    reaches 434px past the edge; it is 738px wide in a 320px viewport
    html > body > div.frame > table#wide-table

Horizontal overflow at 320, 390px.
```

Exit code is 1 when anything overflowed, so it gates a deploy.

### With Playwright

Prefer this if you already have Playwright — it sets the viewport correctly
by default, which is the part that matters.

```ts
import { sweepPage } from '@nayaverse/overflow/playwright';

test('no horizontal overflow', async ({ page }) => {
  await page.goto('/');
  const result = await sweepPage(page, { widths: [320, 390, 768, 1280] });
  expect(result.ok, result.report()).toBe(true);
});
```

`sweepPage` restores the viewport afterwards, so the next assertion in the
same test does not fail for a reason that is not its own.

### With anything else

```ts
import { checkViewport } from '@nayaverse/overflow';

const analysis = await checkViewport((expr) => page.evaluate(expr));
if (analysis.overflow > 0) console.log(analysis.causes);
```

`evaluate` is any function that runs a JavaScript expression in the page and
returns its value. Puppeteer, Playwright, a raw CDP session, or your own.

---

## What makes the output usable

Detection is the easy half. A sweep that reports every element whose right
edge passes the viewport produces dozens of findings, most of them children
of one real cause and several of them perfectly fine — and a check that cries
wolf gets switched off, after which it catches nothing.

So three things are dismissed, with the reason recorded in `analysis.dismissed`:

**An element inside a horizontal scroller.** A tab strip in
`overflow-x: auto` has a right edge far past the viewport and is doing
exactly what it was built to do. An early version of this reported six of
those while the real cause — a table elsewhere — sat unmentioned.

**A fixed or sticky element.** Out of flow, so it does not extend the
document.

**Children carried by a wider parent.** A 738px table in a 320px viewport
pushes its cells past the edge too. Reporting five 90px `<td>` elements is
true and useless; the table is the thing you can change. When something is
genuinely wider than the viewport, the **outermost** such element is blamed.
When nothing is oversized and an element is merely pushed right by a margin,
the rule inverts and the **innermost** is blamed, because there is no
oversized ancestor to point at.

And when the page overflows but nothing can be blamed, it says so rather than
passing — a margin, a transform or a pseudo-element is usually the answer, and
silence would read as success.

---

## The viewport trap this exists to avoid

**On Windows, Chrome cannot open a window narrower than about 494px.**

Launch with `--window-size=390,844` and the page lays out at 494px and is then
clipped to 390 — which looks exactly like a horizontal overflow bug, in a
layout that is completely fine. It is possible to spend hours fixing something
that was never broken. (That is not hypothetical; it is why this package
exists.)

The bundled driver always sets the viewport with
`Emulation.setDeviceMetricsOverride`, never a window size. Playwright does the
right thing by default, which is why most people never meet this — but anyone
driving Chrome directly walks straight into it.

---

## API

### `sweep(options)`

| Option | Type | Default | |
|---|---|---|---|
| `url` | `string` | — | page to check |
| `widths` | `number[]` | `320,360,390,414,768,1024,1440` | |
| `height` | `number` | `900` | |
| `settleMs` | `number` | `600` | wait after navigation for layout |
| `tolerance` | `number` | `1` | sub-pixel rounding is normal |
| `maxCauses` | `number` | `10` | |
| `cdp.endpoint` | `string` | `http://127.0.0.1:9222` | |

### `checkViewport(evaluate, options)` → `Analysis`

```ts
type Analysis = {
  viewport: number;
  scrollWidth: number;
  overflow: number;           // <= 0 means it fits
  causes: Cause[];            // what to change
  dismissed: { selector: string; why: string }[];
};
```

### `sweepPage(page, options)` — Playwright
### `analyse(measurements, viewport, scrollWidth, options)` — the pure judgement, if you collect measurements yourself

---

## Tests

The judgement is a pure function, so it is tested without a browser: thirteen
cases covering each dismissal rule, both blame directions, ordering, capping,
tolerance, and the overflow nobody can be blamed for.

The collection half is proven against real Chrome on fixtures built to be
wrong in known ways — a page that fits, a page with an oversized table, a page
whose only overflow is a scroller and a sticky header, and a page with both,
where only the table may be reported.

## Licence

MIT.
