#!/usr/bin/env node
/**
 * glyphcheck https://example.com/hi
 * glyphcheck https://example.com/ar --widths 390,1280 --ci
 *
 * Exits non-zero when the page has a text fault, so it can gate a deploy
 * rather than produce a report nobody opens.
 */
import { ALL_RULES, type RuleId } from './analyse.js';
import { check } from './check.js';
import { format } from './report.js';

const USAGE = [
  'glyphcheck - find the text faults you cannot see in a script you cannot read',
  '',
  '  glyphcheck <url> [options]',
  '',
  'Checks for',
  '  font-fallback        glyphs drawn by a font your stylesheet never named',
  '  line-collision       lines of text overlapping each other',
  '  glyph-clipping       text cut off by a box sized for Latin',
  '  tracking-damage      letter-spacing severing a connected script',
  '  case-transform       text-transform on a script with no letter case',
  '  direction-missing    right-to-left text laid out left to right',
  '  physical-text-align  text-align: left/right hard-coded inside rtl',
  '',
  'Options',
  '  --widths a,b         viewport widths (default 390,1280)',
  '  --height <n>         viewport height (default 900)',
  '  --settle-ms <n>      wait after navigation for fonts (default 1200)',
  '  --only <a,b>         run just these rules',
  '  --skip <a,b>         run everything except these rules',
  '  --max-elements <n>   stop after this many text elements (default 400)',
  '  --examples <n>       example elements listed per rule (default 4, 0 for all)',
  '  --tracking-em <n>    letter-spacing to tolerate, in em (default 0.015)',
  '  --endpoint <url>     running Chrome (default http://127.0.0.1:9222)',
  '  --ci                 add ::error:: annotations for GitHub Actions',
  '  --json               print the full result as JSON',
  '',
  'Needs a Chrome with remote debugging:',
  '  chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/gc about:blank',
  '',
  'Already using Playwright? Use the adapter instead:',
  "  import { checkPage } from '@nayaverse/glyphcheck/playwright'",
].join('\n');

const parseRules = (value: string, flag: string): RuleId[] => {
  const asked = value.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = asked.filter((a) => !(ALL_RULES as readonly string[]).includes(a));
  if (unknown.length) {
    // Silently ignoring an unknown rule name is how a run comes to check
    // nothing while reporting success.
    console.error(`glyphcheck: ${flag} does not know: ${unknown.join(', ')}`);
    console.error(`  known rules: ${ALL_RULES.join(', ')}`);
    process.exit(1);
  }
  return asked as RuleId[];
};

function main(): void {
  const argv = process.argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=', 2);
      if (inline !== undefined) flags[k!] = inline;
      else if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) flags[k!] = argv[++i]!;
      else flags[k!] = true;
    } else rest.push(a);
  }

  if (flags.help || flags.h || rest.length === 0) {
    console.log(USAGE);
    process.exit(rest.length === 0 ? 1 : 0);
  }

  const url = rest[0]!;
  const num = (k: string, d: number): number => (flags[k] === undefined ? d : Number(flags[k]));

  const widths = typeof flags.widths === 'string'
    ? flags.widths.split(',').map((w) => Number(w.trim())).filter((n) => Number.isFinite(n) && n > 0)
    : undefined;
  if (typeof flags.widths === 'string' && (!widths || widths.length === 0)) {
    console.error('glyphcheck: --widths had no usable numbers');
    process.exit(1);
  }

  if (typeof flags.only === 'string' && typeof flags.skip === 'string') {
    console.error('glyphcheck: pass --only or --skip, not both');
    process.exit(1);
  }
  const only = typeof flags.only === 'string' ? parseRules(flags.only, '--only') : undefined;
  const skip = typeof flags.skip === 'string' ? parseRules(flags.skip, '--skip') : undefined;
  const disabled = only
    ? ALL_RULES.filter((r) => !only.includes(r))
    : (skip ?? []);

  check(url, {
    ...(widths ? { widths } : {}),
    height: num('height', 900),
    settleMs: num('settle-ms', 1200),
    maxElements: num('max-elements', 400),
    trackingToleranceEm: num('tracking-em', 0.015),
    disabled,
    ...(typeof flags.endpoint === 'string' ? { endpoint: flags.endpoint } : {}),
  })
    .then((result) => {
      console.log(
        flags.json
          ? JSON.stringify(result, null, 2)
          : format(result, { forCi: Boolean(flags.ci), examples: num('examples', 4) }),
      );
      // The exit code comes from the result, never from a count of anything.
      process.exit(result.ok ? 0 : 1);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}

main();
