/**
 * The part that has to run inside the page.
 *
 * Shipped as a string so it can be handed to anything that evaluates
 * JavaScript in a browser — Playwright's `page.evaluate`, Puppeteer's, a raw
 * CDP `Runtime.evaluate`, or a `<script>` tag in a console. That is what makes
 * this usable without choosing a browser driver for you.
 *
 * It only measures. Every judgement lives in analyse.ts, where it can be
 * tested without a browser.
 */

/** Matches the Measured type in analyse.ts. Kept in sync by the round-trip
 *  test rather than by a shared import, because this code is serialised. */
export const COLLECT_SOURCE = String.raw`
(function () {
  var doc = document.documentElement;
  var viewport = doc.clientWidth;
  var scrollWidth = doc.scrollWidth;

  function label(el) {
    var name = el.tagName.toLowerCase();
    if (el.id) return name + '#' + el.id;
    var cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean);
    if (cls.length) {
      // Three classes is enough to find it; a utility-class soup is not.
      return name + '.' + cls.slice(0, 3).join('.') + (cls.length > 3 ? '…' : '');
    }
    return name;
  }

  function pathOf(el) {
    var parts = [];
    for (var n = el; n && n.nodeType === 1 && n !== doc.parentNode; n = n.parentElement) {
      parts.unshift(label(n));
      if (parts.length > 6) break;
    }
    return parts.join(' > ');
  }

  // An ancestor that scrolls or clips horizontally, and whose own right edge
  // is inside the viewport, is holding this element rather than being pushed
  // by it.
  function clippedBy(el) {
    for (var n = el.parentElement; n && n !== doc; n = n.parentElement) {
      var s = getComputedStyle(n);
      var ox = s.overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') {
        if (n.getBoundingClientRect().right <= viewport + 1) return true;
      }
    }
    return false;
  }

  var out = [];
  var all = document.body ? document.body.querySelectorAll('*') : [];
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.right <= viewport + 1) continue;

    var style = getComputedStyle(el);
    var position = style.position;

    var depth = 0;
    for (var p = el; p; p = p.parentElement) depth++;

    out.push({
      selector: label(el),
      path: pathOf(el),
      left: r.left,
      right: r.right,
      width: r.width,
      clipped: clippedBy(el),
      fixed: position === 'fixed' || position === 'sticky',
      depth: depth
    });

    // A page with thousands of overflowing elements has one cause and a lot
    // of children; the first few hundred are more than enough to find it.
    if (out.length >= 400) break;
  }

  return { viewport: viewport, scrollWidth: scrollWidth, measurements: out };
})()
`;

export type Collected = {
  viewport: number;
  scrollWidth: number;
  measurements: import('./analyse.js').Measured[];
};

/** Anything that can run a JavaScript expression in the page and give back
 *  the value. `page.evaluate` in Playwright and Puppeteer both satisfy it. */
export type Evaluate = (expression: string) => Promise<unknown>;

export async function collect(evaluate: Evaluate): Promise<Collected> {
  const raw = (await evaluate(COLLECT_SOURCE)) as Collected | undefined;
  if (!raw || typeof raw.viewport !== 'number') {
    throw new Error(
      'overflow: the page returned no measurements. The evaluate function must ' +
        'return the expression value, not a handle to it.',
    );
  }
  return raw;
}
