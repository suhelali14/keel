/**
 * Each case is a configuration failure that costs real money when it is found
 * late, constructed here so the rule is seen to catch it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { preflight } from '../src/preflight.js';
import { required, optional, derived, forbidden, consistent } from '../src/rules.js';
import { memory, envFile, envDir, parseEnv, processEnv } from '../src/sources.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'));

test('a complete configuration passes', () => {
  const r = preflight({
    sources: memory({ DATABASE_URL: 'postgresql://u:p@host/db', JWT_SECRET: 'a'.repeat(32) }),
    rules: [required('DATABASE_URL', { pattern: /^postgres/ }), required('JWT_SECRET', { minLength: 16 })],
  });
  assert.equal(r.ok, true, r.report());
});

test('a missing variable is caught, and the fix is printed', () => {
  const r = preflight({
    sources: memory({}, 'tenant-a'),
    rules: [required('REDIS_URL', { because: 'The API will not start without it.' })],
  });
  assert.equal(r.ok, false);
  assert.match(r.errors[0]!.message, /REDIS_URL is not set/);
  assert.match(r.errors[0]!.message, /will not start/);
  assert.ok(r.fixes.length > 0, 'a fix command should be offered');
});

test('a placeholder value is not a value', () => {
  // The failure this exists for: a variable set to "" or "changeme" reads as
  // configured to every tool that only checks presence.
  for (const bad of ['', 'changeme', 'undefined', 'TODO']) {
    const r = preflight({
      sources: memory({ API_KEY: bad }),
      rules: [required('API_KEY')],
    });
    assert.equal(r.ok, false, `${JSON.stringify(bad)} should not pass`);
    assert.match(r.errors[0]!.message, /placeholder, not a value/);
  }
});

test('a secret is never printed, only measured', () => {
  // A distinctive value, because asserting against a short word also matches
  // "shorter" in the message itself and proves nothing.
  const LEAK = 'hunter2-do-not-print';
  const r = preflight({
    sources: memory({ JWT_SECRET: LEAK }),
    rules: [required('JWT_SECRET', { minLength: 64, secret: true })],
  });
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.errors[0]!.message, new RegExp(LEAK));
  assert.match(r.errors[0]!.message, new RegExp(`${LEAK.length} character\\(s\\)`));

  // And the same value under a non-secret rule IS shown, so the flag is
  // doing the work rather than the message happening to omit it.
  const shown = preflight({
    sources: memory({ API_KEY: LEAK }),
    rules: [required('API_KEY', { minLength: 64 })],
  });
  assert.match(shown.errors[0]!.message, new RegExp(LEAK));
});

test('derived reports when it may not write, and heals when it may', () => {
  const rule = derived('REDIS_URL', ({ name }) => `redis://redis-${name}:6379`, {
    because: 'one session store per tenant, named by convention',
  });

  // Default: a check does not change anything.
  const dry = preflight({ sources: memory({}, 'acme'), rules: [rule] });
  assert.equal(dry.ok, false);
  assert.match(dry.errors[0]!.message, /should be "redis:\/\/redis-acme:6379"/);

  // With apply, it fixes it and says so as a warning, not an error.
  const src = memory({}, 'acme');
  const wet = preflight({ sources: src, rules: [rule], apply: true });
  assert.equal(wet.ok, true, wet.report());
  assert.equal(src.get('REDIS_URL'), 'redis://redis-acme:6379');
  assert.equal(wet.healed.length, 1);
});

test('derived leaves a deliberate override alone', () => {
  const src = memory({ REDIS_URL: 'redis://somewhere-else:6379' }, 'acme');
  const r = preflight({
    sources: src,
    rules: [derived('REDIS_URL', ({ name }) => `redis://redis-${name}:6379`)],
    apply: true,
  });
  assert.equal(r.ok, true);
  assert.equal(src.get('REDIS_URL'), 'redis://somewhere-else:6379', 'an operator choice must survive');
});

test('a source that cannot be written is reported with the command to run', () => {
  const readOnly = {
    name: 'vault',
    get: () => undefined,
    howToFix: (k: string, v: string) => `vault kv put secret/app ${k}=${v}`,
  };
  const r = preflight({
    sources: readOnly,
    rules: [derived('REDIS_URL', () => 'redis://r:6379')],
    apply: true,
  });
  assert.equal(r.ok, false);
  assert.match(r.errors[0]!.message, /cannot be written/);
  assert.equal(r.fixes[0], 'vault kv put secret/app REDIS_URL=redis://r:6379');
});

test('a forbidden variable in production is caught', () => {
  const r = preflight({
    sources: memory({ SKIP_AUTH: '1' }),
    rules: [forbidden('SKIP_AUTH', 'It disables authentication.')],
  });
  assert.equal(r.ok, false);
  assert.match(r.errors[0]!.message, /disables authentication/);
});

test('two values that must agree are checked together', () => {
  // A tenant renamed in one variable and not another: everything starts, and
  // one subsystem quietly talks to the wrong place.
  const r = preflight({
    sources: memory({ REDIS_URL: 'redis://redis-old:6379', CORS_ORIGINS: 'https://new.example.com' }, 'new'),
    rules: [
      consistent(
        ['REDIS_URL', 'CORS_ORIGINS'],
        (a, b) => !!a && !!b && a.includes('new') === b.includes('new'),
        'The tenant was renamed in one and not the other.',
      ),
    ],
  });
  assert.equal(r.ok, false);
  assert.match(r.errors[0]!.message, /renamed in one and not the other/);
});

test('every source is checked, and one bad tenant does not hide the others', () => {
  const r = preflight({
    sources: [memory({ A: '1' }, 'good'), memory({}, 'bad-1'), memory({}, 'bad-2')],
    rules: [required('A')],
  });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);
  assert.deepEqual(r.errors.map((e) => e.source).sort(), ['bad-1', 'bad-2']);
});

test('a rule that throws does not silence the rules after it', () => {
  const exploding = {
    key: 'BOOM',
    check() {
      throw new Error('kaboom');
    },
  };
  const r = preflight({ sources: memory({}), rules: [exploding, required('LATER')] });
  assert.equal(r.errors.length, 2, 'both the crash and the later rule should report');
  assert.match(r.errors[0]!.message, /rule threw while checking: kaboom/);
  assert.match(r.errors[1]!.message, /LATER is not set/);
});

test('optional is silent when absent and strict when present', () => {
  const absent = preflight({ sources: memory({}), rules: [optional('PORT', { pattern: /^\d+$/ })] });
  assert.equal(absent.ok, true);

  const wrong = preflight({ sources: memory({ PORT: 'abc' }), rules: [optional('PORT', { pattern: /^\d+$/ })] });
  assert.equal(wrong.ok, false);
});

/* ------------------------------------------------------------- dotenv ---- */

test('the dotenv parser handles the forms people actually write', () => {
  const parsed = parseEnv(
    [
      '# a comment',
      '',
      'PLAIN=value',
      'QUOTED="with spaces"',
      "SINGLE='single'",
      'export EXPORTED=yes',
      '  SPACED = trimmed  ',
      'URL=postgres://u:p@h/db?schema=public',
      'EMPTY=',
      'NOT_A_LINE',
    ].join('\n'),
  );
  assert.equal(parsed.PLAIN, 'value');
  assert.equal(parsed.QUOTED, 'with spaces');
  assert.equal(parsed.SINGLE, 'single');
  assert.equal(parsed.EXPORTED, 'yes');
  assert.equal(parsed.SPACED, 'trimmed');
  assert.equal(parsed.URL, 'postgres://u:p@h/db?schema=public');
  assert.equal(parsed.EMPTY, '');
  assert.equal(parsed.NOT_A_LINE, undefined);
});

test('healing a real file appends, and a second run is a no-op', () => {
  const dir = tmp();
  const file = path.join(dir, 'acme.env');
  fs.writeFileSync(file, '# hand written, order matters\nDATABASE_URL=postgres://u:p@h/db\n');

  const rule = derived('REDIS_URL', ({ name }) => `redis://redis-${name}:6379`, {
    because: 'one session store per tenant',
  });

  const first = preflight({ sources: envFile(file), rules: [rule], apply: true });
  assert.equal(first.ok, true, first.report());
  const after = fs.readFileSync(file, 'utf8');
  assert.match(after, /REDIS_URL=redis:\/\/redis-acme:6379/);
  assert.match(after, /# one session store per tenant/);
  assert.match(after, /# hand written, order matters/, 'existing comments must survive');

  const second = preflight({ sources: envFile(file), rules: [rule], apply: true });
  assert.equal(second.healed.length, 0, 'a second run must change nothing');
  assert.equal(fs.readFileSync(file, 'utf8'), after);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('envDir reads one source per tenant and can exclude non-tenants', () => {
  const dir = tmp();
  for (const n of ['acme', 'globex', 'provider']) {
    fs.writeFileSync(path.join(dir, `${n}.env`), 'DATABASE_URL=postgres://u:p@h/db\n');
  }
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignore me');

  const sources = envDir(dir, { exclude: ['provider'] });
  assert.deepEqual(sources.map((s) => s.name), ['acme', 'globex']);

  const r = preflight({ sources, rules: [required('DATABASE_URL')] });
  assert.equal(r.ok, true, r.report());

  fs.rmSync(dir, { recursive: true, force: true });
});

test('processEnv is a source like any other', () => {
  const env = { FOO: 'bar' } as NodeJS.ProcessEnv;
  const r = preflight({ sources: processEnv(env), rules: [required('FOO')] });
  assert.equal(r.ok, true);
});

test('the report names the sources and lists every fix once', () => {
  const r = preflight({
    sources: [memory({}, 'a'), memory({}, 'b')],
    rules: [required('X', { fix: 'set X somewhere' })],
  });
  const text = r.report();
  assert.match(text, /2 problem\(s\) found\. Nothing was deployed\./);
  assert.match(text, /^a:$/m);
  assert.match(text, /^b:$/m);
  assert.equal(r.fixes.length, 1, 'an identical fix should be listed once');
});
