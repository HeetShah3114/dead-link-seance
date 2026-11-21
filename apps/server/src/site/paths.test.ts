import { describe, it, expect } from 'vitest';
import { pageKey, pagePath, relPath, unwrapArchive, resolveUrl, sameSite, assetPath, inScope, scopePrefix, LOGIN_OR_PAYMENT } from './paths.js';

const u = (s: string) => new URL(s);

describe('site paths', () => {
  it('treats www, scheme and index files as the same page', () => {
    expect(pageKey(u('http://www.a.com/dir/'))).toBe(pageKey(u('https://a.com/dir/index.html')));
    expect(pageKey(u('http://a.com/x.html?y=1#top'))).toBe('a.com/x.html?y=1');
    expect(sameSite(u('http://www.a.com/'), u('http://a.com:80/x'))).toBe(true);
    expect(sameSite(u('http://a.com/'), u('http://b.com/'))).toBe(false);
  });

  it('scopes a site to the start page folder, so shared hosts stay one person deep', () => {
    const start = u('http://www.geocities.com/Hollywood/Hills/1234/');
    expect(inScope(u('http://geocities.com/Hollywood/Hills/1234/ep/x.html'), start)).toBe(true);
    expect(inScope(u('http://www.geocities.com/Hollywood/Hills/1234'), start)).toBe(true);
    expect(inScope(u('http://www.geocities.com/Hollywood/Hills/5678/'), start)).toBe(false);
    expect(inScope(u('http://www.geocities.com/~stacy/login.html'), start)).toBe(false);
    expect(inScope(u('http://a.com/anything'), u('http://www.a.com/'))).toBe(true);
    expect(scopePrefix(u('http://a.com/dir/page.html'))).toBe('/dir/');
  });

  it('gives the start page index.html and others stable files in p/', () => {
    expect(pagePath(u('http://a.com/'), true)).toBe('index.html');
    const p = pagePath(u('http://a.com/Fan/Episodes.html'), false);
    expect(p).toMatch(/^p\/fan-episodes-[0-9a-f]{8}\.html$/);
    expect(pagePath(u('http://a.com/Fan/Episodes.html'), false)).toBe(p);
  });

  it('builds relative links between site files', () => {
    expect(relPath('index.html', 'p/a.html')).toBe('p/a.html');
    expect(relPath('p/a.html', 'index.html')).toBe('../index.html');
    expect(relPath('p/a.html', 'p/b.html')).toBe('b.html');
    expect(relPath('p/a.html', 'a/x.gif')).toBe('../a/x.gif');
    expect(relPath('index.html', 'index.html')).toBe('index.html');
  });

  it('unwraps archive-rewritten links', () => {
    expect(unwrapArchive('/web/20010101000000/http://a.com/x.html')).toBe('http://a.com/x.html');
    expect(unwrapArchive('https://web.archive.org/web/2001id_/http://b.com/')).toBe('http://b.com/');
    expect(unwrapArchive('/web/2001im_/http:/a.com/p.gif')).toBe('http://a.com/p.gif');
    expect(unwrapArchive('/web/2001/a.com/x')).toBe('http://a.com/x');
    expect(unwrapArchive('other.html')).toBe('other.html');
  });

  it('resolves only http(s) urls', () => {
    expect(resolveUrl('b.html', 'http://a.com/dir/')?.href).toBe('http://a.com/dir/b.html');
    for (const v of ['#x', 'mailto:a@b.c', 'javascript:x()', 'data:text/html,x', '']) expect(resolveUrl(v, 'http://a.com/')).toBeNull();
  });

  it('names assets by content type', () => {
    expect(assetPath('http://a.com/x', 'image/gif')).toMatch(/^a\/[0-9a-f]{16}\.gif$/);
    expect(assetPath('http://a.com/x.JPG', 'application/octet-stream')).toMatch(/\.jpg$/);
  });

  it('spots login and payment paths but not ordinary words', () => {
    for (const p of ['/login.html', '/members/signin/', '/cart', '/checkout.asp', '/my-account/']) expect(LOGIN_OR_PAYMENT.test(p), p).toBe(true);
    for (const p of ['/blog/payday-loans-are-bad.html', '/episodes.html', '/catalog/', '/paypal-history.html']) expect(LOGIN_OR_PAYMENT.test(p), p).toBe(false);
  });
});
