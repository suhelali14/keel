/**
 * What each script needs from typography.
 *
 * Every rule in this package resolves to a question about one of these flags.
 * "Is letter-spacing damaging?" is `joins`. "Can this text be uppercased?" is
 * `cased`. "Should I expect marks above and below the line?" is `stacked`.
 *
 * The flags are properties of the writing system, not of a language. Marathi
 * and Hindi are different languages in the same script and have identical
 * typographic needs; Punjabi is written in two scripts with different ones.
 */

export type ScriptName =
  | 'latin'
  | 'cyrillic'
  | 'greek'
  | 'armenian'
  | 'georgian'
  | 'hebrew'
  | 'arabic'
  | 'syriac'
  | 'thaana'
  | 'devanagari'
  | 'bengali'
  | 'gurmukhi'
  | 'gujarati'
  | 'oriya'
  | 'tamil'
  | 'telugu'
  | 'kannada'
  | 'malayalam'
  | 'sinhala'
  | 'thai'
  | 'lao'
  | 'tibetan'
  | 'myanmar'
  | 'khmer'
  | 'ethiopic'
  | 'hangul'
  | 'kana'
  | 'han';

export interface Script {
  readonly name: ScriptName;
  /** For messages: the name a reader would recognise. */
  readonly label: string;
  /** Codepoint ranges, inclusive, that are diagnostic of this script. */
  readonly ranges: ReadonlyArray<readonly [number, number]>;
  /**
   * Letters connect to their neighbours, so `letter-spacing` does not add air
   * between them -- it severs them. Arabic letters join cursively; Devanagari
   * and its relatives hang from a headline (the shirorekha) that spacing
   * breaks into dashes.
   */
  readonly joins: boolean;
  /**
   * The script distinguishes upper and lower case, so `text-transform` means
   * something. Where it is false, a transform is at best a no-op that reveals
   * the style was written for Latin and never re-read.
   */
  readonly cased: boolean;
  /**
   * Marks sit above and below the base letters, often two deep. Latin leading
   * has no room for them, which is how lines come to overlap.
   */
  readonly stacked: boolean;
  /** Written right to left, so physical offsets are usually a mistake. */
  readonly rtl: boolean;
  /**
   * Multiplier on a Latin-tuned line-height below which collision is likely.
   * Reflects each script's ink extent above and below the baseline, not
   * taste: 1.0 means Latin leading is adequate. Used only to explain a
   * measured collision, never to report one -- a report always comes from
   * overlapping line boxes that were actually measured.
   */
  readonly minLeading: number;
}

/**
 * Deliberately not exhaustive over Unicode. A script earns a row here when a
 * rule in this package can say something true about it; a row that only
 * repeated the Latin defaults would add noise to every report.
 */
export const SCRIPTS: readonly Script[] = [
  // --- Alphabetic, cased, no stacking beyond a single accent ---------------
  { name: 'latin', label: 'Latin', ranges: [[0x0041, 0x024f], [0x1e00, 0x1eff]],
    joins: false, cased: true, stacked: false, rtl: false, minLeading: 1.0 },
  { name: 'cyrillic', label: 'Cyrillic', ranges: [[0x0400, 0x052f]],
    joins: false, cased: true, stacked: false, rtl: false, minLeading: 1.0 },
  { name: 'greek', label: 'Greek', ranges: [[0x0370, 0x03ff], [0x1f00, 0x1fff]],
    joins: false, cased: true, stacked: false, rtl: false, minLeading: 1.05 },
  { name: 'armenian', label: 'Armenian', ranges: [[0x0530, 0x058f]],
    joins: false, cased: true, stacked: false, rtl: false, minLeading: 1.0 },
  { name: 'georgian', label: 'Georgian', ranges: [[0x10a0, 0x10ff]],
    joins: false, cased: false, stacked: false, rtl: false, minLeading: 1.0 },

  // --- Right to left ------------------------------------------------------
  { name: 'hebrew', label: 'Hebrew', ranges: [[0x0590, 0x05ff]],
    joins: false, cased: false, stacked: true, rtl: true, minLeading: 1.15 },
  { name: 'arabic', label: 'Arabic',
    ranges: [[0x0600, 0x06ff], [0x0750, 0x077f], [0x08a0, 0x08ff], [0xfb50, 0xfdff], [0xfe70, 0xfeff]],
    joins: true, cased: false, stacked: true, rtl: true, minLeading: 1.35 },
  { name: 'syriac', label: 'Syriac', ranges: [[0x0700, 0x074f]],
    joins: true, cased: false, stacked: true, rtl: true, minLeading: 1.3 },
  { name: 'thaana', label: 'Thaana', ranges: [[0x0780, 0x07bf]],
    joins: false, cased: false, stacked: true, rtl: true, minLeading: 1.3 },

  // --- Brahmic: a headline the letters hang from, marks above and below ----
  { name: 'devanagari', label: 'Devanagari', ranges: [[0x0900, 0x097f], [0xa8e0, 0xa8ff]],
    joins: true, cased: false, stacked: true, rtl: false, minLeading: 1.35 },
  { name: 'bengali', label: 'Bengali', ranges: [[0x0980, 0x09ff]],
    joins: true, cased: false, stacked: true, rtl: false, minLeading: 1.35 },
  { name: 'gurmukhi', label: 'Gurmukhi', ranges: [[0x0a00, 0x0a7f]],
    joins: true, cased: false, stacked: true, rtl: false, minLeading: 1.3 },
  { name: 'gujarati', label: 'Gujarati', ranges: [[0x0a80, 0x0aff]],
    joins: false, cased: false, stacked: true, rtl: false, minLeading: 1.3 },
  { name: 'oriya', label: 'Odia', ranges: [[0x0b00, 0x0b7f]],
    joins: false, cased: false, stacked: true, rtl: false, minLeading: 1.3 },
  { name: 'tamil', label: 'Tamil', ranges: [[0x0b80, 0x0bff]],
    joins: false, cased: false, stacked: true, rtl: false, minLeading: 1.25 },
  { name: 'telugu', label: 'Telugu', ranges: [[0x0c00, 0x0c7f]],
    joins: false, cased: false, stacked: true, rtl: false, minLeading: 1.45 },
  { name: 'kannada', label: 'Kannada', ranges: [[0x0c80, 0x0cff]],
    joins: false, cased: false, stacked: true, rtl: false, minLeading: 1.45 },
  { name: 'malayalam', label: 'Malayalam', ranges: [[0x0d00, 0x0d7f]],
    joins: false, cased: false, stacked: true, rtl: false, minLeading: 1.3 },
  { name: 'sinhala', label: 'Sinhala', ranges: [[0x0d80, 0x0dff]],
    joins: false, cased: false, stacked: true, rtl: false, minLeading: 1.4 },

  // --- Southeast Asian: vowels stack two and three deep -------------------
  { name: 'thai', label: 'Thai', ranges: [[0x0e00, 0x0e7f]],
    joins: false, cased: false, stacked: true, rtl: false, minLeading: 1.5 },
  { name: 'lao', label: 'Lao', ranges: [[0x0e80, 0x0eff]],
    joins: false, cased: false, stacked: true, rtl: false, minLeading: 1.5 },
  { name: 'tibetan', label: 'Tibetan', ranges: [[0x0f00, 0x0fff]],
    joins: false, cased: false, stacked: true, rtl: false, minLeading: 1.6 },
  { name: 'myanmar', label: 'Myanmar', ranges: [[0x1000, 0x109f]],
    joins: false, cased: false, stacked: true, rtl: false, minLeading: 1.5 },
  { name: 'khmer', label: 'Khmer', ranges: [[0x1780, 0x17ff]],
    joins: false, cased: false, stacked: true, rtl: false, minLeading: 1.6 },

  // --- Other --------------------------------------------------------------
  { name: 'ethiopic', label: 'Ethiopic', ranges: [[0x1200, 0x139f]],
    joins: false, cased: false, stacked: false, rtl: false, minLeading: 1.1 },
  { name: 'hangul', label: 'Hangul', ranges: [[0x1100, 0x11ff], [0x3130, 0x318f], [0xac00, 0xd7af]],
    joins: false, cased: false, stacked: false, rtl: false, minLeading: 1.25 },
  { name: 'kana', label: 'Kana', ranges: [[0x3040, 0x30ff]],
    joins: false, cased: false, stacked: false, rtl: false, minLeading: 1.3 },
  { name: 'han', label: 'Han', ranges: [[0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xf900, 0xfaff]],
    joins: false, cased: false, stacked: false, rtl: false, minLeading: 1.3 },
];

const BY_NAME = new Map(SCRIPTS.map((s) => [s.name, s]));

export const scriptByName = (name: ScriptName): Script => {
  const s = BY_NAME.get(name);
  // Unreachable through the public API: ScriptName is derived from SCRIPTS.
  if (!s) throw new Error(`no such script: ${name}`);
  return s;
};

const inRanges = (cp: number, ranges: Script['ranges']): boolean =>
  ranges.some(([lo, hi]) => cp >= lo && cp <= hi);

/**
 * Which scripts a string is written in, and how many characters each
 * contributed. Characters common to every script -- spaces, digits, most
 * punctuation -- are counted by no script, because they say nothing about
 * which one you are looking at.
 */
export const detectScripts = (text: string): Array<{ script: Script; count: number }> => {
  const counts = new Map<ScriptName, number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    for (const s of SCRIPTS) {
      if (inRanges(cp, s.ranges)) {
        counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
        break;
      }
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ script: scriptByName(name), count }))
    .sort((a, b) => b.count - a.count);
};

/**
 * The script a run of text is primarily set in, ignoring scripts incidental
 * to it. A Latin brand name inside a Hindi sentence must not turn the
 * sentence into a Latin one, or every rule asks the wrong question of it.
 */
export const dominantScript = (text: string, minShare = 0.2): Script | undefined => {
  const found = detectScripts(text);
  if (found.length === 0) return undefined;
  const total = found.reduce((n, f) => n + f.count, 0);
  const top = found[0];
  if (!top || total === 0) return undefined;
  return top.count / total >= minShare ? top.script : undefined;
};
