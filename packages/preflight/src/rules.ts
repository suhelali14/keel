/**
 * Rules: what must be true of a source before anything expensive happens.
 *
 * Each rule is a pure function from a source to findings. None of them read
 * the network, and none of them throw — a rule that crashes while checking is
 * a rule that stops the other rules from reporting, and the most useful output
 * is the complete list.
 */
import type { Source } from './sources.js';

export type Severity = 'error' | 'warning';

export type Finding = {
  severity: Severity;
  source: string;
  key: string;
  message: string;
  /** How a human fixes it, when there is a single obvious command. */
  fix?: string;
  /** Set by `derived` when it healed the value itself. */
  healed?: boolean;
};

export type RuleContext = {
  source: Source;
  /** Whether writes are permitted this run. */
  apply: boolean;
};

export type Rule = {
  readonly key: string;
  check(ctx: RuleContext): Finding[];
};

/** Values that are present but meaningless. Catching these is most of the
 *  value: a variable set to the empty string reads as "configured". */
const EMPTY = new Set(['', 'undefined', 'null', 'none', 'changeme', 'xxx', 'todo']);

export type RequiredOptions = {
  /** The value must match. */
  pattern?: RegExp;
  minLength?: number;
  oneOf?: readonly string[];
  /** Never print the value in output. */
  secret?: boolean;
  /** Said instead of the generic message. Explain the consequence. */
  because?: string;
  /** Shown as the fix. Overrides the source's own suggestion. */
  fix?: string;
};

const show = (value: string, secret?: boolean) =>
  secret ? `${value.length} character(s)` : JSON.stringify(value);

export function required(key: string, options: RequiredOptions = {}): Rule {
  return {
    key,
    check({ source }) {
      const value = source.get(key);
      const why = options.because ? ` ${options.because}` : '';

      if (value === undefined) {
        const f: Finding = { severity: 'error', source: source.name, key, message: `${key} is not set.${why}` };
        const fix = options.fix ?? source.howToFix(key, '<value>');
        if (fix) f.fix = fix;
        return [f];
      }
      if (EMPTY.has(value.trim().toLowerCase())) {
        return [
          {
            severity: 'error',
            source: source.name,
            key,
            message: `${key} is set to ${JSON.stringify(value)}, which is a placeholder, not a value.${why}`,
          },
        ];
      }
      if (options.minLength !== undefined && value.length < options.minLength) {
        return [
          {
            severity: 'error',
            source: source.name,
            key,
            message: `${key} is ${show(value, options.secret)}, shorter than the required ${options.minLength}.${why}`,
          },
        ];
      }
      if (options.oneOf && !options.oneOf.includes(value)) {
        return [
          {
            severity: 'error',
            source: source.name,
            key,
            message: `${key} is ${JSON.stringify(value)}; expected one of ${options.oneOf.join(', ')}.${why}`,
          },
        ];
      }
      if (options.pattern && !options.pattern.test(value)) {
        return [
          {
            severity: 'error',
            source: source.name,
            key,
            message: `${key} does not match ${options.pattern}. Got ${show(value, options.secret)}.${why}`,
          },
        ];
      }
      return [];
    },
  };
}

/** Present-but-wrong is an error; absent is fine. */
export function optional(key: string, options: RequiredOptions = {}): Rule {
  const inner = required(key, options);
  return {
    key,
    check(ctx) {
      return ctx.source.get(key) === undefined ? [] : inner.check(ctx);
    },
  };
}

export type DerivedOptions = {
  /** Written into the file above the value, so the next reader knows why. */
  because?: string;
  /** Report rather than write, even when `apply` is true. */
  readOnly?: boolean;
  /** Replace an existing value that does not match. Off by default: an
   *  operator's deliberate override should survive a deploy. */
  overwrite?: boolean;
};

/**
 * A value that is neither a secret nor a choice, and can therefore be computed.
 *
 * This is the rule that earns the package. A variable newly required by a
 * release was missing from a tenant's env file; the deploy pulled 2.5 GB,
 * migrated the database, restarted, failed its health check and rolled back —
 * to discover something knowable in two seconds and fixable without asking
 * anyone, because the value follows from the tenant's own name.
 */
export function derived(
  key: string,
  compute: (ctx: { source: Source; name: string }) => string,
  options: DerivedOptions = {},
): Rule {
  return {
    key,
    check({ source, apply }) {
      const want = compute({ source, name: source.name });
      const have = source.get(key);

      if (have !== undefined && (!options.overwrite || have === want)) return [];

      const verb = have === undefined ? 'was missing' : `was ${JSON.stringify(have)}`;

      if (!apply || options.readOnly || !source.set) {
        const reason = !source.set ? ' This source cannot be written.' : '';
        return [
          {
            severity: 'error',
            source: source.name,
            key,
            message: `${key} ${verb} and should be ${JSON.stringify(want)}.${reason}`,
            fix: source.howToFix(key, want),
          },
        ];
      }

      source.set(key, want, options.because);
      return [
        {
          severity: 'warning',
          source: source.name,
          key,
          message: `${key} ${verb}; set to ${JSON.stringify(want)}.`,
          healed: true,
        },
      ];
    },
  };
}

/** A variable that must NOT be present. A dev override left in production, a
 *  debug flag, a bypass. */
export function forbidden(key: string, because: string): Rule {
  return {
    key,
    check({ source }) {
      return source.get(key) === undefined
        ? []
        : [
            {
              severity: 'error',
              source: source.name,
              key,
              message: `${key} is set, and must not be. ${because}`,
            },
          ];
    },
  };
}

/**
 * Two values that must agree.
 *
 * The failure worth preventing: a tenant renamed in one variable and not in
 * another. Everything starts, and one subsystem talks to the wrong place.
 */
export function consistent(
  keys: [string, string],
  agree: (a: string | undefined, b: string | undefined) => boolean,
  because: string,
): Rule {
  const [a, b] = keys;
  return {
    key: `${a}+${b}`,
    check({ source }) {
      const va = source.get(a);
      const vb = source.get(b);
      return agree(va, vb)
        ? []
        : [
            {
              severity: 'error',
              source: source.name,
              key: `${a}, ${b}`,
              message: `${a} and ${b} disagree. ${because}`,
            },
          ];
    },
  };
}
