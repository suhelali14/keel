#!/usr/bin/env node
/**
 * verify-deploy --site https://example.com --build $GITHUB_SHA / /pricing
 * verify-deploy stamp --into dist --build $GITHUB_SHA
 *
 * Exits non-zero when the site is not serving this build, or a route does not
 * answer. That exit code is the whole point: it is what turns a green deploy
 * into an honest one.
 */
import { stamp } from './stamp.js';
import { verify } from './verify.js';

type Args = { flags: Record<string, string | boolean>; rest: string[] };

function parse(argv: string[]): Args {
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
  return { flags, rest };
}

const USAGE = `
verify-deploy - assert the public URL serves the build you just shipped

  verify-deploy stamp --into <dir|file> --build <id> [--name x-build]
  verify-deploy --site <origin> [--build <id>] [options] <route...>

Options
  --site <origin>      public origin, e.g. https://example.com
  --build <id>         build id that must be live (usually the commit sha)
  --min-bytes <n>      byte floor for document routes (default 2000)
  --retries <n>        attempts while waiting for promotion (default 8)
  --wait-ms <n>        delay between attempts (default 15000)
  --timeout-ms <n>     per-request timeout (default 30000)
  --json               print the result as JSON
`.trim();

async function main() {
  const argv = process.argv.slice(2);
  const { flags, rest } = parse(argv);

  if (flags.help || flags.h || argv.length === 0) {
    console.log(USAGE);
    process.exit(argv.length === 0 ? 1 : 0);
  }

  if (rest[0] === 'stamp') {
    const into = String(flags.into ?? 'dist');
    const build = String(flags.build ?? '');
    if (!build) {
      console.error('verify-deploy stamp: --build is required');
      process.exit(1);
    }
    const r = stamp({ into, build, ...(flags.name ? { name: String(flags.name) } : {}) });
    console.log(
      `stamped ${r.stamped.length} file(s) with ${r.build}` +
        (r.alreadyStamped.length ? `, ${r.alreadyStamped.length} already current` : '') +
        (r.skipped.length ? `, ${r.skipped.length} skipped` : ''),
    );
    for (const s of r.skipped) console.log(`  skipped ${s.file}: ${s.reason}`);
    return;
  }

  const site = String(flags.site ?? '');
  if (!site) {
    console.error('verify-deploy: --site is required\n');
    console.error(USAGE);
    process.exit(1);
  }
  // `--routes /,/pricing` exists because of the next guard: on Git Bash a
  // bare `/` argument is rewritten to the MSYS install path before this
  // process ever sees it.
  const fromFlag = typeof flags.routes === 'string' ? flags.routes.split(',').map((s) => s.trim()) : [];
  // A leading slash is optional, and "." means the root. Both exist so that
  // routes can be written in a form Git Bash will not rewrite.
  const routes = (fromFlag.length ? fromFlag : rest.length ? rest : ['/']).map((r) =>
    r === '.' || r === '' ? '/' : r.startsWith('/') ? r : `/${r}`,
  );

  // Git Bash converts POSIX-looking arguments to Windows paths, so `/` and
  // `/pricing` arrive as `C:/Program Files/Git/` and `.../pricing`. Every
  // request then fails for a reason that has nothing to do with the site,
  // which is exactly the kind of adjacent-truth failure this tool exists to
  // stop. Caught here rather than reported as seven dead routes.
  // The leading slash is optional because routes are normalised above, so a
  // rewritten "/" arrives as "/C:/...". Matching on the drive letter rather
  // than on "Program Files" keeps this working wherever MSYS is installed.
  const mangled = routes.filter((r) => /^\/?[A-Za-z]:[\\/]/.test(r));
  if (mangled.length) {
    console.error(
      `verify-deploy: ${mangled.length} route(s) arrived as Windows paths, e.g. ${JSON.stringify(mangled[0])}.`,
    );
    console.error('Your shell rewrote them before this process saw them. Either of these fixes it:');
    console.error('  MSYS_NO_PATHCONV=1 verify-deploy --site ... / /pricing');
    console.error('  verify-deploy --site ... --routes ".,pricing,mr"   # no leading slash');
    process.exit(1);
  }

  const num = (k: string, d: number) => (flags[k] === undefined ? d : Number(flags[k]));

  const result = await verify({
    site,
    routes,
    ...(flags.build ? { build: String(flags.build) } : {}),
    minBytes: num('min-bytes', 2000),
    retries: { times: num('retries', 8), waitMs: num('wait-ms', 15_000) },
    timeoutMs: num('timeout-ms', 30_000),
    onProgress: flags.json ? () => {} : (line) => console.log(line),
  });

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const p of result.problems) console.error(`error: ${p}`);
    for (const r of result.routes) {
      for (const p of r.problems) console.error(`error: ${r.path} ${p}`);
    }

    // The summary reports result.ok, never a route tally. When the build
    // check fails the run short-circuits before examining any route, and
    // "0 of 0 route(s) failed" reads exactly like success.
    if (result.ok) {
      console.log(`\nevery route answered${result.build ? `, on build ${result.build}` : ''}`);
    } else if (result.routes.length === 0) {
      console.log('\nFAILED: the site is not serving this build. No routes were checked.');
    } else {
      const bad = result.routes.filter((r) => !r.ok).length;
      const extra = result.problems.length
        ? `, plus ${result.problems.length} site-level problem(s)`
        : '';
      console.log(`\nFAILED: ${bad} of ${result.routes.length} route(s)${extra}`);
    }
  }

  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
