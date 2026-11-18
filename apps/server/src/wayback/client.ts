import { CDX_FL, parseCdx, pickBest, type Snapshot } from './snapshot.js';

export type WaybackErrorCode = 'ARCHIVE_TIMEOUT' | 'ARCHIVE_RATE_LIMITED';

export class WaybackError extends Error {
  constructor(
    public code: WaybackErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WaybackError';
  }
}

export interface WaybackOptions {
  /** Descriptive User-Agent with project name and contact URL. (R4.1) */
  userAgent: string;
  /** Minimum gap between requests. Default 1000 ms = 1 req/s. (R4.2) */
  minIntervalMs?: number;
  /** Retries after the first try on 429/5xx/network error. (R4.4) */
  maxRetries?: number;
  /** First backoff delay; doubles each retry. */
  backoffBaseMs?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * One door to the Wayback Machine. Owns User-Agent, request queue (serial, rate limited)
 * and retry with backoff. Caching of bodies is added in task 1.2.
 */
export class WaybackClient {
  private readonly o: Required<WaybackOptions>;
  private tail: Promise<unknown> = Promise.resolve();
  private lastStart = 0;

  constructor(opts: WaybackOptions) {
    this.o = {
      minIntervalMs: 1000,
      maxRetries: 3,
      backoffBaseMs: 1000,
      timeoutMs: 20000,
      fetchImpl: fetch,
      sleep: defaultSleep,
      now: Date.now,
      ...opts,
    };
  }

  /** Queue a GET. Requests run one at a time, spaced by minIntervalMs. */
  get(url: string): Promise<Response> {
    const run = this.tail.then(() => this.send(url));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async paceOnce(): Promise<void> {
    const wait = this.lastStart + this.o.minIntervalMs - this.o.now();
    if (wait > 0) await this.o.sleep(wait);
    this.lastStart = this.o.now();
  }

  private async send(url: string): Promise<Response> {
    let lastStatus = 0;
    let timedOut = false;
    for (let attempt = 0; attempt <= this.o.maxRetries; attempt++) {
      if (attempt > 0) await this.o.sleep(this.o.backoffBaseMs * 2 ** (attempt - 1));
      await this.paceOnce();
      try {
        const res = await this.o.fetchImpl(url, {
          headers: { 'User-Agent': this.o.userAgent },
          signal: AbortSignal.timeout(this.o.timeoutMs),
          redirect: 'follow',
        });
        if (res.status === 429 || res.status >= 500) {
          lastStatus = res.status;
          timedOut = false;
          continue;
        }
        return res;
      } catch {
        timedOut = true;
      }
    }
    if (!timedOut && lastStatus === 429) {
      throw new WaybackError('ARCHIVE_RATE_LIMITED', 'Wayback rate limit hit');
    }
    throw new WaybackError('ARCHIVE_TIMEOUT', timedOut ? 'Wayback did not answer' : `Wayback error ${lastStatus}`);
  }

  /** Newest 200 HTML snapshot via CDX, falling back to the availability API. (R2.1 to R2.3) */
  async findBestSnapshot(url: string): Promise<Snapshot | null> {
    const cdx =
      'https://web.archive.org/cdx/search/cdx?output=json' +
      `&fl=${CDX_FL}` +
      '&filter=statuscode:200&filter=mimetype:text/html&limit=-10' +
      `&url=${encodeURIComponent(url)}`;
    const res = await this.get(cdx);
    if (res.ok) {
      const text = await res.text();
      let body: unknown = [];
      try {
        body = text.trim() ? JSON.parse(text) : [];
      } catch {
        body = [];
      }
      const best = pickBest(parseCdx(body));
      if (best) return best;
    }
    return this.availability(url);
  }

  private async availability(url: string): Promise<Snapshot | null> {
    const res = await this.get(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      archived_snapshots?: { closest?: { available?: boolean; timestamp?: string; status?: string } };
    } | null;
    const c = data?.archived_snapshots?.closest;
    if (!c?.available || !c.timestamp || !/^\d{14}$/.test(c.timestamp)) return null;
    return { timestamp: c.timestamp, original: url, mimetype: 'text/html', statuscode: c.status ?? '200' };
  }
}
