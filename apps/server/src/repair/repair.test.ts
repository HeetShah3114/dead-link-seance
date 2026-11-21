import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as cheerio from 'cheerio';
import { repairPage, collectAssets, type RepairOptions, type AssetTarget, type PageTarget } from './repair.js';
import { pageKey } from '../site/paths.js';

const TS = '20030412101500';
const raw = (u: string) => `https://web.archive.org/web/${TS}id_/${u}`;
const view = (u: string) => `https://web.archive.org/web/${TS}/${u}`;

function opts(over: Partial<RepairOptions> = {}): RepairOptions {
  const pages: Record<string, string> = { 'a.com/': 'index.html', 'a.com/b.html': 'p/b.html' };
  return {
    pageUrl: 'http://a.com/dir/page.html',
    siteUrl: 'http://a.com/',
    timestamp: TS,
    fromPath: 'p/page.html',
    resolvePage: (u: URL): PageTarget => {
      const p = pages[pageKey(u)];
      return p ? { kind: 'page', path: p } : { kind: 'lost' };
    },
    resolveAsset: (): AssetTarget => ({ kind: 'remote' }),
    ...over,
  };
}

describe('repairPage: code and forms', () => {
  it('removes scripts, frames, embeds, base and meta refresh', () => {
    const r = repairPage(
      '<html><head><base href="http://x.com/"><meta http-equiv="refresh" content="0;url=http://x.com"><script>alert(1)</script></head><body><iframe src="http://ads.com"></iframe><embed src="a.swf"><noscript>x</noscript><p>hi</p></body></html>',
      opts(),
    );
    expect(r.html).not.toMatch(/<script|<iframe|<embed|<base|<noscript|refresh/i);
    expect(r.html).toContain('<p>hi</p>');
    expect(r.scriptsRemoved).toBe(1);
  });

  it('removes inline handlers and javascript: urls', () => {
    const r = repairPage('<body onload="x()"><a href="javascript:evil()" onclick="y()">go</a></body>', opts());
    expect(r.html).not.toMatch(/onload|onclick|javascript:/i);
    expect(r.html).toContain('go');
  });

  it('switches forms off and says so', () => {
    const r = repairPage('<form action="/post.cgi" method="post" target="_blank"><input name="q"><select name="s"></select><textarea name="t"></textarea><button>Go</button></form>', opts());
    expect(r.formsDisabled).toBe(1);
    expect(r.html).not.toMatch(/action=|method=|target=/i);
    expect(r.html).toContain('This form no longer works');
    expect((r.html.match(/disabled="disabled"/g) ?? []).length).toBe(4);
  });
});

describe('repairPage: links', () => {
  it('points recovered same-site links at their files, keeping the fragment', () => {
    const r = repairPage('<a href="/">home</a><a href="http://www.a.com/b.html#top">b</a>', opts());
    const $ = cheerio.load(r.html);
    expect($('a').eq(0).attr('href')).toBe('../index.html');
    expect($('a').eq(1).attr('href')).toBe('b.html#top');
  });

  it('marks links to pages we did not recover as lost', () => {
    const r = repairPage('<a href="guestbook.html">Sign my guestbook</a>', opts());
    const a = cheerio.load(r.html)('a');
    expect(a.attr('href')).toBe('#lost');
    expect(a.attr('data-seance-lost')).toBe('http://a.com/dir/guestbook.html');
    expect(a.text()).toBe('Sign my guestbook');
    expect(r.lostPages).toEqual(['http://a.com/dir/guestbook.html']);
  });

  it('sends off-site links to their archived copy', () => {
    const r = repairPage('<a href="http://www.cdnow.com/">CDnow</a>', opts());
    expect(cheerio.load(r.html)('a').attr('href')).toBe(view('http://www.cdnow.com/'));
  });

  it('unwraps archive-rewritten links first', () => {
    const r = repairPage('<a href="/web/2001/http://a.com/b.html">b</a><a href="https://web.archive.org/web/2001id_/http://z.com/">z</a>', opts());
    const $ = cheerio.load(r.html);
    expect($('a').eq(0).attr('href')).toBe('b.html');
    expect($('a').eq(1).attr('href')).toBe(view('http://z.com/'));
  });

  it('leaves fragments and mailto alone and drops dead schemes', () => {
    const r = repairPage('<a href="#top">t</a><a href="mailto:me@aol.com">m</a><a href="ftp://ftp.a.com/x">f</a>', opts());
    const $ = cheerio.load(r.html);
    expect($('a').eq(0).attr('href')).toBe('#top');
    expect($('a').eq(1).attr('href')).toBe('mailto:me@aol.com');
    expect($('a').eq(2).attr('href')).toBeUndefined();
    expect($('a').eq(2).text()).toBe('f');
  });
});

describe('repairPage: assets', () => {
  it('uses local copies, archived copies, or a labeled placeholder', () => {
    const assets: Record<string, AssetTarget> = {
      'http://a.com/dir/here.gif': { kind: 'local', path: 'a/1.gif' },
      'http://a.com/far.gif': { kind: 'remote' },
      'http://a.com/dir/gone.gif': { kind: 'missing' },
      'http://a.com/dir/bg.gif': { kind: 'missing' },
      'http://a.com/dir/s.css': { kind: 'missing' },
    };
    const r = repairPage(
      '<link rel="stylesheet" href="s.css"><body background="bg.gif"><img src="here.gif"><img src="/far.gif"><img src="gone.gif" alt="my cat" width="100" height="80"></body>',
      opts({ resolveAsset: (u) => assets[u] ?? { kind: 'missing' } }),
    );
    const $ = cheerio.load(r.html);
    expect($('img').eq(0).attr('src')).toBe('../a/1.gif');
    expect($('img').eq(1).attr('src')).toBe(raw('http://a.com/far.gif'));
    const box = $('[data-seance-missing=image]');
    expect(box.text()).toBe('[image lost: my cat]');
    expect(box.attr('style')).toContain('width:100px');
    expect($('body').attr('background')).toBeUndefined();
    expect($('link')).toHaveLength(0);
    expect(r.lostAssets.sort()).toEqual(['http://a.com/dir/bg.gif', 'http://a.com/dir/gone.gif', 'http://a.com/dir/s.css']);
  });

  it('collects every asset once', () => {
    expect(collectAssets('<img src="a.gif"><img src="a.gif"><table><tr><td background="b.gif"></td></tr></table><img src="data:image/gif;base64,AA">', 'http://a.com/')).toEqual([
      'http://a.com/a.gif',
      'http://a.com/b.gif',
    ]);
  });
});

// Task 2.3: link rewriter properties.
describe('repairPage: link rewriter properties', () => {
  const hrefs = fc.constantFrom(
    '/',
    'b.html',
    '/b.html#x',
    'http://a.com/b.html',
    'http://www.a.com/',
    'gone.html',
    '../up/gone.html?x=1',
    'http://other.com/',
    'https://www.geocities.com/x/',
    '/web/2001/http://a.com/b.html',
    '/web/2001/http://other.com/z',
    'https://web.archive.org/web/2001id_/http://a.com/',
    '#top',
    'mailto:x@y.z',
    'javascript:alert(1)',
    'ftp://ftp.a.com/',
    '',
    '   http://a.com/b.html  ',
  );
  const page = fc.array(hrefs, { maxLength: 15 }).map((hs) => `<html><body>${hs.map((h, i) => `<a href="${h}">l${i}</a>`).join('')}</body></html>`);

  it('never leaves a live off-site link or an archive-rewritten link', () => {
    fc.assert(
      fc.property(page, (html) => {
        const $ = cheerio.load(repairPage(html, opts()).html);
        return $('a[href]')
          .toArray()
          .every((el) => {
            const h = $(el).attr('href')!;
            // empty href is a link to the same page: harmless
            if (h.trim() === '' || h.startsWith('#') || h.startsWith('mailto:')) return true;
            if (h.startsWith(`https://web.archive.org/web/${TS}/`)) {
              // only for off-site targets, never our own pages
              const inner = h.slice(`https://web.archive.org/web/${TS}/`.length);
              return !/^https?:\/\/(www\.)?a\.com\//.test(inner);
            }
            // otherwise a relative link to a file in our site
            return !/^[a-z]+:/i.test(h) && !h.startsWith('/') && /\.html(#.*)?$/.test(h);
          });
      }),
      { numRuns: 300 },
    );
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(page, (html) => {
        const once = repairPage(html, opts()).html;
        return repairPage(once, opts()).html === once;
      }),
      { numRuns: 300 },
    );
  });
});
