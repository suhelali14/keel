/**
 * A minimal Chrome DevTools Protocol client.
 *
 * Zero dependencies, about a hundred lines, and it exists for one reason: the
 * viewport has to be set with `Emulation.setDeviceMetricsOverride`, never with
 * a window size.
 *
 * On Windows a Chrome window cannot be narrower than roughly 494px. Launch
 * with `--window-size=390,844` and the page lays out at 494px and is then
 * clipped to 390 — which looks exactly like a horizontal overflow bug, in a
 * layout that is perfectly fine. Hours go into fixing something that was
 * never broken. Playwright gets this right by default; anyone driving Chrome
 * directly walks straight into it.
 *
 * If you already use Playwright, use the adapter in ./playwright.js instead.
 * This driver is for pipelines that do not want a browser automation
 * dependency to run one check.
 */

export type CdpOptions = {
  /** A running Chrome with --remote-debugging-port. */
  endpoint?: string;
  /** Per-command timeout. */
  timeoutMs?: number;
};

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class CdpSession {
  #ws: WebSocket;
  #id = 0;
  #pending = new Map<number, Pending>();
  #timeoutMs: number;
  #targetId: string;
  #endpoint: string;

  private constructor(ws: WebSocket, targetId: string, endpoint: string, timeoutMs: number) {
    this.#ws = ws;
    this.#targetId = targetId;
    this.#endpoint = endpoint;
    this.#timeoutMs = timeoutMs;
    ws.addEventListener('message', (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: unknown };
      if (msg.id === undefined) return;
      const p = this.#pending.get(msg.id);
      if (!p) return;
      this.#pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`CDP: ${JSON.stringify(msg.error)}`));
      else p.resolve(msg.result);
    });
  }

  static async open(options: CdpOptions = {}): Promise<CdpSession> {
    const endpoint = options.endpoint ?? 'http://127.0.0.1:9222';
    const timeoutMs = options.timeoutMs ?? 30_000;

    if (typeof WebSocket === 'undefined') {
      throw new Error(
        'overflow: this Node has no global WebSocket, which the bundled CDP driver needs.\n' +
          'Use Node 22+, or run the check through Playwright with ' +
          "`import { checkPage } from '@nayaverse/overflow/playwright'`.",
      );
    }

    let target: { id: string; webSocketDebuggerUrl: string };
    try {
      const res = await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      target = (await res.json()) as typeof target;
    } catch (err) {
      throw new Error(
        `overflow: could not reach Chrome at ${endpoint} (${err instanceof Error ? err.message : err}).\n` +
          'Start one with:\n' +
          '  chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/overflow-profile about:blank',
      );
    }

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('overflow: CDP socket failed to open')), {
        once: true,
      });
    });

    const session = new CdpSession(ws, target.id, endpoint, timeoutMs);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    return session;
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`overflow: CDP ${method} timed out after ${this.#timeoutMs}ms`));
      }, this.#timeoutMs);

      this.#pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Set the viewport the page actually sees.
   *
   * Device metrics, never a window size. See the note at the top of this file.
   */
  async setViewport(width: number, height = 900, deviceScaleFactor = 1): Promise<void> {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile: width < 768,
    });
  }

  async goto(url: string, settleMs = 500): Promise<void> {
    await this.send('Page.navigate', { url });
    // Loading is not the same as laid out. Fonts and late CSS move things.
    await new Promise((r) => setTimeout(r, settleMs));
  }

  async evaluate(expression: string): Promise<unknown> {
    const res = (await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
    if (res.exceptionDetails) {
      throw new Error(`overflow: page threw: ${res.exceptionDetails.text ?? 'unknown'}`);
    }
    return res.result?.value;
  }

  async close(): Promise<void> {
    try {
      await fetch(`${this.#endpoint}/json/close/${this.#targetId}`);
    } catch {
      // The tab is going away either way.
    }
    this.#ws.close();
  }
}
