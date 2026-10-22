import type { CheckResult } from './check.js';
import type { Finding, Impact, RuleId } from './analyse.js';

const IMPACT_LABEL: Record<Impact, string> = {
  critical: 'critical',
  serious: 'serious',
  moderate: 'moderate',
};

export interface FormatOptions {
  /** Emit `::error::` lines GitHub Actions turns into annotations. */
  readonly forCi?: boolean;
  /** Example elements to list under each rule. 0 means all of them. */
  readonly examples?: number;
}

type Group = {
  rule: RuleId;
  impact: Impact;
  fix: string;
  findings: Array<Finding & { widths: readonly number[] }>;
};

/**
 * Grouped by rule, because one stylesheet mistake is one mistake.
 *
 * A single `text-transform` on a shared label class produced 110 findings on
 * a real page -- all true, all the same line of CSS, and together a wall
 * nobody reads to the end of. The rule is stated once with its fix; the
 * elements are evidence for it, listed a few at a time with a count of the
 * rest.
 */
const group = (
  findings: CheckResult['findings'],
): Group[] => {
  const byRule = new Map<RuleId, Group>();
  for (const f of findings) {
    const existing = byRule.get(f.rule);
    if (existing) {
      existing.findings.push(f);
      // Within a rule, the worst impact any element reached is the rule's.
      if (f.impact === 'critical') existing.impact = 'critical';
      else if (f.impact === 'serious' && existing.impact === 'moderate') existing.impact = 'serious';
    } else {
      byRule.set(f.rule, { rule: f.rule, impact: f.impact, fix: f.fix, findings: [f] });
    }
  }
  const order: Record<Impact, number> = { critical: 0, serious: 1, moderate: 2 };
  return [...byRule.values()].sort(
    (a, b) => order[a.impact] - order[b.impact] || b.findings.length - a.findings.length,
  );
};

/**
 * The report.
 *
 * It states the result, not a count. An earlier tool in this repo printed
 * "0 of 0 route(s) failed" for a run that had failed before it examined
 * anything, which reads exactly like success -- so the verdict here comes
 * from `ok` and nothing else.
 */
export const format = (result: CheckResult, options: FormatOptions = {}): string => {
  const examples = options.examples ?? 4;
  const lines: string[] = [];
  const scripts = result.scripts.length ? result.scripts.join(', ') : 'none found';
  const widths = result.byWidth.map((w) => `${w.width}px`).join(', ');
  const examined = Math.max(0, ...result.byWidth.map((w) => w.result.examined));

  lines.push(result.url);
  lines.push(`  scripts   ${scripts}`);
  lines.push(`  examined  ${examined} text element(s) at ${widths}`);
  lines.push('');

  if (result.ok) {
    lines.push(
      examined === 0
        ? 'No non-Latin text found, so there was nothing for these rules to check.'
        : `No text faults found in ${scripts}.`,
    );
    return lines.join('\n');
  }

  const groups = group(result.findings);

  for (const g of groups) {
    const n = g.findings.length;
    const allWidths = [...new Set(g.findings.flatMap((f) => f.widths))].sort((a, b) => a - b);
    const at = allWidths.length === result.byWidth.length
      ? 'every width'
      : allWidths.map((w) => `${w}px`).join(', ');

    lines.push(`${IMPACT_LABEL[g.impact]}  ${g.rule}  -  ${n} element${n === 1 ? '' : 's'}, ${at}`);
    lines.push(`  ${g.findings[0]!.summary}`);
    lines.push(`  fix  ${g.fix}`);
    lines.push('');

    const shown = examples > 0 ? g.findings.slice(0, examples) : g.findings;
    for (const f of shown) {
      lines.push(`    ${f.selector}`);
      lines.push(`      "${f.text}"`);
      lines.push(`      ${f.detail}`);
    }
    if (shown.length < n) {
      lines.push(`    ... and ${n - shown.length} more (--examples 0 to list them all)`);
    }
    lines.push('');

    if (options.forCi) {
      // One annotation per rule, not per element: a hundred annotations for
      // one line of CSS buries every other check in the run.
      lines.push(`::error::${g.rule}: ${g.findings[0]!.summary} (${n} element${n === 1 ? '' : 's'}, first at ${g.findings[0]!.selector})`);
    }
  }

  const counts = (['critical', 'serious', 'moderate'] as const)
    .map((i) => [i, groups.filter((g) => g.impact === i).length] as const)
    .filter(([, c]) => c > 0)
    .map(([i, c]) => `${c} ${i}`)
    .join(', ');
  const total = result.findings.length;

  lines.push(
    `${groups.length} rule${groups.length === 1 ? '' : 's'} broken (${counts}), ` +
    `across ${total} element${total === 1 ? '' : 's'}.`,
  );
  return lines.join('\n');
};
