#!/usr/bin/env node
/**
 * Point the packages at real sites and find out whether they are worth
 * anything.
 *
 *   node scripts/survey.mjs --endpoint http://127.0.0.1:9222
 *
 * The question this answers is not "do the tools run" but "do they find
 * things on pages their authors were paid to get right". A survey that comes
 * back empty is a real result and is reported as one.
 *
 * THE ONE PROPERTY THAT MATTERS
 *
 * A page that 403s a headless browser, sits behind a consent wall, redirects
 * to English, or simply has no non-Latin text reports ZERO findings. That is
 * indistinguishable from a clean page unless the harness refuses to conflate
 * them. So every site lands in exactly one of:
 *
 *   FINDINGS     faults found, with the fix
 *   CLEAN        loaded, text in the expected script examined, nothing wrong
 *   NO TARGET    loaded, but no text in the script we came to look at
 *   UNREACHABLE  HTTP error, a body too small to be a page, or nothing examined
 *   SKIPPED      robots.txt asked us not to
 *
 * Only FINDINGS and CLEAN count as tested. Everything else is excluded from
 * the denominator, because counting an unreachable site as a pass is how a
 * survey comes to report that the web is fine.
 */

import { writeFileSync } from 'node:fs';
import { check, format } from '@nayaverse/glyphcheck';
import { sweep, explain } from '@nayaverse/overflow';
import { SITES, CONTROLS } from './sites.mjs';

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};

const ENDPOINT = String(flag('endpoint', 'http://127.0.0.1:9222'));
const DELAY_MS = Number(flag('delay', 3000));
const WIDTHS = String(flag('widths', '390,1280')).split(',').map(Number);
const OUT = String(flag('out', 'survey-report.md'));
const ONLY = flag('only', null);
const SKIP_OVERFLOW = argv.includes('--no-overflow');
const SKIP_ROBOTS = argv.includes('--no-robots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Politeness
//
// This loads one page per site, the way a visitor does, sequentially, with a
// gap. It is a measurement, not a crawl. Still: robots.txt is checked first,
// because a tool that visits other people's sites in a loop should ask, and
// because a published tool that does not will be the first complaint.
// ---------------------------------------------------------------------------

const robotsCache = new Map();

const robotsAllows = async (url) => {
  if (SKIP_ROBOTS) return true;
  const u = new URL(url);
  const origin = u.origin;

  if (!robotsCache.has(origin)) {
    let rules = [];
    try {
      const res = await fetch(`${origin}/robots.txt`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const text = await res.text();
        let applies = false;
        for (const raw of text.split('\n')) {
          const line = raw.split('#')[0].trim();
          const [keyRaw, ...rest] = line.split(':');
          if (!keyRaw || rest.length === 0) continue;
          const key = keyRaw.trim().toLowerCase();
          const value = rest.join(':').trim();
          if (key === 'user-agent') applies = value === '*';
          else if (applies && key === 'disallow' && value) rules.push(value);
          else if (applies && key === 'allow' && value) rules.push(`ALLOW:${value}`);
        }
      }
    } catch {
      // No robots.txt, or it would not load. Absence is permission.
    }
    robotsCache.set(origin, rules);
  }

  const rules = robotsCache.get(origin);
  const path = u.pathname + u.search;
  // Longest match wins, Allow beats Disallow at equal length -- the ordering
  // every major crawler uses.
  let verdict = true;
  let bestLength = -1;
  for (const rule of rules) {
    const allow = rule.startsWith('ALLOW:');
    const pattern = allow ? rule.slice(6) : rule;
    if (!path.startsWith(pattern)) continue;
    if (pattern.length > bestLength) {
      bestLength = pattern.length;
      verdict = allow;
    }
  }
  return verdict;
};

// ---------------------------------------------------------------------------
// Reachability
//
// Asked before the browser, so an unreachable page is named as unreachable
// rather than silently producing an empty finding list.
// ---------------------------------------------------------------------------

const reachable = async (url) => {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(25_000),
      headers: { 'accept-language': 'hi,mr,ta,ar,th,bn,en;q=0.5' },
    });
    const body = await res.text();
    return {
      ok: res.ok && body.length > 2000,
      status: res.status,
      bytes: body.length,
      finalUrl: res.url,
      // A page that answered 200 in a few hundred bytes is a wall, not a page.
      why: !res.ok
        ? `HTTP ${res.status}`
        : body.length <= 2000
          ? `HTTP 200 but only ${body.length} bytes, which is a wall rather than a page`
          : '',
    };
  } catch (err) {
    return { ok: false, status: 0, bytes: 0, finalUrl: url, why: String(err?.message ?? err) };
  }
};

// ---------------------------------------------------------------------------
// One site
// ---------------------------------------------------------------------------

const surveyOne = async (site) => {
  const row = { ...site, verdict: 'UNREACHABLE', glyph: null, overflow: null, notes: [] };

  if (!(await robotsAllows(site.url))) {
    row.verdict = 'SKIPPED';
    row.notes.push('robots.txt disallows this path for anonymous agents');
    return row;
  }

  const net = await reachable(site.url);
  row.status = net.status;
  row.bytes = net.bytes;
  if (!net.ok) {
    row.notes.push(net.why);
    return row;
  }
  if (net.finalUrl !== site.url) row.notes.push(`redirected to ${net.finalUrl}`);

  // --- glyphcheck ---------------------------------------------------------
  try {
    const result = await check(site.url, { widths: WIDTHS, endpoint: ENDPOINT, settleMs: 2500 });
    row.glyph = result;
    const examined = Math.max(0, ...result.byWidth.map((w) => w.result.examined));
    const scripts = result.scripts.map((s) => s.toLowerCase());

    if (examined === 0) {
      row.verdict = 'UNREACHABLE';
      row.notes.push(
        'the page loaded over HTTP but the browser found no non-Latin text in it ' +
          '— a consent wall, a bot block, or client-side rendering that did not finish',
      );
      return row;
    }

    // Did we get the language we came for? A redirect to English, or a
    // cookie-driven locale, turns a real test into a meaningless pass.
    const wanted = (site.script ?? '').toLowerCase();
    if (wanted && wanted !== 'latin' && !scripts.includes(wanted)) {
      row.verdict = 'NO TARGET';
      row.notes.push(`expected ${wanted}, found ${scripts.join(', ') || 'nothing'}`);
      return row;
    }

    row.verdict = result.findings.length > 0 ? 'FINDINGS' : 'CLEAN';
    row.examined = examined;
  } catch (err) {
    row.notes.push(`glyphcheck threw: ${err?.message ?? err}`);
    return row;
  }

  // --- overflow -----------------------------------------------------------
  // Applies to any site, unlike verify-deploy, which asserts a build stamp
  // only the site's own owner can put there. Said plainly rather than
  // stretching a package to fit the survey.
  if (!SKIP_OVERFLOW) {
    try {
      const ov = await sweep({
        url: site.url,
        widths: WIDTHS,
        settleMs: 2500,
        cdp: { endpoint: ENDPOINT },
        onProgress: () => {},
      });
      row.overflow = ov;
      if (!ov.ok) row.verdict = 'FINDINGS';
    } catch (err) {
      row.notes.push(`overflow threw: ${err?.message ?? err}`);
    }
  }

  return row;
};

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const MARK = {
  FINDINGS: 'FINDINGS',
  CLEAN: 'clean',
  'NO TARGET': 'no target',
  UNREACHABLE: 'unreachable',
  SKIPPED: 'skipped',
};

const buildReport = (rows) => {
  const out = [];
  const tested = rows.filter((r) => r.verdict === 'FINDINGS' || r.verdict === 'CLEAN');
  const withFindings = rows.filter((r) => r.verdict === 'FINDINGS');
  const excluded = rows.filter((r) => !['FINDINGS', 'CLEAN'].includes(r.verdict));

  out.push('# Survey');
  out.push('');
  out.push(`Run ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC at ${WIDTHS.join('px, ')}px.`);
  out.push('');

  // --- the verdict, first, and derived from the counts -------------------
  if (tested.length === 0) {
    out.push('**No site could be tested.** Every entry was unreachable, served the');
    out.push('wrong language, or was skipped. This says nothing about the packages —');
    out.push('fix the harness or the list and run it again.');
  } else if (withFindings.length === 0) {
    out.push(`**${tested.length} site(s) tested, none with a fault.**`);
    out.push('');
    out.push('That is a real result and it argues against the packages: the rules');
    out.push('found nothing on pages that serve these scripts at scale. Either the');
    out.push('rules are too narrow, or this class of bug is rarer than one project');
    out.push('suggested. Worth saying out loud before promoting anything.');
  } else {
    const pct = Math.round((withFindings.length / tested.length) * 100);
    out.push(`**${withFindings.length} of ${tested.length} site(s) tested had at least one fault** (${pct}%).`);
  }
  out.push('');

  // --- the table ----------------------------------------------------------
  out.push('| Site | Verdict | Elements examined | Rules broken | Overflow |');
  out.push('| --- | --- | --- | --- | --- |');
  for (const r of rows) {
    const rules = r.glyph
      ? [...new Set(r.glyph.findings.map((f) => f.rule))].join(', ') || '—'
      : '—';
    const ov = r.overflow ? (r.overflow.ok ? 'none' : `${r.overflow.failedAt.join(', ')}px`) : '—';
    out.push(
      `| ${r.name} | ${MARK[r.verdict]} | ${r.examined ?? '—'} | ${rules} | ${ov} |`,
    );
  }
  out.push('');

  // --- what was excluded, and why ----------------------------------------
  if (excluded.length) {
    out.push('## Not tested');
    out.push('');
    out.push('Excluded from the count above. None of these is evidence of anything.');
    out.push('');
    for (const r of excluded) {
      out.push(`- **${r.name}** — ${MARK[r.verdict]}: ${r.notes.join('; ') || 'no reason recorded'}`);
    }
    out.push('');
  }

  // --- the findings, per site --------------------------------------------
  if (withFindings.length) {
    out.push('## Findings');
    out.push('');
    for (const r of withFindings) {
      out.push(`### ${r.name}`);
      out.push('');
      out.push(`\`${r.url}\``);
      out.push('');
      if (r.glyph && r.glyph.findings.length) {
        out.push('```');
        out.push(format(r.glyph, { examples: 2 }));
        out.push('```');
        out.push('');
      }
      if (r.overflow && !r.overflow.ok) {
        out.push('Horizontal overflow:');
        out.push('');
        out.push('```');
        for (const a of r.overflow.results) {
          if (a.overflow > 0) for (const line of explain(a)) out.push(line);
        }
        out.push('```');
        out.push('');
      }
    }

    // --- the aggregate: which rule earns its place ----------------------
    out.push('## Which rules earned their place');
    out.push('');
    const byRule = new Map();
    for (const r of withFindings) {
      for (const f of r.glyph?.findings ?? []) {
        if (!byRule.has(f.rule)) byRule.set(f.rule, { sites: new Set(), elements: 0, fix: f.fix });
        const e = byRule.get(f.rule);
        e.sites.add(r.name);
        e.elements += 1;
      }
    }
    out.push('| Rule | Sites | Elements |');
    out.push('| --- | --- | --- |');
    for (const [rule, e] of [...byRule].sort((a, b) => b[1].sites.size - a[1].sites.size)) {
      out.push(`| ${rule} | ${e.sites.size} | ${e.elements} |`);
    }
    out.push('');
    const unfired = ['font-fallback', 'line-collision', 'glyph-clipping', 'tracking-damage',
      'case-transform', 'direction-missing', 'physical-text-align']
      .filter((r) => !byRule.has(r));
    if (unfired.length) {
      out.push(`**Fired on nothing: ${unfired.join(', ')}.** A rule that never fires on a`);
      out.push('real page is either sound and rare, or wrong and silent. Each one needs a');
      out.push('deliberately broken fixture proving it CAN fire before it is trusted.');
      out.push('');
    }

    out.push('## How to fix what was found');
    out.push('');
    for (const [rule, e] of byRule) {
      out.push(`**${rule}** — ${e.fix}`);
      out.push('');
    }
  }

  return out.join('\n');
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const main = async () => {
  let list = [...CONTROLS, ...SITES];
  if (typeof ONLY === 'string') {
    const needle = ONLY.toLowerCase();
    list = list.filter((s) => s.name.toLowerCase().includes(needle) || s.url.includes(needle));
  }

  try {
    const res = await fetch(`${ENDPOINT}/json/version`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    console.error(`survey: no Chrome at ${ENDPOINT}.`);
    console.error('Start one with:');
    console.error('  chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/survey about:blank');
    process.exit(1);
  }

  console.log(`Surveying ${list.length} page(s) at ${WIDTHS.join(', ')}px, ${DELAY_MS}ms apart.\n`);

  const rows = [];
  for (const [i, site] of list.entries()) {
    process.stdout.write(`  [${i + 1}/${list.length}] ${site.name} … `);
    const row = await surveyOne(site);
    rows.push(row);
    const n = row.glyph?.findings.length ?? 0;
    const ov = row.overflow && !row.overflow.ok ? ` +overflow@${row.overflow.failedAt.join(',')}` : '';
    console.log(
      row.verdict === 'FINDINGS' ? `${n} finding(s)${ov}`
        : row.verdict === 'CLEAN' ? 'clean'
          : `${MARK[row.verdict]} — ${row.notes[0] ?? ''}`,
    );
    // One page per site, spaced out. Nothing here needs to be fast.
    if (i < list.length - 1) await sleep(DELAY_MS);
  }

  const report = buildReport(rows);
  writeFileSync(OUT, `${report}\n`, 'utf8');
  writeFileSync(OUT.replace(/\.md$/, '.json'), `${JSON.stringify(rows, null, 2)}\n`, 'utf8');

  console.log(`\n${'-'.repeat(68)}`);
  const tested = rows.filter((r) => ['FINDINGS', 'CLEAN'].includes(r.verdict));
  const found = rows.filter((r) => r.verdict === 'FINDINGS');
  console.log(
    tested.length === 0
      ? 'No site could be tested. This says nothing about the packages.'
      : `${found.length} of ${tested.length} tested page(s) had a fault. ` +
        `${rows.length - tested.length} excluded as untestable.`,
  );
  console.log(`Report: ${OUT}`);

  // A survey is a report, not a gate. It exits 0 whatever it finds, so it
  // never ends up wired into a pipeline where "the web is fine today" would
  // fail somebody's build.
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
