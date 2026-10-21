/**
 * Where configuration is read from, and written back to.
 *
 * A source is three functions. That is the whole interface, which is what
 * makes "any config store" true rather than aspirational: a secrets manager,
 * a parameter store or a database row is a source if it can get, set and
 * describe itself.
 */
import fs from 'node:fs';
import path from 'node:path';

export type Source = {
  /** Shown in messages. A tenant name, a file path, 'process.env'. */
  readonly name: string;
  get(key: string): string | undefined;
  /** Absent when the source cannot be written. Preflight then reports the
   *  exact command to run instead of failing silently. */
  set?(key: string, value: string, comment?: string): void;
  /** How a human would fix this source by hand. */
  howToFix(key: string, value: string): string;
};

/* ------------------------------------------------------------------ env --- */

export function processEnv(env: NodeJS.ProcessEnv = process.env): Source {
  return {
    name: 'process.env',
    get: (key) => env[key],
    set: (key, value) => {
      env[key] = value;
    },
    howToFix: (key, value) => `export ${key}='${value}'`,
  };
}

/* --------------------------------------------------------------- dotenv --- */

/**
 * A minimal dotenv parser.
 *
 * Deliberately not a dependency: the format is twelve lines of parsing, and a
 * tool whose job is to run before anything expensive should not drag a
 * package tree in front of itself.
 *
 * Handles `KEY=value`, `KEY="value"`, `KEY='value'`, `export KEY=value`,
 * comments, and blank lines. It does not do interpolation, because a config
 * value that depends on another config value is a thing worth noticing rather
 * than resolving quietly.
 */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf('=');
    if (eq < 1) continue;
    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export type EnvFileOptions = {
  /** Shown in messages instead of the path. Usually a tenant name. */
  name?: string;
  /** Appending is how `derived` heals a file. Off for read-only sources. */
  writable?: boolean;
};

export function envFile(file: string, options: EnvFileOptions = {}): Source {
  const name = options.name ?? path.basename(file, '.env');
  if (!fs.existsSync(file)) {
    throw new Error(`preflight: no env file at ${file}`);
  }
  let cache = parseEnv(fs.readFileSync(file, 'utf8'));

  const source: Source = {
    name,
    get: (key) => cache[key],
    howToFix: (key, value) => `echo '${key}=${value}' | sudo tee -a ${file}`,
  };

  if (options.writable !== false) {
    source.set = (key, value, comment) => {
      const block =
        (comment ? `\n# ${comment.split('\n').join('\n# ')}\n` : '\n') + `${key}=${value}\n`;
      // Append rather than rewrite: these files are hand-edited and often
      // hold comments and ordering somebody cares about.
      fs.appendFileSync(file, block, 'utf8');
      cache = parseEnv(fs.readFileSync(file, 'utf8'));
    };
  }

  return source;
}

/**
 * Every `*.env` in a directory, as one source each.
 *
 * This is the multi-tenant shape: one file per customer, and a rule has to
 * hold for all of them. `exclude` is for the files that are not tenants.
 */
export function envDir(
  dir: string,
  options: EnvFileOptions & { exclude?: string[]; extension?: string } = {},
): Source[] {
  const { exclude = [], extension = '.env', ...rest } = options;
  if (!fs.existsSync(dir)) throw new Error(`preflight: no directory at ${dir}`);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(extension))
    .map((f) => path.basename(f, extension))
    .filter((name) => !exclude.includes(name))
    .sort()
    .map((name) => envFile(path.join(dir, `${name}${extension}`), { ...rest, name }));
}

/* ---------------------------------------------------------------- plain --- */

/** An in-memory source. Useful in tests, and for a config object you already
 *  hold. Writable so `derived` can be exercised without touching a disk. */
export function memory(values: Record<string, string>, name = 'memory'): Source {
  const store = { ...values };
  return {
    name,
    get: (key) => store[key],
    set: (key, value) => {
      store[key] = value;
    },
    howToFix: (key, value) => `set ${key}=${value}`,
  };
}
