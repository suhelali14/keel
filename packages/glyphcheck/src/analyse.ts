/**
 * Measurements in, findings out. No browser, no I/O, no globals.
 *
 * Everything that decides whether a page is wrong lives here, so it can be
 * tested against numbers typed by hand. The browser's only job is to produce
 * the numbers; if judgement lived in the page script it could only ever be
 * tested by loading a page and trusting the result.
 */

import { dominantScript, type Script, type ScriptName } from './scripts.js';

export type RuleId =
  | 'font-fallback'
  | 'line-collision'
  | 'glyph-clipping'
  | 'tracking-damage'
  | 'case-transform'
  | 'direction-missing'
  | 'physical-text-align';

export type Impact = 'critical' | 'serious' | 'moderate';

/** One line of text as the browser laid it out. */
export interface LineBox {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/**
 * One element's text, as measured. Produced by the page script for every
 * element that has its own text; consumed only here.
 */
export interface Measured {
  /** A selector a person can paste into devtools. */
  readonly selector: string;
  readonly tag: string;
  /** A sample of the element's own text, trimmed and capped. */
  readonly text: string;
  /** The author's stack, parsed from the computed `font-family`. */
  readonly declaredFamilies: readonly string[];
  /**
   * The families that actually drew the glyphs, in the order the browser
   * reports them. This cannot be read from the page -- no web API exposes it
   * -- so it comes from the debugging protocol. It is the whole reason this
   * package needs a browser connection rather than a DOM parser.
   */
  readonly resolvedFamilies: readonly string[];
  readonly fontSizePx: number;
  readonly lineHeightPx: number;
  readonly letterSpacingPx: number;
  readonly textTransform: string;
  readonly direction: string;
  readonly textAlign: string;
  /**
   * The raw client rects of the element's text, ungrouped. An element with
   * inline children reports several per visual line; `groupIntoLines` sorts
   * that out here rather than in the page, so the grouping is testable.
   */
  readonly lineBoxes: readonly LineBox[];
  /** The element's content box, for deciding whether ink escaped it. */
  readonly contentTop: number;
  readonly contentBottom: number;
  /** True when this element or an ancestor would cut off escaping ink. */
  readonly clipped: boolean;
}

export interface Finding {
  readonly rule: RuleId;
  readonly impact: Impact;
  readonly selector: string;
  readonly script: ScriptName;
  readonly scriptLabel: string;
  readonly text: string;
  /** One sentence naming the defect. */
  readonly summary: string;
  /** The numbers behind it, so the claim can be checked. */
  readonly detail: string;
  /** What to change. */
  readonly fix: string;
}

export interface AnalyseOptions {
  /**
   * Vertical overlap below this is ignored. Line boxes abut by design and
   * sub-pixel rounding puts them a fraction over; real collision in a script
   * with stacked marks is several pixels, not a fraction of one.
   */
  readonly collisionTolerancePx?: number;
  /** Ink may escape the content box by this much before it is reported. */
  readonly clipTolerancePx?: number;
  /**
   * Letter-spacing below this fraction of an em is treated as sub-pixel and
   * not reported on a connected script. 0.01em on 12px type is 0.12px: the
   * join is broken in theory and intact to every eye that reads it.
   */
  readonly trackingToleranceEm?: number;
  /** Rules to leave out of this run. */
  readonly disabled?: readonly RuleId[];
  /** Ignore elements whose text is shorter than this. */
  readonly minChars?: number;
}

const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji',
  'fangsong', 'inherit', 'initial', 'revert', 'unset',
]);

/** `"IBM Plex Sans", system-ui` -> `['ibm plex sans', 'system-ui']` */
export const parseFontStack = (value: string): string[] => {
  const out: string[] = [];
  let current = '';
  let quote: string | undefined;
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = undefined;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ',') { out.push(current); current = ''; continue; }
    current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim().toLowerCase()).filter(Boolean);
};

/**
 * Tokens a browser appends to a family name when it names the face it used:
 * weight and slant, nothing else.
 *
 * This list is why the match is not a plain prefix test. The browser reports
 * "IBM Plex Sans Devanagari SemiBold" for a stack that declared "IBM Plex
 * Sans Devanagari", so some suffix has to be allowed -- but "IBM Plex Sans
 * Devanagari" is *also* a prefix match for a stack that declared only "IBM
 * Plex Sans", and accepting that would report a clean page for precisely the
 * fallback this rule exists to catch. A suffix is a face's weight or slant,
 * or it is a different family. "Condensed", "Narrow" and "Display" are
 * deliberately absent: in CSS those name separate families.
 */
const FACE_SUFFIX_TOKENS = new Set([
  'regular', 'normal', 'roman', 'book', 'italic', 'oblique', 'thin',
  'extralight', 'ultralight', 'light', 'medium', 'semibold', 'demibold',
  'demi', 'semi', 'bold', 'extrabold', 'ultrabold', 'black', 'heavy',
  'variable', 'vf',
]);

const isFaceSuffix = (rest: string): boolean =>
  rest.split(/\s+/).filter(Boolean).every(
    (t) => FACE_SUFFIX_TOKENS.has(t) || /^\d{3}$/.test(t),
  );

/**
 * Did one of the author's own families draw this?
 *
 * Longest declared family first, so the reported match is the most specific
 * one that fits rather than whichever happened to be listed earliest.
 */
export const resolvedFromStack = (
  resolved: string,
  declared: readonly string[],
): string | undefined => {
  const r = resolved.trim().toLowerCase();
  const specific = declared.filter((d) => !GENERIC_FAMILIES.has(d));
  return [...specific]
    .sort((a, b) => b.length - a.length)
    .find((d) => r === d || (r.startsWith(`${d} `) && isFaceSuffix(r.slice(d.length + 1))));
};

/**
 * Raw client rects grouped into the visual lines they belong to.
 *
 * An element with inline children reports several rects per line, side by
 * side. Comparing the bottom of one to the top of the next without grouping
 * would read two spans on the same line as a full line-height of overlap and
 * report every styled paragraph on the page as broken.
 *
 * Rects are merged when their vertical extents overlap by more than half the
 * shorter one. Rects on the same line overlap almost entirely; two lines that
 * genuinely collide overlap by a few pixels of twenty, so the threshold
 * separates the two cases without having to know the line-height.
 */
export const groupIntoLines = (rects: readonly LineBox[]): LineBox[] => {
  const sorted = [...rects]
    .filter((r) => r.bottom > r.top)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: LineBox[] = [];

  for (const r of sorted) {
    const last = lines[lines.length - 1];
    if (last) {
      const overlap = Math.min(last.bottom, r.bottom) - Math.max(last.top, r.top);
      const shorter = Math.min(last.bottom - last.top, r.bottom - r.top);
      if (shorter > 0 && overlap / shorter > 0.5) {
        lines[lines.length - 1] = {
          top: Math.min(last.top, r.top),
          bottom: Math.max(last.bottom, r.bottom),
          left: Math.min(last.left, r.left),
          right: Math.max(last.right, r.right),
        };
        continue;
      }
    }
    lines.push(r);
  }
  return lines;
};

const sample = (text: string, n = 32): string =>
  text.length <= n ? text : `${text.slice(0, n)}…`;

const round = (n: number, places = 1): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

type Rule = (m: Measured, s: Script, o: Required<Omit<AnalyseOptions, 'disabled'>>) => Finding | undefined;

const base = (m: Measured, s: Script) => ({
  selector: m.selector,
  script: s.name,
  scriptLabel: s.label,
  text: sample(m.text),
});

/**
 * The glyphs were drawn by a font the author never named.
 *
 * This is the fault nobody can self-detect: the page looks fine to a reader
 * who cannot tell the system font from the brand one, the stylesheet names
 * the right family, the font file serves with a 200, and no build-time check
 * can see any of it. It was found on a real site this way -- a Marathi page
 * set entirely in the Windows UI font, because the body stack ran out of
 * specific families before it reached one with Devanagari glyphs.
 */
const fontFallback: Rule = (m, s) => {
  if (m.resolvedFamilies.length === 0) return undefined;
  const specific = m.declaredFamilies.filter((d) => !GENERIC_FAMILIES.has(d));
  // A stack of nothing but generics is a deliberate choice to take whatever
  // the system has, so there is no author intent here to violate.
  if (specific.length === 0) return undefined;

  const strays = m.resolvedFamilies.filter((r) => !resolvedFromStack(r, m.declaredFamilies));
  if (strays.length === 0) return undefined;

  return {
    ...base(m, s),
    rule: 'font-fallback',
    impact: 'critical',
    summary: `${s.label} text rendered in ${strays.join(', ')}, which the stylesheet never asked for.`,
    detail: `declared: ${specific.join(', ')} | rendered: ${m.resolvedFamilies.join(', ')}`,
    fix: `Name a ${s.label} face in this stack. A Latin face carries no ${s.label} glyphs, so the browser walks the stack per glyph and takes the first font that has them -- which is whatever the operating system supplies once your own families run out.`,
  };
};

/** Consecutive lines of text overlap, so the marks of one sit in the other. */
const lineCollision: Rule = (m, s, o) => {
  const lines = groupIntoLines(m.lineBoxes);
  if (lines.length < 2) return undefined;
  let worst = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const above = lines[i - 1];
    const below = lines[i];
    if (!above || !below) continue;
    worst = Math.max(worst, above.bottom - below.top);
  }
  if (worst <= o.collisionTolerancePx) return undefined;

  const ratio = m.fontSizePx > 0 ? m.lineHeightPx / m.fontSizePx : 0;
  return {
    ...base(m, s),
    rule: 'line-collision',
    impact: 'critical',
    summary: `Lines of ${s.label} overlap by ${round(worst)}px.`,
    detail: `line-height ${round(m.lineHeightPx)}px on ${round(m.fontSizePx)}px text (${round(ratio, 2)}x)${
      s.stacked ? `; ${s.label} needs about ${s.minLeading}x because its marks sit above and below the letters` : ''
    }`,
    fix: s.stacked
      ? `Raise line-height for ${s.label}. The value that fits Latin has no room for the marks this script stacks above and below the base letters, so the descenders of one line land in the ascenders of the next.`
      : `Raise line-height. At ${round(ratio, 2)}x the lines cannot clear each other.`,
  };
};

/** Ink extends outside a box that will cut it off. */
const glyphClipping: Rule = (m, s, o) => {
  if (!m.clipped || m.lineBoxes.length === 0) return undefined;

  // A box far too short to hold one line of its own text is not a layout
  // that clipped by accident. It is the standard way to hide text from sight
  // while leaving it for a screen reader -- `.sr-only`, a 1px box with
  // overflow hidden -- and reporting it means every accessible page on the
  // internet fails this rule. The author hid that text on purpose.
  const boxHeight = m.contentBottom - m.contentTop;
  if (m.fontSizePx > 0 && boxHeight < m.fontSizePx * 0.5) return undefined;

  const inkTop = Math.min(...m.lineBoxes.map((l) => l.top));
  const inkBottom = Math.max(...m.lineBoxes.map((l) => l.bottom));
  const over = Math.max(m.contentTop - inkTop, inkBottom - m.contentBottom);
  if (over <= o.clipTolerancePx) return undefined;

  return {
    ...base(m, s),
    rule: 'glyph-clipping',
    impact: 'serious',
    summary: `${s.label} text is cut off by ${round(over)}px.`,
    detail: `ink spans ${round(inkTop)}..${round(inkBottom)}px, the box holds ${round(m.contentTop)}..${round(m.contentBottom)}px`,
    fix: `Give this box room or let it grow. A fixed height that fits Latin clips ${s.label}, which sets taller at the same font-size.`,
  };
};

/**
 * `letter-spacing` on a script whose letters are connected.
 *
 * In Arabic it breaks the cursive joins and the word falls into separate
 * letters. In Devanagari and its relatives it breaks the shirorekha, the
 * line along the top that the letters hang from and that makes the script
 * scannable at all -- it becomes a row of dashes.
 */
const trackingDamage: Rule = (m, s, o) => {
  if (!s.joins) return undefined;
  // Measured against the font size, not in pixels. A stylesheet sets tracking
  // in em, and the same 0.1px is nothing on a 48px headline and visible on
  // 10px type. Below the threshold the gap is sub-pixel: the join is
  // technically broken and nobody can see it, and reporting that trains
  // people to ignore the ones they can.
  if (m.fontSizePx <= 0) return undefined;
  const em = Math.abs(m.letterSpacingPx) / m.fontSizePx;
  if (em < o.trackingToleranceEm) return undefined;
  return {
    ...base(m, s),
    rule: 'tracking-damage',
    impact: 'serious',
    summary: `letter-spacing of ${round(em, 3)}em is applied to ${s.label}, whose letters connect.`,
    detail: `letter-spacing: ${round(m.letterSpacingPx, 2)}px on ${round(m.fontSizePx)}px text (${round(em, 3)}em)`,
    fix: `Set letter-spacing to 0 for ${s.label}. Spacing does not add air between these letters, it severs the join that holds a word together.`,
  };
};

/** `text-transform` on a script that has no case. */
const caseTransform: Rule = (m, s) => {
  if (s.cased) return undefined;
  const t = m.textTransform.trim().toLowerCase();
  if (t !== 'uppercase' && t !== 'lowercase' && t !== 'capitalize') return undefined;
  return {
    ...base(m, s),
    rule: 'case-transform',
    impact: 'moderate',
    summary: `text-transform: ${t} is applied to ${s.label}, which has no letter case.`,
    detail: `text-transform: ${t}`,
    fix: `Drop the transform for ${s.label}. It does nothing to this script, and where the element mixes scripts it changes only the Latin half, which is worse than leaving both alone.`,
  };
};

/**
 * Characters that are not right-to-left and so get a direction of their own:
 * Latin letters, and digits in any of the numeral systems Arabic is written
 * with. Anywhere in the run, these move when the paragraph direction changes.
 */
const STRONG_OPPOSITE = /[0-9A-Za-z٠-٩۰-۹߀-߉]/;

/**
 * Punctuation or a symbol at either end of the run.
 *
 * Where it sits matters, which is why this is an anchored test rather than a
 * search. By the bidirectional algorithm a neutral character between two
 * right-to-left characters resolves to right-to-left and lands correctly even
 * in a left-to-right box -- so the comma in "ما تبيعه، وما تبقى" is fine. A
 * neutral at the edge of the run has only the paragraph direction to take, so
 * a trailing full stop ends up on the left of the sentence instead of its
 * right. The edge is the case worth reporting; the middle is not.
 */
const EDGE_NEUTRAL = /^[\p{P}\p{S}]|[\p{P}\p{S}]$/u;

const bidiSensitive = (text: string): boolean => {
  const t = text.trim();
  return STRONG_OPPOSITE.test(t) || EDGE_NEUTRAL.test(t);
};

/**
 * Right-to-left text in a left-to-right box.
 *
 * Severity depends on the text, not just the style. A language picker
 * listing a bare "اردو" renders the same in either direction, because every
 * letter in it is strongly right-to-left; the same missing `dir` around a
 * sentence with a date, a price or a product name in it puts those on the
 * wrong end of the line. Reporting both as critical is how a checker earns
 * the reputation that gets it switched off.
 */
const directionMissing: Rule = (m, s) => {
  if (!s.rtl) return undefined;
  if (m.direction.trim().toLowerCase() === 'rtl') return undefined;
  const sensitive = bidiSensitive(m.text);
  return {
    ...base(m, s),
    rule: 'direction-missing',
    impact: sensitive ? 'critical' : 'moderate',
    summary: sensitive
      ? `${s.label} containing digits, Latin or punctuation is laid out left to right.`
      : `${s.label} is laid out left to right, which this run happens to survive.`,
    detail: sensitive
      ? `direction: ${m.direction || 'ltr'}; the text mixes in characters whose side of the line depends on it`
      : `direction: ${m.direction || 'ltr'}; every character here is strongly right-to-left, so nothing moves`,
    fix: sensitive
      ? `Set dir="rtl" on this subtree, or direction: rtl in CSS. The letters shape correctly without it, so the text looks plausible -- but the digits, punctuation and any embedded Latin land on the wrong end of the line.`
      : `Set dir="rtl" on this subtree anyway. Nothing moves in this particular string, so there is no bug on screen today; the next string through the same element will have a number or a brand name in it.`,
  };
};

/** A physical alignment inside a right-to-left box. */
const physicalTextAlign: Rule = (m, s) => {
  if (m.direction.trim().toLowerCase() !== 'rtl') return undefined;
  const a = m.textAlign.trim().toLowerCase();
  if (a !== 'left' && a !== 'right') return undefined;
  return {
    ...base(m, s),
    rule: 'physical-text-align',
    impact: 'moderate',
    summary: `text-align: ${a} is hard-coded inside right-to-left text.`,
    detail: `direction: rtl with text-align: ${a}`,
    fix: `Use text-align: ${a === 'left' ? 'start' : 'end'}. The logical keyword follows the writing direction; the physical one has to be overridden per language and eventually is not.`,
  };
};

const RULES: ReadonlyArray<readonly [RuleId, Rule]> = [
  ['font-fallback', fontFallback],
  ['line-collision', lineCollision],
  ['glyph-clipping', glyphClipping],
  ['tracking-damage', trackingDamage],
  ['case-transform', caseTransform],
  ['direction-missing', directionMissing],
  ['physical-text-align', physicalTextAlign],
];

export const ALL_RULES: readonly RuleId[] = RULES.map(([id]) => id);

const IMPACT_ORDER: Record<Impact, number> = { critical: 0, serious: 1, moderate: 2 };

export interface AnalyseResult {
  readonly findings: readonly Finding[];
  readonly ok: boolean;
  /** Elements that carried non-Latin text and were therefore examined. */
  readonly examined: number;
  /** Scripts seen on the page, most text first. */
  readonly scripts: readonly string[];
}

export const analyse = (
  measured: readonly Measured[],
  options: AnalyseOptions = {},
): AnalyseResult => {
  const o = {
    collisionTolerancePx: options.collisionTolerancePx ?? 0.5,
    clipTolerancePx: options.clipTolerancePx ?? 1,
    trackingToleranceEm: options.trackingToleranceEm ?? 0.015,
    minChars: options.minChars ?? 2,
  };
  const disabled = new Set(options.disabled ?? []);
  const active = RULES.filter(([id]) => !disabled.has(id));

  const findings: Finding[] = [];
  const scripts = new Map<string, number>();
  let examined = 0;

  for (const m of measured) {
    const script = dominantScript(m.text);
    // Latin is the case every stylesheet was already written for, and the
    // rules here have nothing true to say about it.
    if (!script || script.name === 'latin') continue;
    if (m.text.trim().length < o.minChars) continue;

    examined += 1;
    scripts.set(script.label, (scripts.get(script.label) ?? 0) + m.text.length);

    for (const [, rule] of active) {
      const f = rule(m, script, o);
      if (f) findings.push(f);
    }
  }

  findings.sort((a, b) => IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact]
    || a.rule.localeCompare(b.rule)
    || a.selector.localeCompare(b.selector));

  return {
    findings,
    ok: findings.length === 0,
    examined,
    scripts: [...scripts.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label),
  };
};
