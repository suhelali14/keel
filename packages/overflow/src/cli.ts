#!/usr/bin/env node
/**
 * overflow https://example.com
 * overflow https://example.com --widths 320,390,768 --json
 *
 * Exits non-zero when the page scrolls sideways at any width. That is what
 * makes it a gate rather than a report nobody reads.
 */
import { sweep, DEFAULT_WIDTHS } from './sweep.js';
import { explain } from './analyse.js';

const USAGE = [
  'overflow - find horizontal overflow at every breakpoint, and name the element',
  '',
  '  overflow <url> [options]',
  '',
  'Options',
  `  --widths a,b,c     viewport widths (default ${DEFAULT_WIDTHS.join(',')})`,
  '  --height <n>       viewport height (default 900)',
  '  --settle-ms <n>    wait after navigation for layout (default 600)',
  '  --tolerance <n>    px of overflow to ignore (default 1)',
  '  --endpoint <url>   running Chrome (default http://127.0.0.1:9222)',
  '  --json             print the full result as JSON',
  '',
  'Needs a Chrome with remote debugging:',
  '  chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/ovf about:blank',
  '',
  'Already using Playwright? Use the adapter instead:',
  "  import { sweepPage } from '@nayaverse/overflow/playwright'",
].join('\n');

function main() {
  const argv = process.argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
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
  const widths =
    typeof flags.widths === 'string'
      ? flags.widths
          .split(',')
          .map((w) => Number(w.trim()))
          .filter((n) => Number.isFinite(n) && n > 0)
      : [...DEFAULT_WIDTHS];

  if (widths.length === 0) {
    console.error('overflow: --widths had no usable numbers');
    process.exit(1);
  }

  const num = (k: string, d: number) => (flags[k] === undefined ? d : Number(flags[k]));

  sweep({
    url,
    widths,
    height: num('height', 900),
    settleMs: num('settle-ms', 600),
    tolerance: num('tolerance', 1),
    ...(typeof flags.endpoint === 'string' ? { cdp: { endpoint: flags.endpoint } } : {}),
    onProgress: flags.json ? () => {} : (line: string) => console.log(line),
  })
    .then((result) => {
      if (flags.json) {
        console.log(JSON.stringify(result.results, null, 2));
      } else if (!result.ok) {
        // The one-line-per-width summary already streamed through onProgress.
        // What follows is the detail for the widths that failed, in full:
        // the selector, how far it reaches, and where it sits in the tree.
        console.log('');
        for (const r of result.results) {
          if (r.overflow > 0) for (const line of explain(r)) console.log(line);
        }
        console.log('');
        console.log(`Horizontal overflow at ${result.failedAt.join(', ')}px.`);
      } else {
        console.log('');
        console.log(`No horizontal overflow at any of ${result.results.length} width(s).`);
      }
      process.exit(result.ok ? 0 : 1);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}

main();
