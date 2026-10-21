/**
 * Put the build id into the artifact, so the deployment can later be asked
 * which build it is.
 *
 * Without this, a check against a public URL cannot tell the deploy it just
 * made from an older one still being served, or from a different project that
 * still owns the domain. Both of those return a confident 200.
 */
import fs from 'node:fs';
import path from 'node:path';

export type StampOptions = {
  /** Directory to walk, or a list of files. */
  into: string | string[];
  /** The build id. A commit sha is the obvious choice. */
  build: string;
  /** Meta tag name. Change it only if it collides with something. */
  name?: string;
  /** Only stamp files with these extensions when `into` is a directory. */
  extensions?: string[];
};

export type StampResult = {
  /** Files that now carry the stamp. */
  stamped: string[];
  /** Files that already carried this exact build id. */
  alreadyStamped: string[];
  /** Files that had no <head> to stamp, with the reason. */
  skipped: { file: string; reason: string }[];
  build: string;
};

const DEFAULT_NAME = 'x-build';
const DEFAULT_EXTENSIONS = ['.html'];

/** Everything under `dir` with one of `extensions`. No glob dependency: a
 *  recursive walk is nine lines and has no version to keep up with. */
export function walk(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, extensions));
    else if (extensions.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const escapeAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Insert (or replace) the stamp in one HTML string.
 *
 * Returns `null` when there is nothing to stamp, so the caller can report a
 * file as skipped rather than silently writing it back unchanged.
 */
export function stampHtml(
  html: string,
  build: string,
  name = DEFAULT_NAME,
): { html: string; changed: boolean } | null {
  const tag = `<meta name="${escapeAttr(name)}" content="${escapeAttr(build)}" />`;
  const existing = new RegExp(
    `<meta\\s+name=["']${escapeRe(name)}["']\\s+content=["']([^"']*)["']\\s*/?>`,
    'i',
  );

  const found = html.match(existing);
  if (found) {
    if (found[1] === build) return { html, changed: false };
    return { html: html.replace(existing, tag), changed: true };
  }

  // Prefer just inside <head>; fall back to before </head>.
  const headOpen = html.match(/<head[^>]*>/i);
  if (headOpen?.index !== undefined) {
    const at = headOpen.index + headOpen[0].length;
    return { html: html.slice(0, at) + `\n    ${tag}` + html.slice(at), changed: true };
  }
  if (/<\/head>/i.test(html)) {
    return { html: html.replace(/<\/head>/i, `    ${tag}\n</head>`), changed: true };
  }
  return null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function stamp(options: StampOptions): StampResult {
  const { build, name = DEFAULT_NAME, extensions = DEFAULT_EXTENSIONS } = options;
  if (!build) throw new Error('stamp: `build` is required and must not be empty');

  const targets: string[] = [];
  for (const entry of Array.isArray(options.into) ? options.into : [options.into]) {
    if (!fs.existsSync(entry)) throw new Error(`stamp: ${entry} does not exist`);
    if (fs.statSync(entry).isDirectory()) targets.push(...walk(entry, extensions));
    else targets.push(entry);
  }

  const result: StampResult = { stamped: [], alreadyStamped: [], skipped: [], build };

  for (const file of targets) {
    const html = fs.readFileSync(file, 'utf8');
    const next = stampHtml(html, build, name);
    if (!next) {
      result.skipped.push({ file, reason: 'no <head> to stamp' });
      continue;
    }
    if (!next.changed) {
      result.alreadyStamped.push(file);
      continue;
    }
    fs.writeFileSync(file, next.html, 'utf8');
    result.stamped.push(file);
  }

  if (result.stamped.length === 0 && result.alreadyStamped.length === 0) {
    throw new Error(
      `stamp: nothing was stamped. Looked at ${targets.length} file(s) under ` +
        `${JSON.stringify(options.into)} for extensions ${extensions.join(', ')}. ` +
        `A build that ships no stamp cannot be verified.`,
    );
  }

  return result;
}

/** Read a stamp out of a served document. */
export function readStamp(html: string, name = DEFAULT_NAME): string | null {
  const m = html.match(
    new RegExp(`<meta\\s+name=["']${escapeRe(name)}["']\\s+content=["']([^"']*)["']`, 'i'),
  );
  return m?.[1] ?? null;
}
