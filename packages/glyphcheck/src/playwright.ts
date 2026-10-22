/**
 * For pipelines that already run Playwright.
 *
 * Playwright is not a dependency of this package -- the types below are the
 * narrow shape actually used, so importing this file costs nothing to anyone
 * who does not call it. Chromium only: `CSS.getPlatformFontsForNode` is a
 * Chrome DevTools Protocol command, and it is the one thing here that cannot
 * be done any other way.
 */

import {
  analyse, parseFontStack,
  type AnalyseOptions, type Finding, type Measured, type ResolvedFont,
} from './analyse.js';
import type { CheckResult, WidthResult } from './check.js';
import { CLEANUP_SCRIPT, COLLECT_SCRIPT, type RawCollected } from './collect.js';

interface CdpLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

interface PageLike {
  url(): string;
  goto(url: string, options?: { waitUntil?: string }): Promise<unknown>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  evaluate<T>(expression: string): Promise<T>;
  context(): { newCDPSession(page: PageLike): Promise<CdpLike> };
}

export interface CheckPageOptions extends AnalyseOptions {
  readonly widths?: readonly number[];
  readonly height?: number;
  readonly maxElements?: number;
  /**
   * A URL to navigate to. Omit it to check the page where it already is,
   * which is the point of the adapter: the state you want to check is often
   * three clicks into a flow and has no URL of its own.
   */
  readonly url?: string;
}

const DEFAULT_WIDTHS = [390, 1280] as const;

export const checkPage = async (
  page: PageLike,
  options: CheckPageOptions = {},
): Promise<CheckResult> => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');

  const widths = options.widths?.length ? [...options.widths] : [...DEFAULT_WIDTHS];
  const maxElements = options.maxElements ?? 400;
  const byWidth: WidthResult[] = [];

  const platformFontsFor = async (selector: string): Promise<ResolvedFont[]> => {
    try {
      const { root } = (await cdp.send('DOM.getDocument', { depth: -1 })) as {
        root: { nodeId: number };
      };
      const { nodeId } = (await cdp.send('DOM.querySelector', {
        nodeId: root.nodeId,
        selector,
      })) as { nodeId: number };
      if (!nodeId) return [];
      const { fonts } = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })) as {
        fonts?: Array<{ familyName: string; glyphCount: number; isCustomFont: boolean }>;
      };
      return (fonts ?? []).map((f) => ({
        family: f.familyName,
        glyphCount: f.glyphCount,
        isCustomFont: f.isCustomFont,
      }));
    } catch {
      return [];
    }
  };

  for (const width of widths) {
    await page.setViewportSize({ width, height: options.height ?? 900 });
    if (options.url) await page.goto(options.url, { waitUntil: 'load' });
    // A font that has not arrived is being drawn by a fallback, which is the
    // exact fault this reports. Waiting for it is not politeness.
    await page.evaluate<boolean>('document.fonts.ready.then(() => true)');

    const raw = (await page.evaluate<RawCollected[]>(COLLECT_SCRIPT)) ?? [];
    const measured: Measured[] = [];
    for (const r of raw.slice(0, maxElements)) {
      measured.push({
        selector: r.selector,
        tag: r.tag,
        text: r.text,
        declaredFamilies: parseFontStack(r.rawFontFamily),
        resolvedFonts: await platformFontsFor(r.probe),
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
    await page.evaluate<number>(CLEANUP_SCRIPT);
    byWidth.push({ width, result: analyse(measured, options) });
  }

  const merged = new Map<string, Finding & { widths: number[] }>();
  for (const { width, result } of byWidth) {
    for (const f of result.findings) {
      const key = `${f.rule}|${f.selector}|${f.text}`;
      const existing = merged.get(key);
      if (existing) {
        if (!existing.widths.includes(width)) existing.widths.push(width);
      } else {
        merged.set(key, { ...f, widths: [width] });
      }
    }
  }
  const findings = [...merged.values()];

  return {
    url: options.url ?? page.url(),
    ok: findings.length === 0,
    findings,
    byWidth,
    scripts: [...new Set(byWidth.flatMap((w) => w.result.scripts))],
  };
};
