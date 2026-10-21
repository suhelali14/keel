/**
 * Deciding which elements actually cause a horizontal overflow.
 *
 * Kept pure, and separate from the browser, for one reason: this is where a
 * tool like this is useful or useless. Reporting every element whose right
 * edge exceeds the viewport produces dozens of findings, most of them
 * children of one real cause and several of them inside a scroller that is
 * supposed to scroll. A check that cries wolf gets switched off, and then it
 * catches nothing at all.
 *
 * Being pure, it is also testable without a browser, which is why the rules
 * below have tests rather than hopes.
 */

/** One element, as measured in the page. */
export type Measured = {
  /** A readable selector, for a human to go and look at. */
  selector: string;
  /** Ancestor chain, outermost first. Used to find leaves. */
  path: string;
  left: number;
  right: number;
  width: number;
  /** An ancestor clips horizontally and holds this element inside itself. */
  clipped: boolean;
  /** position: fixed or sticky. */
  fixed: boolean;
  /** Depth from <html>. */
  depth: number;
};

export type Cause = {
  selector: string;
  path: string;
  /** How far past the viewport it reaches, in px. */
  exceedsBy: number;
  width: number;
  left: number;
  right: number;
  /** Why this one is reported and others were not. */
  why: string;
};

export type Analysis = {
  viewport: number;
  scrollWidth: number;
  /** scrollWidth - viewport. Zero or less means no overflow. */
  overflow: number;
  causes: Cause[];
  /** Flagged, then dismissed, with the reason. Kept so the tool can explain
   *  itself when somebody insists there is a bug it did not report. */
  dismissed: { selector: string; why: string }[];
};

export type AnalyseOptions = {
  /** Sub-pixel layout and scrollbar rounding make a 1px "overflow" normal. */
  tolerance?: number;
  /** Most reports are one cause and its children. */
  maxCauses?: number;
};

export function analyse(
  measurements: Measured[],
  viewport: number,
  scrollWidth: number,
  options: AnalyseOptions = {},
): Analysis {
  const { tolerance = 1, maxCauses = 10 } = options;
  const overflow = scrollWidth - viewport;

  const result: Analysis = { viewport, scrollWidth, overflow, causes: [], dismissed: [] };
  if (overflow <= tolerance) return result;

  const dismiss = (m: Measured, why: string) => result.dismissed.push({ selector: m.selector, why });

  const candidates: Measured[] = [];
  for (const m of measurements) {
    if (m.width <= 0) {
      dismiss(m, 'zero width');
      continue;
    }
    if (m.right <= viewport + tolerance) {
      // Does not reach past the edge at all.
      continue;
    }
    if (m.clipped) {
      // The tab strip inside overflow-x: auto. Its right edge is genuinely
      // past the viewport and it is genuinely not the problem -- an earlier
      // version of this check reported six of these and the real cause was a
      // table somewhere else entirely.
      dismiss(m, 'inside a horizontally scrollable ancestor, so it is clipped, not causing');
      continue;
    }
    if (m.fixed) {
      // A fixed element is out of flow and does not extend the document.
      dismiss(m, 'position is fixed or sticky, so it does not extend the document');
      continue;
    }
    candidates.push(m);
  }

  // Two different shapes of cause, and they want opposite rules.
  //
  // Something genuinely wider than the viewport -- a table, a pre, an image
  // with a fixed width -- is the thing to fix, and its children are merely
  // carried along by it. Reporting those children is useless: a first version
  // of this blamed five 90px <td> cells for a 720px table, which tells you
  // nothing you can act on. So for these, report the OUTERMOST.
  //
  // Something that fits but starts too far right -- a badge pushed by a
  // margin, an absolutely positioned decoration -- has no oversized ancestor
  // to blame, and there the innermost element is the one with the offending
  // geometry.
  const tooWide = candidates.filter((m) => m.width > viewport + tolerance);
  const pushedOut = candidates.filter((m) => m.width <= viewport + tolerance);

  let blamed: Measured[];
  if (tooWide.length > 0) {
    blamed = tooWide.filter((m) => {
      const outer = tooWide.find((other) => other !== m && m.path.startsWith(other.path + ' > '));
      if (outer) {
        dismiss(m, `carried by ${outer.selector}, which is the wider element`);
        return false;
      }
      return true;
    });
    for (const m of pushedOut) {
      dismiss(m, 'fits the viewport; it is pushed out by a wider ancestor already reported');
    }
  } else {
    blamed = pushedOut.filter((m) => {
      const inner = pushedOut.find((other) => other !== m && other.path.startsWith(m.path + ' > '));
      if (inner) {
        dismiss(m, `contains ${inner.selector}, which is the more specific cause`);
        return false;
      }
      return true;
    });
  }

  result.causes = blamed
    .map((m) => ({
      selector: m.selector,
      path: m.path,
      exceedsBy: Math.round(m.right - viewport),
      width: Math.round(m.width),
      left: Math.round(m.left),
      right: Math.round(m.right),
      why:
        m.width > viewport
          ? `it is ${Math.round(m.width)}px wide in a ${viewport}px viewport`
          : `it starts at ${Math.round(m.left)}px and is ${Math.round(m.width)}px wide`,
    }))
    .sort((a, b) => b.exceedsBy - a.exceedsBy)
    .slice(0, maxCauses);

  return result;
}

/** A short line per cause, for a terminal or a CI annotation. */
export function explain(a: Analysis): string[] {
  if (a.overflow <= 0) return [];
  const lines = [
    `${a.viewport}px viewport scrolls to ${a.scrollWidth}px (${a.overflow}px of overflow)`,
  ];
  if (a.causes.length === 0) {
    lines.push(
      '  no element could be blamed. Every candidate was clipped, fixed, or zero width.',
      '  A margin, a transform or a pseudo-element is the usual answer here.',
    );
    return lines;
  }
  for (const c of a.causes) {
    lines.push(`  ${c.selector}`);
    lines.push(`    reaches ${c.exceedsBy}px past the edge; ${c.why}`);
    lines.push(`    ${c.path}`);
  }
  return lines;
}
