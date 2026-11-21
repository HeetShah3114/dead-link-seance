import { describe, it, expect } from 'vitest';
import { WaybackClient, WaybackError } from './client.js';
import { OutboundBlockedError } from '../safety/url-guard.js';

const UA = 'DeadLinkSeance/0.1 (+https://github.com/HeetShah3114/dead-link-seance)';
const header = ['timestamp', 'original', 'mimetype', 'statuscode'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function make(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; ua: string | undefined }> = [];
  const sleeps: number[] = [];
  let t = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, ua: (init?.headers as Record<string, string>)?.['User-Agent'] });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const client = new WaybackClient({
    userAgent: UA,
    minIntervalMs: 1000,
    backoffBaseMs: 100,
    maxRetries: 2,
    fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    now: () => t,
  });
  return { client, calls, sleeps };
}

describe('WaybackClient', () => {
  it('sends the User-Agent and picks the newest 200 html snapshot from CDX', async () => {
    const { client, calls } = make([
      json([
        header,
        ['20010101000000', 'http://a.com/', 'text/html', '200'],
        ['20050101000000', 'http://a.com/', 'text/html', '200'],
      ]),
    ]);
    const snap = await client.findBestSnapshot('http://a.com/');
    expect(snap?.timestamp).toBe('20050101000000');
    expect(calls[0]!.ua).toBe(UA);
    expect(calls[0]!.url).toContain('cdx/search/cdx');
    expect(calls[0]!.url).toContain(encodeURIComponent('http://a.com/'));
  });

  it('falls back to the availability API when CDX is empty', async () => {
    const { client, calls } = make([
      json([]),
      json({ archived_snapshots: { closest: { available: true, timestamp: '20040101000000', status: '200' } } }),
    ]);
    const snap = await client.findBestSnapshot('http://a.com/');
    expect(snap?.timestamp).toBe('20040101000000');
    expect(calls).toHaveLength(2);
  });

  it('returns null when nothing exists', async () => {
    const { client } = make([json([]), json({ archived_snapshots: {} })]);
    expect(await client.findBestSnapshot('http://a.com/')).toBeNull();
  });

  it('spaces requests by minIntervalMs', async () => {
    const { client, sleeps } = make([json([]), json({ archived_snapshots: {} })]);
    await client.findBestSnapshot('http://a.com/');
    expect(sleeps.some((ms) => ms > 0 && ms <= 1000)).toBe(true);
  });

  it('retries 5xx with exponential backoff then succeeds', async () => {
    const { client, calls, sleeps } = make([
      new Response('', { status: 503 }),
      new Response('', { status: 503 }),
      json([header, ['20050101000000', 'http://a.com/', 'text/html', '200']]),
    ]);
    const snap = await client.findBestSnapshot('http://a.com/');
    expect(snap?.timestamp).toBe('20050101000000');
    expect(calls).toHaveLength(3);
    expect(sleeps).toContain(100);
    expect(sleeps).toContain(200);
  });

  it('throws ARCHIVE_RATE_LIMITED after repeated 429', async () => {
    const { client } = make([
      new Response('', { status: 429 }),
      new Response('', { status: 429 }),
      new Response('', { status: 429 }),
    ]);
    await expect(client.findBestSnapshot('http://a.com/')).rejects.toMatchObject({ code: 'ARCHIVE_RATE_LIMITED' });
  });

  it('follows a redirect that stays on the archive', async () => {
    const { client, calls } = make([
      new Response(null, { status: 302, headers: { location: '/web/20050101000000id_/http://a.com/' } }),
      new Response('<html>ok</html>', { status: 200 }),
    ]);
    const res = await client.get('https://web.archive.org/web/2005id_/http://a.com/');
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([
      'https://web.archive.org/web/2005id_/http://a.com/',
      'https://web.archive.org/web/20050101000000id_/http://a.com/',
    ]);
  });

  it('refuses a redirect that leaves the archive, without sending it', async () => {
    const { client, calls } = make([
      new Response(null, { status: 301, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }),
    ]);
    await expect(client.get('https://web.archive.org/web/2005id_/http://a.com/')).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(calls).toHaveLength(1);
  });

  it('refuses a non-archive url outright', async () => {
    const { client, calls } = make([]);
    await expect(client.get('http://127.0.0.1:3000/')).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(calls).toHaveLength(0);
  });

  it('stops after too many redirects', async () => {
    const hop = () => new Response(null, { status: 302, headers: { location: 'https://web.archive.org/loop' } });
    const { client } = make([hop(), hop(), hop(), hop(), hop(), hop(), hop()]);
    await expect(client.get('https://web.archive.org/loop')).rejects.toMatchObject({ code: 'ARCHIVE_TIMEOUT' });
  });

  it('throws ARCHIVE_TIMEOUT after repeated network errors', async () => {
    const { client } = make([new Error('x'), new Error('x'), new Error('x')]);
    const err = await client.findBestSnapshot('http://a.com/').catch((e) => e);
    expect(err).toBeInstanceOf(WaybackError);
    expect(err.code).toBe('ARCHIVE_TIMEOUT');
  });
});
