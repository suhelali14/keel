/**
 * Run every rule against every source, before anything expensive happens.
 *
 * The contract: preflight never performs the expensive work and never exits
 * the process. It returns what it found. The caller decides, which is what
 * lets the same call be a hard gate in a deploy and a warning in a dev shell.
 */
import type { Finding, Rule } from './rules.js';
import type { Source } from './sources.js';

export type PreflightOptions = {
  sources: Source | Source[];
  rules: Rule[];
  /** Permit `derived` to write. Default false: a check does not change things
   *  unless it was asked to. */
  apply?: boolean;
  /** Called with each line, for live output. */
  onProgress?: (line: string) => void;
};

export type PreflightResult = {
  ok: boolean;
  findings: Finding[];
  errors: Finding[];
  warnings: Finding[];
  healed: Finding[];
  sources: string[];
  /** A copy-pasteable list of the commands that would fix every error. */
  fixes: string[];
  /** One block of text, ready to print or put in a CI annotation. */
  report(): string;
};

export function preflight(options: PreflightOptions): PreflightResult {
  const sources = Array.isArray(options.sources) ? options.sources : [options.sources];
  const { rules, apply = false, onProgress = () => {} } = options;

  if (sources.length === 0) throw new Error('preflight: at least one source is required');
  if (rules.length === 0) throw new Error('preflight: at least one rule is required');

  const findings: Finding[] = [];

  for (const source of sources) {
    for (const rule of rules) {
      let produced: Finding[];
      try {
        produced = rule.check({ source, apply });
      } catch (err) {
        // A rule that throws must not silence the rules after it. The whole
        // point is to report everything wrong in one pass.
        produced = [
          {
            severity: 'error',
            source: source.name,
            key: rule.key,
            message: `rule threw while checking: ${err instanceof Error ? err.message : String(err)}`,
          },
        ];
      }
      for (const f of produced) {
        findings.push(f);
        onProgress(
          `  ${f.severity === 'error' ? 'FAIL' : 'ok  '} ${f.source}/${f.key}: ${f.message}`,
        );
      }
    }
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const healed = findings.filter((f) => f.healed === true);
  const fixes = Array.from(new Set(errors.map((f) => f.fix).filter((x): x is string => !!x)));

  return {
    ok: errors.length === 0,
    findings,
    errors,
    warnings,
    healed,
    sources: sources.map((s) => s.name),
    fixes,
    report() {
      const lines: string[] = [];
      if (healed.length) {
        lines.push(`Fixed ${healed.length} value(s) automatically:`);
        for (const f of healed) lines.push(`  ${f.source}: ${f.message}`);
        lines.push('');
      }
      if (errors.length === 0) {
        lines.push(
          `Configuration is complete across ${sources.length} source(s): ${sources
            .map((s) => s.name)
            .join(', ')}.`,
        );
        return lines.join('\n');
      }
      lines.push(`${errors.length} problem(s) found. Nothing was deployed.`);
      lines.push('');
      let current = '';
      for (const f of errors) {
        if (f.source !== current) {
          lines.push(`${f.source}:`);
          current = f.source;
        }
        lines.push(`  ${f.message}`);
      }
      if (fixes.length) {
        lines.push('');
        lines.push('To fix:');
        for (const fix of fixes) lines.push(`  ${fix}`);
      }
      return lines.join('\n');
    },
  };
}
