/**
 * A minimal Chrome DevTools Protocol client.
 *
 * Zero dependencies, and it exists for one reason: `CSS.getPlatformFontsForNode`.
 *
 * No web API tells you which font actually drew a run of text. `document.fonts`
 * says which faces loaded; `getComputedStyle().fontFamily` says which were
 * asked for. Neither answers the only question that matters -- did the glyphs
 * come from the font you chose, or from whatever the operating system had? The
 * debugging protocol answers it directly, per element, with a glyph count. It
 * is the whole reason this package needs a browser connection rather than a
 * DOM parser, and the reason this check did not exist before.
 *
 * This duplicates a client that also lives in @nayaverse/overflow. That is
 * deliberate: a shared package would make each of them need the other to be
 * installed and versioned together, for about a hundred lines of protocol
 * plumbing whose shape has not changed since 2017. Each package stays
 * installable on its own.
 *
 * If you already use Playwright, use the adapter in ./playwright.js instead.
 */

export interface CdpOptions {
  /** A running Chrome with --remote-debugging-port. */
  readonly endpoint?: string;
  /** Per-command timeout. */
  readonly timeoutMs?: number;
}

/** One font the browser reports as having drawn part of an element's text. */
export interface PlatformFont {
  readonly familyName: string;
  readonly glyphCount: number;
  readonly isCustomFont: boolean;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class CdpSession {
  #ws: WebSocket;
  #id = 0;
  #pending = new Map<number, Pending>();
  #timeoutMs: number;
  #targetId: string;
  #endpoint: string;
  #documentNodeId: number | undefined;

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
        'glyphcheck: this Node has no global WebSocket, which the bundled CDP driver needs.\n' +
          'Use Node 22+, or run the check through Playwright with ' +
          "`import { checkPage } from '@nayaverse/glyphcheck/playwright'`.",
      );
    }

    let target: { id: string; webSocketDebuggerUrl: string };
    try {
      const res = await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      target = (await res.json()) as typeof target;
    } catch (err) {
      throw new Error(
        `glyphcheck: could not reach Chrome at ${endpoint} (${err instanceof Error ? err.message : err}).\n` +
          'Start one with:\n' +
          '  chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/glyphcheck-profile about:blank',
      );
    }

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('glyphcheck: CDP socket failed to open')), {
        once: true,
      });
    });

    const session = new CdpSession(ws, target.id, endpoint, timeoutMs);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('DOM.enable');
    // CSS without DOM returns nothing useful, and getPlatformFontsForNode
    // lives in CSS. Both have to be enabled before the first navigation.
    await session.send('CSS.enable');
    return session;
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`glyphcheck: CDP ${method} timed out after ${this.#timeoutMs}ms`));
      }, this.#timeoutMs);

      this.#pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Device metrics, never a window size.
   *
   * On Windows a Chrome window cannot be narrower than roughly 494px, so a
   * `--window-size=390,844` launch lays the page out at 494 and clips it.
   * Every "390px" measurement taken that way is a desktop layout with its
   * right-hand side cut off.
   */
  async setViewport(width: number, height = 900, deviceScaleFactor = 1): Promise<void> {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor, mobile: width < 768,
    });
  }

  async goto(url: string, settleMs = 1200): Promise<void> {
    await this.send('Page.navigate', { url });
    // A navigation resolves long before the web fonts land, and a font that
    // has not arrived yet is being rendered by a fallback -- which is the
    // exact fault this package reports. Waiting is not politeness here, it
    // is the difference between a finding and a false alarm.
    await new Promise((r) => setTimeout(r, settleMs));
    this.#documentNodeId = undefined;
    await this.evaluate('document.fonts.ready.then(() => true)');
  }

  async evaluate(expression: string): Promise<unknown> {
    const res = (await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    })) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
    if (res.exceptionDetails) {
      throw new Error(`glyphcheck: page threw: ${res.exceptionDetails.text ?? 'unknown'}`);
    }
    return res.result?.value;
  }

  async #document(): Promise<number> {
    if (this.#documentNodeId === undefined) {
      const { root } = (await this.send('DOM.getDocument', { depth: -1 })) as {
        root: { nodeId: number };
      };
      this.#documentNodeId = root.nodeId;
    }
    return this.#documentNodeId;
  }

  /**
   * Which fonts actually drew this element's text.
   *
   * Returns an empty array rather than throwing when the node cannot be
   * found: between the page script tagging an element and this call, a
   * framework may have re-rendered it away. One element the check could not
   * reach is not a reason to abandon the page.
   */
  async platformFontsFor(selector: string): Promise<PlatformFont[]> {
    try {
      const { nodeId } = (await this.send('DOM.querySelector', {
        nodeId: await this.#document(),
        selector,
      })) as { nodeId: number };
      if (!nodeId) return [];
      const { fonts } = (await this.send('CSS.getPlatformFontsForNode', { nodeId })) as {
        fonts?: PlatformFont[];
      };
      return fonts ?? [];
    } catch {
      return [];
    }
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
