# @nayaverse/preflight

**Validate configuration across many sources before anything expensive
happens — and write back what can be computed.**

Zero dependencies. Node 20+.

```bash
npm i -D @nayaverse/preflight
```

---

## Read this first: you may not need it

For validating **one process's** environment, use
[t3-env](https://github.com/t3-oss/t3-env) or
[envalid](https://github.com/af/envalid). They are mature, widely used, and
better at that job than this is. A
[2026 survey](https://www.pkgpulse.com/guides/best-env-variable-management-nodejs-2026)
puts t3-env as the default for TypeScript stacks and envalid as the solid
standalone choice. Plain [Zod](https://zod.dev) is fine too.

This package exists for three things none of them do, all of which only show
up once you are deploying the same codebase many times:

1. **Many sources in one pass**, with the failure named per source
2. **Healing a value that is neither a secret nor a choice**
3. **Printing the command that fixes it** when a source cannot be written

If none of those describe your problem, use t3-env and skip this.

---

## 1. Many sources

One deployment per customer means one config per customer, and a rule has to
hold for all of them. Every library above validates `process.env` — one
environment, one process.

```ts
import { preflight, required, envDir } from '@nayaverse/preflight';

const result = preflight({
  sources: envDir('/srv/app/env', { exclude: ['control-plane'] }),
  rules: [
    required('DATABASE_URL', { pattern: /^postgres(ql)?:\/\// }),
    required('JWT_SECRET', { minLength: 32, secret: true }),
  ],
});

if (!result.ok) {
  console.error(result.report());
  process.exit(1);
}
```

```
2 problem(s) found. Nothing was deployed.

acme:
  JWT_SECRET is 12 character(s), shorter than the required 32.
globex:
  DATABASE_URL is not set.

To fix:
  echo 'DATABASE_URL=<value>' | sudo tee -a /srv/app/env/globex.env
```

One bad tenant does not hide the others, and the report names which.

## 2. Healing

The rule that earns the package.

A release newly required `REDIS_URL`. One tenant's config predated it. The
deploy pulled 2.5 GB, migrated the database, restarted the container, failed
its health check and rolled back — to discover something knowable in two
seconds, and fixable without asking anyone, because the value follows from the
tenant's own name.

```ts
derived('REDIS_URL', ({ name }) => `redis://redis-${name}:6379`, {
  because: 'one session store per tenant, named by convention',
});
```

With `apply: true` it writes the value and reports a warning. Without, it
reports an error and the exact line to run. Either way the deploy is not
halfway through when you find out.

It **leaves a deliberate override alone** — an operator who set something
different meant it — unless you pass `overwrite`.

## 3. The fix command

When a source cannot be written — a file owned by root, a secrets manager —
the failure carries the command:

```ts
const vault = {
  name: 'vault',
  get: (k) => read(k),
  howToFix: (k, v) => `vault kv put secret/app ${k}=${v}`,
};
```

```
REDIS_URL was missing and should be "redis://redis-acme:6379". This source cannot be written.

To fix:
  vault kv put secret/app REDIS_URL=redis://redis-acme:6379
```

---

## Rules

| Rule | |
|---|---|
| `required(key, opts)` | must be present and valid |
| `optional(key, opts)` | silent when absent, strict when present |
| `derived(key, fn, opts)` | computed; healed when `apply` |
| `forbidden(key, because)` | must **not** be set — a dev override in production |
| `consistent([a, b], fn, because)` | two values that must agree |

`required` options: `pattern`, `minLength`, `oneOf`, `secret`, `because`, `fix`.

**Placeholders are not values.** `''`, `undefined`, `null`, `none`,
`changeme`, `xxx` and `todo` all fail, because a variable set to one of those
reads as configured to anything that only checks presence.

**Secrets are measured, never printed.** With `secret: true` the message says
`12 character(s)`, not the value.

## Sources

| Source | |
|---|---|
| `processEnv(env?)` | one process |
| `envFile(path, opts)` | a dotenv file; appends when healing, preserving comments |
| `envDir(dir, opts)` | one source per `*.env`, for the multi-tenant case |
| `memory(values, name)` | tests, and config you already hold |

A source is three functions — `name`, `get`, `howToFix`, plus an optional
`set`. A secrets manager or a database row is a source if it can do those.

---

## Behaviour worth knowing

**It never performs the expensive work, and never exits.** It returns what it
found; the caller decides. That is what lets the same call be a hard gate in a
deploy and a warning in a dev shell.

**A rule that throws does not silence the rules after it.** The crash is
reported as a finding and the pass continues, because the useful output is the
complete list.

**Writes are off by default.** A check does not change things unless asked.

## Tests

Seventeen, each a configuration failure that costs money when found late.

```bash
npm test
```

## Licence

MIT.
