import type { Measured } from './analyse.js';

/**
 * What the page can measure about itself.
 *
 * Everything except which font actually drew the glyphs, which no web API
 * exposes -- that comes from the debugging protocol, keyed on `probe`.
 */
export type Collected = Omit<Measured, 'resolvedFonts'> & {
  /**
   * A selector that matches this element and nothing else, used to find it
   * again from outside the page. Not for human consumption; `selector` is.
   */
  readonly probe: string;
};

/** The attribute the page script tags candidates with, then removes. */
export const PROBE_ATTR = 'data-glyphcheck';

/**
 * Runs in the page. Written as a string because it has to be, and kept free
 * of judgement because judgement belongs in analyse.ts where it can be
 * tested: this returns numbers and never decides anything.
 */
export const COLLECT_SCRIPT = `(() => {
  const ATTR = ${JSON.stringify(PROBE_ATTR)};

  /* A cheap pre-filter. Anything beyond Latin and its extensions is worth
     measuring; the real script decision is made outside the page, against a
     table that can be tested. Latin Extended Additional falls inside this
     range, so some Vietnamese arrives and is then set aside -- a few extra
     measurements cost less than a second pass. */
  const NON_LATIN = /[\\u0370-\\u1FFF\\u2C00-\\uD7FF\\uF900-\\uFAFF]/;

  const describe = (el) => {
    const parts = [];
    let node = el;
    for (let depth = 0; node && depth < 4 && node.nodeType === 1; depth += 1) {
      if (node.id) { parts.unshift('#' + node.id); break; }
      let s = node.tagName.toLowerCase();
      const cls = (node.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean);
      if (cls.length) s += '.' + cls.slice(0, 2).join('.');
      parts.unshift(s);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  /* The box that would actually cut the ink off.
     Comparing ink against the element's own content box reports every
     paragraph whose glyphs reach a pixel past their line box, which is most
     of them and none of which a reader ever notices. What a reader notices
     is text meeting an edge that hides it, so the box to measure against is
     the nearest ancestor that clips -- or nothing, if none does. */
  const clippingBox = (el) => {
    let node = el;
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      const hides = (v) => v === 'hidden' || v === 'clip' || v === 'scroll' || v === 'auto';
      if (hides(cs.overflowY) || hides(cs.overflowX) || cs.webkitLineClamp !== 'none') {
        const r = node.getBoundingClientRect();
        const padTop = parseFloat(cs.paddingTop) || 0;
        const padBottom = parseFloat(cs.paddingBottom) || 0;
        const borderTop = parseFloat(cs.borderTopWidth) || 0;
        const borderBottom = parseFloat(cs.borderBottomWidth) || 0;
        return {
          top: r.top + borderTop + padTop,
          bottom: r.bottom - borderBottom - padBottom,
        };
      }
      node = node.parentElement;
    }
    return undefined;
  };

  const out = [];
  let seq = 0;

  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;

    /* Only text the element holds directly. Measuring an element's whole
       subtree would report the same words again for every ancestor, and
       attribute a child's font-family to its parent. */
    const own = [];
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.nodeValue && n.nodeValue.trim()) own.push(n);
    }
    if (own.length === 0) continue;

    const text = own.map((n) => n.nodeValue).join('').replace(/\\s+/g, ' ').trim();
    if (!text || !NON_LATIN.test(text)) continue;

    const rects = [];
    for (const n of own) {
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width > 0 && r.height > 0) {
          rects.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
        }
      }
      range.detach();
    }
    if (rects.length === 0) continue;

    /* line-height: normal has no px value to read, so take the used value
       from the layout itself -- the gap between the tops of two lines. */
    let lineHeightPx = parseFloat(cs.lineHeight);
    if (!isFinite(lineHeightPx)) {
      const tops = [...new Set(rects.map((r) => Math.round(r.top * 100) / 100))].sort((a, b) => a - b);
      let gap = 0;
      for (let i = 1; i < tops.length; i += 1) {
        const d = tops[i] - tops[i - 1];
        if (d > 0.5 && (gap === 0 || d < gap)) gap = d;
      }
      lineHeightPx = gap;
    }

    const letterSpacingPx = cs.letterSpacing === 'normal' ? 0 : (parseFloat(cs.letterSpacing) || 0);
    const clip = clippingBox(el);
    const probe = '[' + ATTR + '="' + seq + '"]';
    el.setAttribute(ATTR, String(seq));
    seq += 1;

    out.push({
      probe,
      selector: describe(el),
      tag: el.tagName,
      text: text.slice(0, 160),
      declaredFamilies: null,          /* parsed outside the page */
      rawFontFamily: cs.fontFamily,
      fontSizePx: parseFloat(cs.fontSize) || 0,
      lineHeightPx,
      letterSpacingPx,
      textTransform: cs.textTransform,
      direction: cs.direction,
      textAlign: cs.textAlign,
      lineBoxes: rects,
      contentTop: clip ? clip.top : 0,
      contentBottom: clip ? clip.bottom : 0,
      clipped: Boolean(clip),
    });
  }
  return out;
})()`;

/** Takes the attributes back off, so a page left open is not left marked. */
export const CLEANUP_SCRIPT = `(() => {
  const els = document.querySelectorAll('[${PROBE_ATTR}]');
  for (const el of els) el.removeAttribute(${JSON.stringify(PROBE_ATTR)});
  return els.length;
})()`;

/** The shape the page script actually returns, before the stack is parsed. */
export interface RawCollected extends Omit<Collected, 'declaredFamilies'> {
  readonly declaredFamilies: null;
  readonly rawFontFamily: string;
}
