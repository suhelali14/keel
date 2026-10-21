/**
 * Playwright adapter.
 *
 * No dependency on Playwright: the page is accepted structurally, so this
 * compiles and ships whether or not Playwright is installed. If you already
 * use Playwright, prefer this over the bundled CDP driver — Playwright
 * already sets the viewport with device metrics, which is the part that
 * matters.
 */
import { checkViewport, DEFAULT_WIDTHS } from './sweep.js';
import { explain, type Analysis, type AnalyseOptions } from './analyse.js';

/** The shape this needs from a Playwright Page. */
export type PlaywrightPage = {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  evaluate<R>(fn: string): Promise<R>;
  viewportSize(): { width: number; height: number } | null;
};

/** Check the page as it is, at its current viewport. */
export async function checkPage(
  page: PlaywrightPage,
  options: AnalyseOptions = {},
): Promise<Analysis> {
  return checkViewport((expr) => page.evaluate(expr), options);
}

export type PlaywrightSweepOptions = AnalyseOptions & {
  widths?: readonly number[];
  height?: number;
  onProgress?: (line: string) => void;
};

export type PlaywrightSweepResult = {
  ok: boolean;
  results: Analysis[];
  failedAt: number[];
  report(): string;
};

/**
 * Check every width, then put the viewport back where it was.
 *
 * Restoring matters: a check that silently leaves the page at 320px makes the
 * next assertion in the same test fail for a reason that is not its own.
 */
export async function sweepPage(
  page: PlaywrightPage,
  options: PlaywrightSweepOptions = {},
): Promise<PlaywrightSweepResult> {
  const { widths = DEFAULT_WIDTHS, height = 900, onProgress = () => {}, ...rest } = options;
  const original = page.viewportSize();
  const results: Analysis[] = [];

  try {
    for (const width of widths) {
      await page.setViewportSize({ width, height });
      const analysis = await checkPage(page, rest);
      results.push(analysis);
      onProgress(
        analysis.overflow > 0
          ? `${String(width).padStart(5)}px  OVERFLOW ${analysis.overflow}px`
          : `${String(width).padStart(5)}px  ok`,
      );
    }
  } finally {
    if (original) await page.setViewportSize(original);
  }

  const failedAt = results.filter((r) => r.overflow > 0).map((r) => r.viewport);
  return {
    ok: failedAt.length === 0,
    results,
    failedAt,
    report: () =>
      results
        .flatMap((r) => (r.overflow > 0 ? explain(r) : [`${String(r.viewport).padStart(5)}px  ok`]))
        .join('\n'),
  };
}
