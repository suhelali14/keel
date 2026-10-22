/**
 * Which element, exactly, convinced analyse() that this page has a face for
 * the script?
 *
 * The font-fallback rule reports a critical fault only when the page is proven
 * to ship a face for that script and one element missed it. If that proof is
 * wrong, every "critical" resting on it is wrong too -- so it is worth being
 * able to see the element that supplied it.
 */
import { CdpSession } from '../packages/glyphcheck/dist/src/cdp.js';
import { COLLECT_SCRIPT, CLEANUP_SCRIPT } from '../packages/glyphcheck/dist/src/collect.js';
import { parseFontStack, primaryFont, resolvedFromStack } from '../packages/glyphcheck/dist/src/analyse.js';
import { dominantScript } from '../packages/glyphcheck/dist/src/scripts.js';

const url = process.argv[2];
const endpoint = process.argv[3] ?? 'http://127.0.0.1:9222';

const s = await CdpSession.open({ endpoint });
await s.setViewport(1280, 900);
await s.goto(url, 2500);
const raw = await s.evaluate(COLLECT_SCRIPT);

const proofs = [];
for (const r of raw.slice(0, 400)) {
  const script = dominantScript(r.text);
  if (!script || script.name === 'latin') continue;
  const declared = parseFontStack(r.rawFontFamily);
  const fonts = (await s.platformFontsFor(r.probe))
    .map((f) => ({ family: f.familyName, glyphCount: f.glyphCount }));
  // The font that drew the script, not any font that appeared beside it.
  const primary = primaryFont(fonts);
  if (primary && resolvedFromStack(primary.family, declared)) {
    proofs.push({
      script: script.name, hit: `${primary.family} (${primary.glyphCount} glyphs)`,
      declared: declared.join(', '),
      resolved: fonts.map((f) => `${f.family} (${f.glyphCount})`).join(', '),
      text: r.text.slice(0, 30), sel: r.selector.slice(-60),
    });
  }
}
await s.evaluate(CLEANUP_SCRIPT);

console.log(`${url}`);
console.log(`elements proving coverage: ${proofs.length} of ${raw.length} non-Latin`);
const byScript = new Map();
for (const p of proofs) if (!byScript.has(p.script)) byScript.set(p.script, p);
for (const [script, p] of byScript) {
  console.log(`\n  ${script}  <- proven by "${p.hit}"`);
  console.log(`    declared: ${p.declared}`);
  console.log(`    rendered: ${p.resolved}`);
  console.log(`    text    : "${p.text}"`);
  console.log(`    at      : ${p.sel}`);
}
if (!proofs.length) console.log('\n  none -- this page ships no face for any script it serves');
await s.close();
