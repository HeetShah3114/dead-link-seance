import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DiskCache } from '../wayback/cache.js';
import { crawl, pageLinks, StartPageError } from './crawler.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'seance-crawl-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const TS = '20010101000000';
const html = (body: string) => ({ status: 200, type: 'text/html', body: `<html><body>${body}</body></html>` });

/** A fake archive: maps original URL to a response. Records what was asked for. */
function site(map: Record<string, { status: number; type: string; body: string }>) {
  const asked: string[] = [];
  return {
    asked,
    deps: {
      cache: new DiskCache(path.join(dir, 'c')),
      client: {
        get: async (archiveUrl: string) => {
          const original = archiveUrl.replace(/^https:\/\/web\.archive\.org\/web\/\d+id_\//, '');
          asked.push(original);
          const r = map[original];
          if (!r) return new Response('not archived', { status: 404, headers: { 'content-type': 'text/html' } });
          return new Response(r.body, { status: r.status, headers: { 'content-type': r.type } });
        },
      },
    },
  };
}

const opts = { maxPages: 15, maxDepth: 2, maxPageBytes: 1024 * 1024 };

describe('pageLinks', () => {
  it('keeps same-site page links only', () => {
    const links = pageLinks(
      '<a href="b.html">b</a><a href="http://www.a.com/c.html#x">c</a><a href="http://other.com/">o</a><a href="pic.gif">p</a><a href="mailto:x@y.z">m</a><a href="/web/2001/http://a.com/d.html">d</a>',
      'http://a.com/',
      new URL('http://a.com/'),
    ).map((u) => u.href);
    expect(links).toEqual(['http://a.com/b.html', 'http://www.a.com/c.html', 'http://a.com/d.html']);
  });
});

describe('crawl', () => {
  it('walks same-site pages breadth first, once each', async () => {
    const { deps, asked } = site({
      'http://a.com/': html('<a href="b.html">b</a><a href="c.html">c</a><a href="http://other.com/">x</a>'),
      'http://a.com/b.html': html('<a href="/">home</a><a href="c.html">c</a><a href="d.html">d</a>'),
      'http://a.com/c.html': html('c'),
      'http://a.com/d.html': html('d'),
    });
    const r = await crawl(new URL('http://a.com/'), TS, deps, opts);
    expect(r.pages.map((p) => p.url.href)).toEqual(['http://a.com/', 'http://a.com/b.html', 'http://a.com/c.html', 'http://a.com/d.html']);
    expect(r.pages[0]!.path).toBe('index.html');
    expect(r.pages.map((p) => p.depth)).toEqual([0, 1, 1, 2]);
    expect(asked).not.toContain('http://other.com/');
    expect(r.found).toBe(4);
  });

  it('respects the depth limit and records it', async () => {
    const { deps } = site({
      'http://a.com/': html('<a href="b.html">b</a>'),
      'http://a.com/b.html': html('<a href="c.html">c</a>'),
      'http://a.com/c.html': html('c'),
    });
    const r = await crawl(new URL('http://a.com/'), TS, deps, { ...opts, maxDepth: 1 });
    expect(r.pages).toHaveLength(2);
    expect(r.skipped).toEqual([{ url: 'http://a.com/c.html', reason: 'depth_limit' }]);
  });

  it('respects the page limit and records it', async () => {
    const { deps, asked } = site({
      'http://a.com/': html('<a href="1.html">1</a><a href="2.html">2</a><a href="3.html">3</a>'),
      'http://a.com/1.html': html('1'),
      'http://a.com/2.html': html('2'),
      'http://a.com/3.html': html('3'),
    });
    const r = await crawl(new URL('http://a.com/'), TS, deps, { ...opts, maxPages: 2 });
    expect(r.pages).toHaveLength(2);
    expect(r.skipped.map((s) => s.reason)).toEqual(['page_limit', 'page_limit']);
    expect(asked).toHaveLength(2);
  });

  it('skips login and payment pages without fetching them', async () => {
    const { deps, asked } = site({
      'http://a.com/': html('<a href="login.html">in</a><a href="shop/cart">cart</a><a href="ok.html">ok</a>'),
      'http://a.com/ok.html': html('ok'),
    });
    const r = await crawl(new URL('http://a.com/'), TS, deps, opts);
    expect(r.skipped.map((s) => s.reason)).toEqual(['login_or_payment', 'login_or_payment']);
    expect(asked).not.toContain('http://a.com/login.html');
  });

  it('skips a page with a password field after fetching it', async () => {
    const { deps } = site({
      'http://a.com/': html('<a href="members.html">m</a>'),
      'http://a.com/members.html': html('<form><input type="password" name="p"></form>'),
    });
    const r = await crawl(new URL('http://a.com/'), TS, deps, opts);
    expect(r.skipped).toEqual([{ url: 'http://a.com/members.html', reason: 'login_or_payment' }]);
  });

  it('records missing and non-html pages', async () => {
    const { deps } = site({
      'http://a.com/': html('<a href="gone.html">g</a><a href="data">d</a>'),
      'http://a.com/data': { status: 200, type: 'text/plain', body: 'x' },
    });
    const r = await crawl(new URL('http://a.com/'), TS, deps, opts);
    expect(r.skipped).toEqual([
      { url: 'http://a.com/gone.html', reason: 'not_found' },
      { url: 'http://a.com/data', reason: 'not_html' },
    ]);
  });

  it('fails with StartPageError when the start page is unusable', async () => {
    const { deps } = site({ 'http://a.com/': { status: 200, type: 'image/gif', body: 'GIF' } });
    await expect(crawl(new URL('http://a.com/'), TS, deps, opts)).rejects.toBeInstanceOf(StartPageError);
  });
});
