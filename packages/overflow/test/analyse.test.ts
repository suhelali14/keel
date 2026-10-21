/**
 * The judgement, tested without a browser.
 *
 * This is the half that decides whether the tool is useful. A sweep that
 * reports every element whose right edge passes the viewport produces dozens
 * of findings, most of them children of one real cause and several of them
 * inside a scroller that is meant to scroll. Nobody keeps a check like that
 * switched on, so the dismissal rules matter more than the detection.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse, explain, type Measured } from '../src/analyse.js';

const el = (over: Partial<Measured> & { selector: string; path: string }): Measured => ({
  left: 0,
  right: 0,
  width: 0,
  clipped: false,
  fixed: false,
  depth: 2,
  ...over,
});

test('a page that fits reports nothing', () => {
  const a = analyse([], 390, 390);
  assert.equal(a.overflow, 0);
  assert.equal(a.causes.length, 0);
  assert.deepEqual(explain(a), []);
});

test('a one-pixel overflow is tolerated, because sub-pixel layout is normal', () => {
  const a = analyse([], 390, 391);
  assert.equal(a.causes.length, 0, 'a 1px difference must not fail a build');
});

test('the element wider than the viewport is named', () => {
  const a = analyse(
    [el({ selector: 'table.chart', path: 'html > body > table.chart', left: 0, right: 520, width: 520 })],
    390,
    520,
  );
  assert.equal(a.causes.length, 1);
  assert.equal(a.causes[0]!.selector, 'table.chart');
  assert.equal(a.causes[0]!.exceedsBy, 130);
  assert.match(a.causes[0]!.why, /520px wide in a 390px viewport/);
});

test('an element inside a horizontal scroller is dismissed, not reported', () => {
  // The exact false positive that made an earlier version of this useless:
  // a tab strip inside overflow-x:auto has a right edge far past the
  // viewport and is not the problem. Six of these were reported while the
  // real cause -- a table elsewhere -- was buried.
  const a = analyse(
    [
      el({ selector: 'button.tab', path: 'html > body > div.tabs > button.tab', left: 300, right: 760, width: 460, clipped: true }),
      el({ selector: 'table.chart', path: 'html > body > table.chart', left: 0, right: 420, width: 420 }),
    ],
    390,
    420,
  );
  assert.equal(a.causes.length, 1);
  assert.equal(a.causes[0]!.selector, 'table.chart');
  assert.match(a.dismissed.map((d) => d.why).join(' '), /clipped, not causing/);
});

test('a fixed or sticky element is dismissed — it does not extend the document', () => {
  const a = analyse(
    [
      el({ selector: 'header.rail', path: 'html > body > header.rail', left: 0, right: 500, width: 500, fixed: true }),
      el({ selector: 'div.wide', path: 'html > body > div.wide', left: 0, right: 450, width: 450 }),
    ],
    390,
    450,
  );
  assert.deepEqual(a.causes.map((c) => c.selector), ['div.wide']);
  assert.match(a.dismissed.map((d) => d.why).join(' '), /fixed or sticky/);
});

test('when several elements are too wide, the outermost is blamed', () => {
  // The rule that decides whether this tool is worth running. A 738px table
  // in a 320px viewport pushes its cells past the edge too, and a first
  // version reported five 90px <td> elements -- true, and useless. The table
  // is the thing you can actually change.
  const a = analyse(
    [
      el({ selector: 'table#wide', path: 'html > body > div.frame > table#wide', left: 0, right: 738, width: 738 }),
      el({ selector: 'td', path: 'html > body > div.frame > table#wide > tr > td', left: 648, right: 738, width: 90, depth: 6 }),
    ],
    320,
    738,
  );
  assert.equal(a.causes.length, 1);
  assert.equal(a.causes[0]!.selector, 'table#wide');
  assert.match(a.dismissed.map((d) => d.why).join(' '), /pushed out by a wider ancestor/);
});

test('nested oversized elements report the outer one only', () => {
  const a = analyse(
    [
      el({ selector: 'div.wrap', path: 'html > body > div.wrap', left: 0, right: 600, width: 600 }),
      el({ selector: 'pre.code', path: 'html > body > div.wrap > pre.code', left: 0, right: 600, width: 600, depth: 4 }),
    ],
    390,
    600,
  );
  assert.equal(a.causes.length, 1);
  assert.equal(a.causes[0]!.selector, 'div.wrap');
  assert.match(a.dismissed[0]!.why, /carried by div\.wrap, which is the wider element/);
});

test('with nothing oversized, the innermost pushed-out element is blamed', () => {
  // No ancestor to blame, so the specific element with the offending
  // geometry is the useful answer. The opposite rule to the one above, and
  // deliberately so.
  const a = analyse(
    [
      el({ selector: 'div.row', path: 'html > body > div.row', left: 300, right: 450, width: 150 }),
      el({ selector: 'span.badge', path: 'html > body > div.row > span.badge', left: 370, right: 450, width: 80, depth: 4 }),
    ],
    390,
    450,
  );
  assert.equal(a.causes.length, 1);
  assert.equal(a.causes[0]!.selector, 'span.badge');
  assert.match(a.causes[0]!.why, /starts at 370px and is 80px wide/);
  assert.match(a.dismissed[0]!.why, /more specific cause/);
});

test('causes are ordered by how far they reach, and capped', () => {
  const many: Measured[] = Array.from({ length: 30 }, (_, i) =>
    el({ selector: `div.n${i}`, path: `html > body > div.n${i}`, left: 0, right: 400 + i, width: 400 + i }),
  );
  const a = analyse(many, 390, 429, { maxCauses: 3 });
  assert.equal(a.causes.length, 3);
  assert.deepEqual(a.causes.map((c) => c.selector), ['div.n29', 'div.n28', 'div.n27']);
});

test('zero-width elements never appear', () => {
  const a = analyse(
    [
      el({ selector: 'div.ghost', path: 'html > body > div.ghost', left: 0, right: 900, width: 0 }),
      el({ selector: 'div.real', path: 'html > body > div.real', left: 0, right: 420, width: 420 }),
    ],
    390,
    420,
  );
  assert.deepEqual(a.causes.map((c) => c.selector), ['div.real']);
});

test('an overflow nobody can be blamed for says so, rather than passing', () => {
  // A margin, a transform or a pseudo-element produces this. Silently
  // reporting "no causes" would read as a pass.
  const a = analyse([], 390, 500);
  assert.equal(a.overflow, 110);
  assert.equal(a.causes.length, 0);
  const text = explain(a).join('\n');
  assert.match(text, /110px of overflow/);
  assert.match(text, /no element could be blamed/);
  assert.match(text, /margin, a transform or a pseudo-element/);
});

test('explain names the width, the element and the path', () => {
  const a = analyse(
    [el({ selector: 'table.chart', path: 'html > body > main > table.chart', left: 0, right: 520, width: 520 })],
    390,
    520,
  );
  const text = explain(a).join('\n');
  assert.match(text, /390px viewport scrolls to 520px/);
  assert.match(text, /table\.chart/);
  assert.match(text, /130px past the edge/);
  assert.match(text, /html > body > main > table\.chart/);
});

test('tolerance is configurable for pages with a known rounding quirk', () => {
  const m = [el({ selector: 'div.x', path: 'html > body > div.x', left: 0, right: 393, width: 393 })];
  assert.equal(analyse(m, 390, 393).causes.length, 1);
  assert.equal(analyse(m, 390, 393, { tolerance: 5 }).causes.length, 0);
});
