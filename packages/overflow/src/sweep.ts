/**
 * Walk a set of viewport widths and report, for each, whether the page
 * scrolls sideways and which element is responsible.
 */
import { analyse, explain, type Analysis, type AnalyseOptions } from './analyse.js';
import { collect, type Evaluate } from './collect.js';
import { CdpSession, type CdpOptions } from './cdp.js';

/** The widths worth checking by default: the narrowest phone still in use,
 *  the common Android and iPhone sizes, the large phone, the tablet, the
 *  small laptop, and a desktop. */
export const DEFAULT_WIDTHS = [320, 360, 390, 414, 768, 1024, 1440] as const;

export type SweepResult = {
  ok: boolean;
  url?: string;
  /** One per width, in the order checked. */
  results: Analysis[];
  /** Widths at which the page overflowed. */
  failedAt: number[];
  report(): string;
};

function makeResult(results: Analysis[], url?: string): SweepResult {
  const failedAt = results.filter((r) => r.overflow > 0).map((r) => r.viewport);
  return {
    ok: failedAt.length === 0,
    ...(url ? { url } : {}),
    results,
    failedAt,
    report() {
      const lines: string[] = [];
      for (const r of results) {
        if (r.overflow > 0) {
          lines.push(...explain(r));
        } else {
          lines.push(`${String(r.viewport).padStart(5)}px  ok`);
        }
      }
      lines.push('');
      lines.push(
        failedAt.length === 0
          ? `No horizontal overflow at any of ${results.length} width(s).`
          : `Horizontal overflow at ${failedAt.join(', ')}px.`,
      );
      return lines.join('\n');
    },
  };
}

/**
 * Check one already-loaded page at its current viewport.
 *
 * Use this when you own the browser: Playwright, Puppeteer, or your own CDP
 * session. `evaluate` is anything that runs an expression in the page and
 * returns its value.
 */
export async function checkViewport(
  evaluate: Evaluate,
  options: AnalyseOptions = {},
): Promise<Analysis> {
  const { viewport, scrollWidth, measurements } = await collect(evaluate);
  return analyse(measurements, viewport, scrollWidth, options);
}

export type SweepOptions = AnalyseOptions & {
  url: string;
  widths?: readonly number[];
  /** Height for each check. Only matters for lazy content. */
  height?: number;
  /** Milliseconds to wait after navigation for layout to settle. */
  settleMs?: number;
  cdp?: CdpOptions;
  onProgress?: (line: string) => void;
};

/**
 * Open a page at each width and check it, using the bundled CDP driver.
 *
 * The viewport is set with device metrics rather than a window size, which is
 * the only way to get an honest narrow viewport. See cdp.ts.
 */
export async function sweep(options: SweepOptions): Promise<SweepResult> {
  const {
    url,
    widths = DEFAULT_WIDTHS,
    height = 900,
    settleMs = 600,
    cdp,
    onProgress = () => {},
    ...analyseOptions
  } = options;

  const session = await CdpSession.open(cdp ?? {});
  const results: Analysis[] = [];
  try {
    for (const width of widths) {
      await session.setViewport(width, height);
      await session.goto(url, settleMs);
      const analysis = await checkViewport((e) => session.evaluate(e), analyseOptions);
      results.push(analysis);
      onProgress(
        analysis.overflow > 0
          ? `${String(width).padStart(5)}px  OVERFLOW ${analysis.overflow}px — ${
              analysis.causes[0]?.selector ?? 'no element could be blamed'
            }`
          : `${String(width).padStart(5)}px  ok`,
      );
    }
  } finally {
    await session.close();
  }
  return makeResult(results, url);
}

/**
 * Sweep using a browser you already drive.
 *
 * `setViewport` and `evaluate` are yours, so this works with Playwright,
 * Puppeteer, or anything else, without this package depending on any of them.
 */
export async function sweepWith(
  page: { setViewport(width: number, height: number): Promise<void>; evaluate: Evaluate },
  options: Omit<SweepOptions, 'url' | 'cdp'> & { url?: string } = {},
): Promise<SweepResult> {
  const {
    widths = DEFAULT_WIDTHS,
    height = 900,
    onProgress = () => {},
    url,
    settleMs,
    ...analyseOptions
  } = options;
  void settleMs;

  const results: Analysis[] = [];
  for (const width of widths) {
    await page.setViewport(width, height);
    const analysis = await checkViewport(page.evaluate, analyseOptions);
    results.push(analysis);
    onProgress(
      analysis.overflow > 0
        ? `${String(width).padStart(5)}px  OVERFLOW ${analysis.overflow}px`
        : `${String(width).padStart(5)}px  ok`,
    );
  }
  return makeResult(results, url);
}
