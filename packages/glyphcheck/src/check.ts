import { analyse, parseFontStack, type AnalyseOptions, type AnalyseResult, type Finding, type Measured } from './analyse.js';
import { CdpSession, type CdpOptions } from './cdp.js';
import { CLEANUP_SCRIPT, COLLECT_SCRIPT, type RawCollected } from './collect.js';

export interface CheckOptions extends AnalyseOptions, CdpOptions {
  /**
   * Viewport widths to check.
   *
   * More than one, because two of the rules only have an answer at a given
   * width: lines can only collide once the text wraps, and a box can only
   * clip once the text is too tall for it. A stylesheet that is correct on a
   * desktop and broken on a phone is the common case, not the exception.
   */
  readonly widths?: readonly number[];
  readonly height?: number;
  readonly settleMs?: number;
  /** Stop after this many text elements per width. */
  readonly maxElements?: number;
}

export interface WidthResult {
  readonly width: number;
  readonly result: AnalyseResult;
}

export interface CheckResult {
  readonly url: string;
  readonly ok: boolean;
  /** Findings merged across widths, each carrying the widths it appeared at. */
  readonly findings: ReadonlyArray<Finding & { readonly widths: readonly number[] }>;
  readonly byWidth: readonly WidthResult[];
  /** Scripts found anywhere on the page, most text first. */
  readonly scripts: readonly string[];
}

const DEFAULT_WIDTHS = [390, 1280] as const;

/**
 * Measure one page at each width and report what is wrong with its text.
 *
 * The session is the caller's to provide when they have one; otherwise one is
 * opened and closed here.
 */
export const check = async (url: string, options: CheckOptions = {}): Promise<CheckResult> => {
  const session = await CdpSession.open(options);
  try {
    return await checkWith(session, url, options);
  } finally {
    await session.close();
  }
};

/** The same check against a session the caller owns. */
export const checkWith = async (
  session: CdpSession,
  url: string,
  options: CheckOptions = {},
): Promise<CheckResult> => {
  const widths = options.widths?.length ? [...options.widths] : [...DEFAULT_WIDTHS];
  const maxElements = options.maxElements ?? 400;
  const byWidth: WidthResult[] = [];

  for (const width of widths) {
    await session.setViewport(width, options.height ?? 900);
    await session.goto(url, options.settleMs ?? 1200);

    const raw = ((await session.evaluate(COLLECT_SCRIPT)) ?? []) as RawCollected[];
    const measured: Measured[] = [];

    for (const r of raw.slice(0, maxElements)) {
      const resolved = await session.platformFontsFor(r.probe);
      measured.push({
        selector: r.selector,
        tag: r.tag,
        text: r.text,
        declaredFamilies: parseFontStack(r.rawFontFamily),
        resolvedFonts: resolved.map((f) => ({
          family: f.familyName,
          glyphCount: f.glyphCount,
          isCustomFont: f.isCustomFont,
        })),
        fontSizePx: r.fontSizePx,
        lineHeightPx: r.lineHeightPx,
        letterSpacingPx: r.letterSpacingPx,
        textTransform: r.textTransform,
        direction: r.direction,
        textAlign: r.textAlign,
        lineBoxes: r.lineBoxes,
        contentTop: r.contentTop,
        contentBottom: r.contentBottom,
        clipped: r.clipped,
      });
    }

    await session.evaluate(CLEANUP_SCRIPT);
    byWidth.push({ width, result: analyse(measured, options) });
  }

  // The same stylesheet fault shows up at every width. Reporting it once per
  // width turns one bug into a wall, and the person reading has to work out
  // that the wall is one line.
  const merged = new Map<string, Finding & { widths: number[] }>();
  for (const { width, result } of byWidth) {
    for (const f of result.findings) {
      const key = `${f.rule}|${f.selector}|${f.text}`;
      const existing = merged.get(key);
      // Several distinct elements can share a selector and a string -- a
      // repeated label, a list of the same word. They are one finding, and
      // the width it was seen at is one entry, not one per element.
      if (existing) {
        if (!existing.widths.includes(width)) existing.widths.push(width);
      } else {
        merged.set(key, { ...f, widths: [width] });
      }
    }
  }

  const scripts = [...new Set(byWidth.flatMap((w) => w.result.scripts))];
  const findings = [...merged.values()];

  return {
    url,
    ok: findings.length === 0,
    findings,
    byWidth,
    scripts,
  };
};
