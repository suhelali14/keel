import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  analyse,
  groupIntoLines,
  parseFontStack,
  resolvedFromStack,
  scriptPurity,
  type LineBox,
  type Measured,
} from '../src/analyse.js';
import { scriptByName } from '../src/scripts.js';

/**
 * Where a font came from, which the rules care about as much as its name.
 *
 * `web` is a face the page loaded through @font-face: evidence somebody chose
 * it. `sys` is a face that was already on the machine. A system Latin font
 * that happens to carry Arabic -- Times New Roman does -- is not evidence
 * that anyone picked a face for Arabic, and conflating the two had a BBC page
 * reported as inconsistent rather than as relying on system fonts.
 */
const web = (family: string, glyphCount: number) => ({ family, glyphCount, isCustomFont: true });
const sys = (family: string, glyphCount: number) => ({ family, glyphCount, isCustomFont: false });

/** A clean element. Each test breaks exactly one thing about it. */
const el = (over: Partial<Measured> = {}): Measured => ({
  selector: 'main > p',
  tag: 'P',
  text: 'तुम्ही काय विकता, काय शिल्लक आहे',
  declaredFamilies: ['ibm plex sans', 'ibm plex sans devanagari', 'sans-serif'],
  resolvedFonts: [web('IBM Plex Sans Devanagari', 28)],
  fontSizePx: 16,
  lineHeightPx: 24,
  letterSpacingPx: 0,
  textTransform: 'none',
  direction: 'ltr',
  textAlign: 'start',
  lineBoxes: [
    { top: 100, bottom: 118, left: 0, right: 300 },
    { top: 124, bottom: 142, left: 0, right: 260 },
  ],
  contentTop: 98,
  contentBottom: 144,
  clipped: false,
  ...over,
});

const rules = (ms: Measured[]) => analyse(ms).findings.map((f) => f.rule);

// ---------------------------------------------------------------------------
// The baseline. If this fails, every other test is meaningless.
// ---------------------------------------------------------------------------

test('a correctly set page produces no findings', () => {
  const r = analyse([el()]);
  assert.deepEqual(r.findings, []);
  assert.equal(r.ok, true);
  assert.equal(r.examined, 1);
  assert.deepEqual(r.scripts, ['Devanagari']);
});

test('Latin text is not examined, because the rules have nothing to say about it', () => {
  const r = analyse([el({ text: 'What you sell, and what is left' })]);
  assert.equal(r.examined, 0);
  assert.deepEqual(r.findings, []);
});

// ---------------------------------------------------------------------------
// parseFontStack
// ---------------------------------------------------------------------------

test('parses a stack with quotes, spaces and generics', () => {
  assert.deepEqual(
    parseFontStack(`"IBM Plex Sans Variable", 'IBM Plex Sans', system-ui, sans-serif`),
    ['ibm plex sans variable', 'ibm plex sans', 'system-ui', 'sans-serif'],
  );
});

test('a comma inside a quoted family name does not split it', () => {
  assert.deepEqual(parseFontStack(`"Foo, Bar", serif`), ['foo, bar', 'serif']);
});

// ---------------------------------------------------------------------------
// resolvedFromStack -- the match that decides the headline rule
// ---------------------------------------------------------------------------

test('a weight suffix on the reported face still counts as the declared family', () => {
  assert.equal(
    resolvedFromStack('IBM Plex Sans Devanagari SemiBold', ['ibm plex sans devanagari']),
    'ibm plex sans devanagari',
  );
  assert.equal(resolvedFromStack('Khand SemiBold', ['khand']), 'khand');
  assert.equal(resolvedFromStack('Inter 600 Italic', ['inter']), 'inter');
});

test('an extra word that is NOT a weight is a different family', () => {
  // The whole rule turns on this. "IBM Plex Sans Devanagari" is a prefix
  // match for a stack declaring only "IBM Plex Sans"; treating it as the
  // same family would report a clean page for the exact fallback being
  // hunted. Also the reverse: a Latin-only stack must not absorb it.
  assert.equal(resolvedFromStack('IBM Plex Sans Devanagari', ['ibm plex sans']), undefined);
  assert.equal(resolvedFromStack('Noto Sans Thai', ['noto sans']), undefined);
  assert.equal(resolvedFromStack('Arial Narrow', ['arial']), undefined);
});

test('generic keywords in the stack never satisfy a resolved family', () => {
  assert.equal(resolvedFromStack('Nirmala UI', ['system-ui', 'sans-serif']), undefined);
});

test('the most specific declared family is the one reported as the match', () => {
  assert.equal(
    resolvedFromStack('IBM Plex Sans Devanagari', ['ibm plex sans', 'ibm plex sans devanagari']),
    'ibm plex sans devanagari',
  );
});

// ---------------------------------------------------------------------------
// font-fallback
// ---------------------------------------------------------------------------

test('the real bug: Devanagari drawn in the Windows system font', () => {
  // As it actually stood on a live site: the Devanagari face was shipped,
  // served and loaded -- the status rows rendered in it -- and the body stack
  // never named it, so every paragraph fell through to the OS. That is what
  // makes it critical rather than a system-font strategy, and the covering
  // element below is what lets the rule tell the two apart.
  const r = analyse([
    el(),
    el({
      selector: 'main > p.lede',
      declaredFamilies: ['ibm plex sans variable', 'ibm plex sans', 'system-ui', 'sans-serif'],
      resolvedFonts: [
        sys('Nirmala UI', 26),
        web('IBM Plex Sans', 3),
      ],
    }),
  ]);
  const f = r.findings.find((x) => x.rule === 'font-fallback');
  assert.ok(f, 'expected a font-fallback finding');
  assert.equal(f.impact, 'critical');
  assert.equal(f.selector, 'main > p.lede');
  assert.match(f.summary, /Nirmala UI/);
  assert.match(f.detail, /declared: ibm plex sans variable, ibm plex sans/);
  // The glyph counts have to reach the report: they are the evidence that the
  // system font drew the script and the declared one drew the spaces.
  assert.match(f.detail, /Nirmala UI \(26\)/);
  assert.match(f.detail, /IBM Plex Sans \(3\)/);
});

test('a declared font credited with one glyph does not excuse the fallback', () => {
  // The exact false positive a survey of real sites exposed: a BBC page in
  // Hindi reported Arial alongside Nirmala UI, because Arial had drawn the
  // single space inside a two-word Devanagari run. Asking whether a declared
  // family appeared -- rather than whether it drew the script -- called that
  // page correct.
  const r = analyse([
    el(),
    el({
      declaredFamilies: ['arial', 'verdana', 'helvetica', 'sans-serif'],
      resolvedFonts: [
        sys('Nirmala UI', 14),
        sys('Arial', 1),
      ],
    }),
  ]);
  const f = r.findings.find((x) => x.rule === 'font-fallback');
  assert.ok(f, 'Arial drawing one space is not Arial rendering the Devanagari');
  assert.match(f.summary, /Nirmala UI/);
});

test('the font that drew the script being declared means there is no fault', () => {
  // The mirror image, and the other false positive this removes: a symbol
  // font drew a bullet, the author's face drew everything else.
  assert.ok(!rules([el({
    declaredFamilies: ['ibm plex sans devanagari', 'sans-serif'],
    resolvedFonts: [
      web('IBM Plex Sans Devanagari', 26),
      sys('Segoe UI Symbol', 1),
    ],
  })]).includes('font-fallback'));
});

test('a page with no face for the script at all is told, not accused', () => {
  // Wikipedia and the BBC ship no Devanagari webfont and let the system
  // render it. That is a defensible decision -- system Indic faces are good
  // and a webfont costs 100KB+ a script -- so it is reported as a decision
  // to make on purpose, not as a critical defect.
  const r = analyse([el({
    declaredFamilies: ['linux libertine', 'georgia', 'times'],
    resolvedFonts: [sys('Nirmala UI', 26)],
  })]);
  const f = r.findings.find((x) => x.rule === 'font-fallback');
  assert.ok(f);
  assert.equal(f.impact, 'moderate');
  assert.match(f.summary, /ships no Devanagari face/);
});

test('a page that DOES ship the face, with one element missing it, is critical', () => {
  // This is the bug the rule was written for and the one found on a real
  // site: the face is loaded and paid for, and one stack forgot to name it.
  const r = analyse([
    el(),                                             // uses the declared Devanagari face
    el({                                              // and this one does not
      selector: 'main > h2',
      declaredFamilies: ['barlow condensed', 'arial narrow'],
      resolvedFonts: [sys('Nirmala UI', 26)],
    }),
  ]);
  const f = r.findings.find((x) => x.rule === 'font-fallback');
  assert.ok(f);
  assert.equal(f.impact, 'critical');
  assert.match(f.summary, /does ship a Devanagari face/);
  assert.equal(f.selector, 'main > h2');
});

test('coverage is per script, not per page', () => {
  // Shipping a Devanagari face says nothing about Tamil.
  const r = analyse([
    el(),
    el({
      text: 'உங்கள் வணிகம் எப்படி நடக்கிறது',
      resolvedFonts: [sys('Nirmala UI', 26)],
    }),
  ]);
  const tamil = r.findings.find((x) => x.scriptLabel === 'Tamil' && x.rule === 'font-fallback');
  assert.ok(tamil);
  assert.equal(tamil.impact, 'moderate', 'no Tamil face was ever proven on this page');
});

test('collision severity follows how bad it is, not just that it happened', () => {
  const impactOf = (fontSizePx: number, overlap: number) =>
    analyse([el({
      fontSizePx,
      lineBoxes: [r(100, 118), r(118 - overlap, 136)],
    })]).findings.find((f) => f.rule === 'line-collision')?.impact;

  // 5px on 22px text is plainly visible; 1px on 16px is a squeeze nobody
  // reports. Both are collisions; ranking them alike buries the first.
  assert.equal(impactOf(22, 5), 'critical');
  assert.equal(impactOf(16, 1), 'serious');
});

test('a stack of nothing but generics is a choice, not a fault', () => {
  const r = analyse([el({
    declaredFamilies: ['system-ui', 'sans-serif'],
    resolvedFonts: [sys('Nirmala UI', 26)],
  })]);
  assert.ok(!rules([el({
    declaredFamilies: ['system-ui', 'sans-serif'],
    resolvedFonts: [sys('Nirmala UI', 26)],
  })]).includes('font-fallback'));
  assert.equal(r.findings.length, 0);
});

test('a mixed run is clean when every face came from the stack', () => {
  assert.ok(!rules([el({
    declaredFamilies: ['barlow condensed', 'khand'],
    resolvedFonts: [
      web('Khand SemiBold', 26),
      web('Barlow Condensed SemiBold', 3),
    ],
  })]).includes('font-fallback'));
});

test('no reported faces means nothing to judge, not a fault', () => {
  assert.deepEqual(analyse([el({ resolvedFonts: [] })]).findings, []);
});

// ---------------------------------------------------------------------------
// groupIntoLines + line-collision
// ---------------------------------------------------------------------------

const r = (top: number, bottom: number, left = 0, right = 100): LineBox =>
  ({ top, bottom, left, right });

test('rects side by side on one line become one line', () => {
  const lines = groupIntoLines([r(100, 118, 0, 50), r(100, 118, 50, 120), r(101, 117, 120, 160)]);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], { top: 100, bottom: 118, left: 0, right: 160 });
});

test('two lines that barely touch stay two lines', () => {
  assert.equal(groupIntoLines([r(100, 118), r(118, 136)]).length, 2);
});

test('two lines overlapping by a few pixels stay two lines, so the overlap is visible', () => {
  const lines = groupIntoLines([r(100, 118), r(114, 132)]);
  assert.equal(lines.length, 2, 'a 4px overlap of an 18px line must not be merged away');
});

test('zero-height rects are discarded', () => {
  assert.deepEqual(groupIntoLines([r(100, 100), r(100, 118)]), [r(100, 118)]);
});

test('inline children on one line do not fake a collision', () => {
  // Two spans at the same vertical position. Ungrouped, rect[0].bottom minus
  // rect[1].top is a full line height of "overlap".
  assert.ok(!rules([el({
    lineBoxes: [r(100, 118, 0, 50), r(100, 118, 50, 120)],
  })]).includes('line-collision'));
});

test('genuinely colliding lines are reported with the overlap measured', () => {
  const found = analyse([el({
    lineHeightPx: 14,
    lineBoxes: [r(100, 118), r(114, 132)],
  })]).findings.find((f) => f.rule === 'line-collision');
  assert.ok(found);
  assert.equal(found.impact, 'critical');
  assert.match(found.summary, /overlap by 4px/);
  assert.match(found.detail, /needs about 1\.35x/);
});

test('one line cannot collide with itself', () => {
  assert.ok(!rules([el({ lineBoxes: [r(100, 118)] })]).includes('line-collision'));
});

// ---------------------------------------------------------------------------
// glyph-clipping
// ---------------------------------------------------------------------------

test('ink escaping a clipping box is reported', () => {
  const found = analyse([el({
    clipped: true,
    contentTop: 100,
    contentBottom: 130,
    lineBoxes: [r(100, 118), r(124, 142)],
  })]).findings.find((f) => f.rule === 'glyph-clipping');
  assert.ok(found);
  assert.match(found.summary, /cut off by 12px/);
});

test('text hidden for a screen reader is not a clipping bug', () => {
  // The `.sr-only` pattern: a 1px box with overflow hidden, holding real
  // text at a real font size. Every line of it escapes, on purpose. A rule
  // that reports this fails every accessible page there is.
  assert.ok(!rules([el({
    clipped: true,
    fontSizePx: 16,
    contentTop: 0,
    contentBottom: 1,
    lineBoxes: [r(1, 21)],
  })]).includes('glyph-clipping'));
});

test('a box that is merely too short IS reported', () => {
  // The boundary matters: one line of 16px text in a 20px box that clips by
  // 6px is a real fault, and must not be waved away as hidden text.
  assert.ok(rules([el({
    clipped: true,
    fontSizePx: 16,
    contentTop: 0,
    contentBottom: 20,
    lineBoxes: [r(0, 26)],
  })]).includes('glyph-clipping'));
});

test('ink escaping a box that does not clip is not reported', () => {
  assert.ok(!rules([el({
    clipped: false,
    contentTop: 100,
    contentBottom: 130,
    lineBoxes: [r(100, 118), r(124, 142)],
  })]).includes('glyph-clipping'));
});

// ---------------------------------------------------------------------------
// tracking-damage -- script-dependent, which is the point
// ---------------------------------------------------------------------------

test('letter-spacing on Devanagari breaks the shirorekha and is reported', () => {
  const found = analyse([el({ letterSpacingPx: 1.6 })]).findings
    .find((f) => f.rule === 'tracking-damage');
  assert.ok(found);
  assert.match(found.summary, /Devanagari/);
});

test('letter-spacing on Arabic is reported too', () => {
  const found = analyse([el({ text: 'ما تبيعه وما تبقى', letterSpacingPx: 1, direction: 'rtl' })])
    .findings.find((f) => f.rule === 'tracking-damage');
  assert.ok(found);
  assert.match(found.summary, /Arabic/);
});

test('letter-spacing on a script whose letters do not connect is left alone', () => {
  // Tamil has stacked marks but no connecting headline, so tracking is a
  // style choice rather than damage. Reporting it would be the kind of
  // false positive that gets a linter switched off.
  assert.ok(!rules([el({ text: 'நீங்கள் விற்பது', letterSpacingPx: 2 })])
    .includes('tracking-damage'));
  assert.ok(!rules([el({ text: '残りの在庫', letterSpacingPx: 2 })])
    .includes('tracking-damage'));
});

test('a letter-spacing of zero is not a finding', () => {
  assert.ok(!rules([el({ letterSpacingPx: 0 })]).includes('tracking-damage'));
  assert.ok(!rules([el({ letterSpacingPx: 0.05 })]).includes('tracking-damage'));
});

// ---------------------------------------------------------------------------
// case-transform
// ---------------------------------------------------------------------------

test('text-transform on a caseless script is reported', () => {
  for (const t of ['uppercase', 'lowercase', 'capitalize']) {
    const found = analyse([el({ textTransform: t })]).findings
      .find((f) => f.rule === 'case-transform');
    assert.ok(found, `expected a finding for ${t}`);
    assert.equal(found.impact, 'moderate');
  }
});

test('text-transform on a cased non-Latin script is left alone', () => {
  assert.ok(!rules([el({ text: 'Что вы продаёте', textTransform: 'uppercase' })])
    .includes('case-transform'));
});

test('text-transform: none is not a finding', () => {
  assert.ok(!rules([el({ textTransform: 'none' })]).includes('case-transform'));
});

// ---------------------------------------------------------------------------
// direction
// ---------------------------------------------------------------------------

test('right-to-left text in a left-to-right box is reported', () => {
  const found = analyse([el({ text: 'ما تبيعه وما تبقى في المخزون.', direction: 'ltr' })])
    .findings.find((f) => f.rule === 'direction-missing');
  assert.ok(found);
  assert.equal(found.impact, 'critical', 'a full stop is a character the direction moves');
});

test('severity follows what the text contains, not only the style', () => {
  const impactOf = (text: string) =>
    analyse([el({ text, direction: 'ltr' })]).findings
      .find((f) => f.rule === 'direction-missing')?.impact;

  // A bare word of strongly right-to-left letters lays out identically
  // either way. Reporting it as critical alongside a real bidi fault is how
  // a checker trains people to ignore it. It is still reported, because the
  // next string through that element will not be a bare word.
  assert.equal(impactOf('اردو'), 'moderate');
  assert.equal(impactOf('العربية'), 'moderate');

  // Anything whose side of the line is decided by the paragraph direction.
  assert.equal(impactOf('الطلب 1234'), 'critical', 'Western digits');
  assert.equal(impactOf('الطلب ١٢٣٤'), 'critical', 'Arabic-Indic digits');
  assert.equal(impactOf('خطة Nayaverse الشهرية للعيادات'), 'critical', 'embedded Latin');
  assert.equal(impactOf('السعر %20'), 'critical');
  assert.equal(impactOf('ما تبيعه وما تبقى.'), 'critical', 'a neutral at the edge of the run');

  // And the case that is genuinely fine: a comma between two right-to-left
  // characters resolves to right-to-left and lands correctly even here.
  assert.equal(impactOf('ما تبيعه، وما تبقى'), 'moderate', 'a neutral in the middle');
});

test('right-to-left text in a right-to-left box is correct', () => {
  assert.ok(!rules([el({ text: 'ما تبيعه وما تبقى في المخزون', direction: 'rtl' })])
    .includes('direction-missing'));
});

test('only the alignment that actually misaligns rtl text is reported', () => {
  const rtl = { text: 'ما تبيعه وما تبقى في المخزون', direction: 'rtl' };
  assert.ok(rules([el({ ...rtl, textAlign: 'left' })]).includes('physical-text-align'));

  // `right` inside rtl is physically where `start` already resolves, so it
  // misaligns nothing. A survey of real pages produced 58 of these on one
  // Wikipedia page -- a maintainability opinion reported as a defect, which
  // is how the rules that matter get switched off along with the noise.
  assert.ok(!rules([el({ ...rtl, textAlign: 'right' })]).includes('physical-text-align'));
  assert.ok(!rules([el({ ...rtl, textAlign: 'start' })]).includes('physical-text-align'));
  assert.ok(!rules([el({ ...rtl, textAlign: 'center' })]).includes('physical-text-align'));
});

test('a physical text-align in a left-to-right box is normal and not reported', () => {
  assert.ok(!rules([el({ textAlign: 'left' })]).includes('physical-text-align'));
});

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

test('findings come back worst first', () => {
  const r = analyse([
    // One element proving the page HAS a Devanagari face, so the fallback on
    // the next one is an inconsistency rather than a system-font strategy.
    el(),
    el({
      resolvedFonts: [sys('Nirmala UI', 26)],
      letterSpacingPx: 2,
      textTransform: 'uppercase',
    }),
  ]);
  assert.deepEqual(r.findings.map((f) => f.impact), ['critical', 'serious', 'moderate']);
  assert.equal(r.ok, false);
});

test('a disabled rule is not run', () => {
  const broken = [
    el(),
    el({ resolvedFonts: [sys('Nirmala UI', 26)], letterSpacingPx: 2 }),
  ];
  assert.deepEqual(
    analyse(broken, { disabled: ['font-fallback'] }).findings.map((f) => f.rule),
    ['tracking-damage'],
  );
});

test('a Latin word inside a Hindi sentence does not make the sentence Latin', () => {
  const r = analyse([el({
    text: 'आपका Nayaverse डैशबोर्ड तैयार है',
    resolvedFonts: [sys('Nirmala UI', 26)],
  })]);
  const f = r.findings.find((x) => x.rule === 'font-fallback');
  assert.ok(f);
  assert.equal(f.scriptLabel, 'Devanagari');
});

test('the collision tolerance is honoured', () => {
  const sub = [el({ lineBoxes: [r(100, 118), r(117.7, 136)] })];
  assert.ok(!rules(sub).includes('line-collision'), 'a 0.3px overlap is rounding, not collision');
  assert.ok(analyse(sub, { collisionTolerancePx: 0.1 }).findings
    .some((f) => f.rule === 'line-collision'));
});

test('text too short to identify is skipped', () => {
  assert.equal(analyse([el({ text: 'अ' })]).examined, 0);
});

test('a known boundary: a short non-Latin phrase behind a long Latin name is skipped', () => {
  // "خطة Nayaverse" is three Arabic letters and nine Latin ones, so by
  // character count it is a Latin string and is left alone. That is the cost
  // of deciding the script by majority, and it is the right trade: the
  // alternative is asking Arabic questions of English buttons that happen to
  // carry one foreign word. Recorded as a test so it stays a decision rather
  // than becoming a surprise.
  assert.equal(analyse([el({ text: 'خطة Nayaverse', direction: 'ltr' })]).examined, 0);
  // One more word of Arabic and it is examined again.
  assert.equal(analyse([el({ text: 'خطة Nayaverse الشهرية', direction: 'ltr' })]).examined, 1);
});

// ---------------------------------------------------------------------------
// Attribution: which font drew the script, when CDP only gives totals
// ---------------------------------------------------------------------------

test('a run that is mostly its own script is attributable', () => {
  // 20 Devanagari characters against 9 Latin ones. The Devanagari font holds
  // the majority of the glyphs, so "most glyphs" names it correctly.
  assert.ok(analyse([
    el(),
    el({
      text: 'आपका Nayaverse डैशबोर्ड तैयार है',
      resolvedFonts: [sys('Nirmala UI', 26)],
    }),
  ]).findings.some((f) => f.rule === 'font-fallback'));
});

test('a run that is mostly digits is NOT attributable, and is skipped', () => {
  // The run that broke this on a real page: ", अवधि 9,55" is four Devanagari
  // characters and seven digits and commas. Arial drew the digits and is in
  // the declared stack, so "most glyphs" named Arial and the page was cleared
  // while its Devanagari sat in the system font. Neither answer is available
  // from a glyph total, so the honest move is to say nothing about this run.
  const r = analyse([el({
    text: ', अवधि 9,55,000',
    declaredFamilies: ['arial', 'verdana', 'sans-serif'],
    resolvedFonts: [
      sys('Nirmala UI', 4),
      sys('Arial', 7),
    ],
  })]);
  assert.ok(!r.findings.some((f) => f.rule === 'font-fallback'));
});

test('a mixed run cannot prove a page ships a face either', () => {
  // The same run must not be accepted as proof of coverage, or one of them
  // promotes every other element on the page to critical.
  const r = analyse([
    el({
      text: ', अवधि 9,55,000',
      declaredFamilies: ['arial', 'verdana', 'sans-serif'],
      resolvedFonts: [
        sys('Nirmala UI', 4),
        sys('Arial', 7),
      ],
    }),
    el({
      selector: 'main > p',
      declaredFamilies: ['arial', 'sans-serif'],
      resolvedFonts: [sys('Nirmala UI', 26)],
    }),
  ]);
  const f = r.findings.find((x) => x.rule === 'font-fallback');
  assert.ok(f);
  assert.equal(f.impact, 'moderate', 'nothing here proved a Devanagari face');
});

test('scriptPurity counts only what a font needs a real glyph for', () => {
  const dev = scriptByName('devanagari');
  assert.equal(scriptPurity('साइन इन', dev), 1, 'spaces are drawn by anything');
  assert.equal(scriptPurity('9,55,000', dev), 0);
  assert.ok(scriptPurity('आपका Nayaverse डैशबोर्ड तैयार है', dev) > 0.6);
  assert.ok(scriptPurity(', अवधि 9,55,000', dev) < 0.6);
});

test('a system font that happens to carry the script proves nothing', () => {
  // BBC Arabic declares `times new roman` on one link. Times New Roman
  // carries Arabic on Windows, so that element rendered Arabic in a declared
  // family -- and without asking where the font came from, the rule read it
  // as "this page ships an Arabic face" and called 241 other elements
  // critical. The page ships no Arabic webfont at all.
  const arabic = 'ما تبيعه وما تبقى في المخزون';
  const r = analyse([
    el({ text: 'عربي', declaredFamilies: ['times new roman'], resolvedFonts: [sys('Times New Roman', 4)] }),
    el({
      selector: 'main > p',
      text: arabic,
      declaredFamilies: ['helvetica', 'arial', 'sans-serif'],
      resolvedFonts: [sys('Segoe UI', 26)],
      direction: 'rtl',
    }),
  ]);
  const f = r.findings.find((x) => x.rule === 'font-fallback' && x.selector === 'main > p');
  assert.ok(f);
  assert.equal(f.impact, 'moderate', 'no Arabic face was ever shipped by this page');
});

test('a webfont the page loaded DOES prove it, so a missing stack is critical', () => {
  const r = analyse([
    el(),
    el({
      selector: 'main > h2',
      declaredFamilies: ['barlow condensed', 'arial narrow'],
      resolvedFonts: [sys('Nirmala UI', 26)],
    }),
  ]);
  const f = r.findings.find((x) => x.selector === 'main > h2' && x.rule === 'font-fallback');
  assert.ok(f);
  assert.equal(f.impact, 'critical');
});
