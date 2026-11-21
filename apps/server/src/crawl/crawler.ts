// Same-site crawl of one snapshot (task 2.1, R3.2 to R3.5).
import * as cheerio from 'cheerio';
import type { WaybackClient } from '../wayback/client.js';
import type { DiskCache } from '../wayback/cache.js';
import { fetchRaw } from '../wayback/fetch-page.js';
import { decodeHtml } from '../pipeline/decode.js';
import { LOGIN_OR_PAYMENT, NON_PAGE_EXT, inScope, pageKey, pagePath, resolveUrl } from '../site/paths.js';

export interface CrawledPage {
  url: URL;
  key: string;
  /** Output file in the site, e.g. index.html or p/x-1234abcd.html */
  path: string;
  html: string;
  depth: number;
}

export type SkipReason = 'login_or_payment' | 'not_found' | 'not_html' | 'too_big' | 'page_limit' | 'depth_limit';

export interface SkippedPage {
  url: string;
  reason: SkipReason;
}

export interface CrawlResult {
  pages: CrawledPage[];
  skipped: SkippedPage[];
  /** Distinct same-site pages seen, recovered or not. */
  found: number;
}

export interface CrawlOptions {
  maxPages: number;
  maxDepth: number;
  maxPageBytes: number;
  onPage?: (recovered: number, url: string) => void;
}

export interface CrawlDeps {
  client: Pick<WaybackClient, 'get'>;
  cache: DiskCache;
}

export class StartPageError extends Error {
  constructor(public readonly reason: SkipReason, message: string) {
    super(message);
    this.name = 'StartPageError';
  }
}

export function hasPasswordField(html: string): boolean {
  return /<input[^>]+type\s*=\s*["']?password/i.test(html);
}

/** Same-site page links in a page, resolved and de-fragmented. */
export function pageLinks(html: string, pageUrl: string, start: URL): URL[] {
  const $ = cheerio.load(html);
  const out: URL[] = [];
  $('a[href], area[href], frame[src], iframe[src]').each((_, el) => {
    const raw = $(el).attr('href') ?? $(el).attr('src') ?? '';
    const u = resolveUrl(raw, pageUrl);
    if (!u || !inScope(u, start) || NON_PAGE_EXT.test(u.pathname)) return;
    u.hash = '';
    out.push(u);
  });
  return out;
}

export async function crawl(start: URL, timestamp: string, deps: CrawlDeps, opts: CrawlOptions): Promise<CrawlResult> {
  const pages: CrawledPage[] = [];
  const skipped: SkippedPage[] = [];
  const seen = new Set<string>([pageKey(start)]);
  const queue: Array<{ url: URL; depth: number }> = [{ url: start, depth: 0 }];

  while (queue.length > 0) {
    const { url, depth } = queue.shift()!;
    const isStart = pages.length === 0 && depth === 0;

    if (pages.length >= opts.maxPages) {
      skipped.push({ url: url.href, reason: 'page_limit' });
      continue;
    }

    const res = await fetchRaw(deps.client, deps.cache, timestamp, url.href);
    let reason: SkipReason | null = null;
    if (res.status !== 200) reason = 'not_found';
    else if (!/html/i.test(res.contentType)) reason = 'not_html';
    else if (res.body.length > opts.maxPageBytes) reason = 'too_big';
    const html = reason ? '' : decodeHtml(res.contentType, res.body);
    if (!reason && hasPasswordField(html)) reason = 'login_or_payment';

    if (reason) {
      if (isStart) throw new StartPageError(reason, `Start page not usable: ${reason}`);
      skipped.push({ url: url.href, reason });
      continue;
    }

    pages.push({ url, key: pageKey(url), path: pagePath(url, isStart), html, depth });
    opts.onPage?.(pages.length, url.href);

    for (const link of pageLinks(html, url.href, start)) {
      const key = pageKey(link);
      if (seen.has(key)) continue;
      seen.add(key);
      if (LOGIN_OR_PAYMENT.test(link.pathname)) skipped.push({ url: link.href, reason: 'login_or_payment' });
      else if (depth + 1 > opts.maxDepth) skipped.push({ url: link.href, reason: 'depth_limit' });
      else queue.push({ url: link, depth: depth + 1 });
    }
  }

  return { pages, skipped, found: seen.size };
}
