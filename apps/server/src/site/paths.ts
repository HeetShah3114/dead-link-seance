// How original URLs map to files in the resurrected site. Pure functions.
import { createHash } from 'node:crypto';
import path from 'node:path';

const hash = (s: string, n = 10) => createHash('sha1').update(s).digest('hex').slice(0, n);

/** Host with "www." and a trailing dot removed, lower case. */
export function bareHost(u: URL): string {
  return u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

/** Same site: same bare host. Scheme and default ports are ignored (old sites mixed them). */
export function sameSite(a: URL, b: URL): boolean {
  return bareHost(a) === bareHost(b);
}

/** Folder of the start page, e.g. "/Hollywood/Hills/1234/" for ".../1234/index.html". */
export function scopePrefix(start: URL): string {
  const p = start.pathname;
  return p.endsWith('/') ? p : p.slice(0, p.lastIndexOf('/') + 1) || '/';
}

/**
 * Inside the resurrected site: same host AND under the start page's folder.
 * On shared hosts (GeoCities, Angelfire, Tripod) a "site" is a folder, and other
 * folders on the same host are other people's sites. Those count as off-site.
 */
export function inScope(u: URL, start: URL): boolean {
  if (!sameSite(u, start)) return false;
  const prefix = scopePrefix(start).toLowerCase();
  const p = u.pathname.toLowerCase();
  return p.startsWith(prefix) || `${p}/` === prefix;
}

/**
 * Identity of a page: bare host + path + query, no fragment, no scheme.
 * "/dir/" and "/dir/index.html" are the same page.
 */
export function pageKey(u: URL): string {
  let p = u.pathname.replace(/\/(index|default)\.(s?html?|php|asp)$/i, '/');
  if (p === '') p = '/';
  return `${bareHost(u)}${p}${u.search}`;
}

/** Output file for a page. The start page is index.html; others live in p/. */
export function pagePath(u: URL, isStart: boolean): string {
  if (isStart) return 'index.html';
  const name = (u.pathname + u.search)
    .replace(/\.(s?html?|php|asp|cgi)$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 50);
  return `p/${name || 'page'}-${hash(pageKey(u), 8)}.html`;
}

const EXT: Record<string, string> = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'text/css': '.css',
};

/** Output file for an asset: a/<hash><ext>. Extension from the content type, else the URL. */
export function assetPath(url: string, contentType: string): string {
  const ct = contentType.split(';')[0]!.trim().toLowerCase();
  let ext = EXT[ct];
  if (!ext) {
    const m = /\.([a-z0-9]{1,5})$/i.exec(new URL(url).pathname);
    ext = m ? `.${m[1]!.toLowerCase()}` : '.bin';
  }
  return `a/${hash(url, 16)}${ext}`;
}

/** Relative link from one site file to another, e.g. ("p/a.html", "index.html") -> "../index.html". */
export function relPath(from: string, to: string): string {
  const r = path.posix.relative(path.posix.dirname(from), to);
  return r === '' ? path.posix.basename(to) : r;
}

const ARCHIVE_LINK = /^(?:https?:)?(?:\/\/web\.archive\.org)?\/web\/\d{1,14}[a-z_]*\/(.+)$/i;

/**
 * Archived HTML sometimes still holds archive-rewritten links ("/web/2001/http://a.com/x").
 * Return the original URL inside, or the value unchanged.
 */
export function unwrapArchive(value: string): string {
  const m = ARCHIVE_LINK.exec(value.trim());
  if (!m) return value;
  let inner = m[1]!;
  if (/^https?:\/[^/]/i.test(inner)) inner = inner.replace(/^(https?:)\//i, '$1//');
  if (!/^https?:\/\//i.test(inner)) inner = `http://${inner}`;
  return inner;
}

/** Resolve an href/src to an absolute http(s) URL, unwrapping archive links. Null for anything else. */
export function resolveUrl(value: string, base: string): URL | null {
  const v = value.trim();
  if (!v || v.startsWith('#') || /^(data|javascript|vbscript|mailto|about|blob|tel):/i.test(v)) return null;
  try {
    const u = new URL(unwrapArchive(v), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

/** Links that look like files, not pages. Not crawled. */
export const NON_PAGE_EXT = /\.(jpe?g|gif|png|bmp|ico|svg|webp|zip|gz|tar|rar|exe|msi|dmg|pdf|ps|mp3|wav|mid|midi|ra|ram|au|avi|mov|mpe?g|mp4|wmv|swf|class|jar|doc|xls|ppt|css|js)$/i;

/** Pages we never resurrect. (R3.4, product.md) */
export const LOGIN_OR_PAYMENT =
  /(^|[/\-_.])(login|log-in|logon|signin|sign-in|signup|sign-up|register|password|passwd|account|myaccount|checkout|cart|basket|payment|pay|billing|order)([/\-_.?]|$)/i;
