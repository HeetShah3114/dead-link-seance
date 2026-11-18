import { describe, it, expect } from 'vitest';
import { repairV0 } from './repair.js';

const opts = { pageUrl: 'http://a.com/dir/page.html', timestamp: '20030412101500' };
const raw = (u: string) => `https://web.archive.org/web/20030412101500id_/${u}`;

describe('repairV0', () => {
  it('removes scripts, iframes, embeds and base tags', () => {
    const r = repairV0(
      '<html><head><base href="http://x.com/"><script>alert(1)</script></head><body><iframe src="http://ads.com"></iframe><embed src="a.swf"><p>hi</p></body></html>',
      opts,
    );
    expect(r.html).not.toMatch(/<script|<iframe|<embed|<base/i);
    expect(r.html).toContain('<p>hi</p>');
    expect(r.scriptsRemoved).toBe(1);
  });

  it('removes inline handlers and javascript: urls', () => {
    const r = repairV0('<body onload="x()"><a href="javascript:evil()" onclick="y()">go</a></body>', opts);
    expect(r.html).not.toMatch(/onload|onclick|javascript:/i);
    expect(r.html).toContain('go');
  });

  it('points images at archived copies, resolving relative urls', () => {
    const r = repairV0('<img src="pic.gif"><img src="/top.gif"><img src="http://b.com/x.gif">', opts);
    expect(r.html).toContain(raw('http://a.com/dir/pic.gif'));
    expect(r.html).toContain(raw('http://a.com/top.gif'));
    expect(r.html).toContain(raw('http://b.com/x.gif'));
    expect(r.assets).toEqual(['http://a.com/dir/pic.gif', 'http://a.com/top.gif', 'http://b.com/x.gif']);
  });

  it('points stylesheets and old-style backgrounds at archived copies', () => {
    const r = repairV0('<link rel="stylesheet" href="s.css"><body background="bg.gif"></body>', opts);
    expect(r.html).toContain(raw('http://a.com/dir/s.css'));
    expect(r.html).toContain(raw('http://a.com/dir/bg.gif'));
  });

  it('leaves data urls and existing archive urls alone', () => {
    const arch = 'https://web.archive.org/web/2001/http://a.com/p.gif';
    const r = repairV0(`<img src="data:image/gif;base64,AAAA"><img src="${arch}">`, opts);
    expect(r.html).toContain('data:image/gif;base64,AAAA');
    expect(r.html).toContain(arch);
    expect(r.assets).toEqual([]);
  });

  it('does not touch page links (handled in task 2.2)', () => {
    const r = repairV0('<a href="other.html">x</a>', opts);
    expect(r.html).toContain('href="other.html"');
  });

  it('switches forms off and says so', () => {
    const r = repairV0(
      '<form action="/post.cgi" method="post" target="_blank"><input name="q"><input type="password" name="p"><select name="s"></select><textarea name="t"></textarea><button>Go</button></form>',
      opts,
    );
    expect(r.formsDisabled).toBe(1);
    expect(r.html).not.toMatch(/action=|method=|target=/i);
    expect(r.html).toContain('data-seance-dead-form');
    expect(r.html).toContain('This form no longer works');
    const disabled = (r.html.match(/disabled="disabled"/g) ?? []).length;
    expect(disabled).toBe(5);
  });

  it('counts each asset once', () => {
    const r = repairV0('<img src="a.gif"><img src="a.gif">', opts);
    expect(r.assets).toHaveLength(1);
  });
});
