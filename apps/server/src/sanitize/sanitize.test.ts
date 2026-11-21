import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as cheerio from 'cheerio';
import { sanitize } from './sanitize.js';

const URL_ATTRS = ['href', 'src', 'lowsrc', 'background', 'poster', 'action', 'formaction', 'xlink:href', 'cite', 'data'];

/** Problems a sanitized page must never have. Checked on the re-parsed output, as a browser would see it. */
function problems(html: string): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  if ($('script, iframe, frame, frameset, object, embed, applet, base, svg, math, template').length) out.push('dangerous tag');
  $('meta').each((_, el) => {
    if (/refresh/i.test($(el).attr('http-equiv') ?? '')) out.push('meta refresh');
  });
  $('*').each((_, el) => {
    if (el.type !== 'tag') return;
    for (const [name, value] of Object.entries(el.attribs)) {
      if (/^on/i.test(name)) out.push(`handler ${name}`);
      if (name === 'srcdoc') out.push('srcdoc');
      if (URL_ATTRS.includes(name)) {
        // Browsers ignore control chars and whitespace before the scheme.
        const v = value.replace(/[\u0000-\u0020\u007f-\u009f]/g, '').toLowerCase();
        if (/^(javascript|vbscript|livescript):/.test(v)) out.push(`${name}=${v.slice(0, 20)}`);
        if (/^data:/.test(v) && !(el.name === 'img' && /^data:image\/(gif|png|jpe?g|webp|bmp);/.test(v))) out.push(`${name} data url`);
      }
    }
  });
  return out;
}

describe('sanitize', () => {
  it('keeps old-school markup', () => {
    const html =
      '<html><head><title>My Page</title><style>body{color:lime}</style><link rel="stylesheet" href="https://web.archive.org/x.css"></head>' +
      '<body bgcolor="#000000" text="#00ff00"><center><font face="Comic Sans MS" size="5"><marquee>Welcome!!</marquee></font></center>' +
      '<table border="1" cellpadding="4"><tr><td background="a/bg.gif"><img src="a/1.gif" width="88" height="31" alt="banner"></td></tr></table>' +
      '<a href="p/x.html" data-seance-link="page">next</a><span class="seance-missing" data-seance-missing="image">lost</span></body></html>';
    const out = sanitize(html);
    for (const bit of ['<title>My Page</title>', 'body{color:lime}', 'bgcolor="#000000"', '<marquee>', 'face="Comic Sans MS"', 'background="a/bg.gif"', 'width="88"', 'data-seance-link="page"', 'data-seance-missing="image"', 'rel="stylesheet"']) {
      expect(out, bit).toContain(bit);
    }
    expect(problems(out)).toEqual([]);
  });

  it('removes scripts, handlers, javascript urls, frames and meta refresh', () => {
    const out = sanitize(
      '<meta http-equiv="refresh" content="0;url=http://evil.com"><script>alert(1)</script>' +
        '<body onload="x()"><a href="javascript:alert(1)">a</a><a href=" JaVaScRiPt:alert(1)">b</a>' +
        '<img src="x" onerror="alert(1)"><iframe src="http://evil.com"></iframe><object data="x.swf"></object>' +
        '<a href="data:text/html,<script>alert(1)</script>">c</a><svg><script>alert(1)</script></svg>' +
        '<button formaction="javascript:alert(1)">d</button><base href="http://evil.com/"><link rel="import" href="x.html"></body>',
    );
    expect(problems(out)).toEqual([]);
    expect(out).not.toContain('alert');
    expect(out).not.toContain('evil.com');
    expect(out).toContain('>a</a>');
  });

  it('allows data: only in img src, and only for images (regression: found by the property test)', () => {
    const out = sanitize('<img href="data:text/html,alert(1)" src="data:image/gif;base64,R0lG"><img src="data:text/html,x"><img lowsrc="data:image/gif;base64,R0lG">');
    expect(out).not.toContain('text/html');
    expect(out).not.toContain('href');
    expect(out).not.toContain('lowsrc');
    expect(out).toContain('src="data:image/gif;base64,R0lG"');
  });

  it('keeps textarea and option text', () => {
    const out = sanitize('<textarea>Sign my guestbook!</textarea><select><option>Hollywood</option></select>');
    expect(out).toContain('Sign my guestbook!');
    expect(out).toContain('Hollywood');
  });

  it('property: no script, handler or javascript url survives, for any mix of dangerous fragments', () => {
    const scheme = fc.constantFrom('javascript:', 'JAVASCRIPT:', ' javascript:', '\tjava\nscript:', 'vbscript:', 'jav&#x09;ascript:', '&#106;avascript:', 'data:text/html,');
    const attr = fc.constantFrom('href', 'src', 'background', 'action', 'formaction', 'poster', 'lowsrc');
    const handler = fc.constantFrom('onload', 'onerror', 'onclick', 'ONMOUSEOVER', 'onfocus');
    const tag = fc.constantFrom('a', 'img', 'body', 'td', 'div', 'form', 'input', 'video', 'button', 'iframe', 'script', 'object', 'embed', 'svg', 'math', 'base', 'meta', 'link', 'style');
    const fragment = fc.oneof(
      fc.tuple(tag, attr, scheme).map(([t, a, s]) => `<${t} ${a}="${s}alert(1)">x</${t}>`),
      fc.tuple(tag, handler).map(([t, h]) => `<${t} ${h}="alert(1)">x</${t}>`),
      fc.constant('<script>alert(1)</script>'),
      fc.constant('<scr<script>ipt>alert(1)</script>'),
      fc.constant('<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'),
      fc.constant('<svg><a xlink:href="javascript:alert(1)">x</a></svg>'),
      fc.constant('<iframe srcdoc="<script>alert(1)</script>"></iframe>'),
      fc.constant('<!--<script>alert(1)</script>-->'),
      fc.constant('<p>plain text</p>'),
      fc.string({ maxLength: 20 }),
    );
    fc.assert(
      fc.property(fc.array(fragment, { maxLength: 12 }), (parts) => {
        const out = sanitize(`<html><body>${parts.join('')}</body></html>`);
        return problems(out).length === 0 && !/<script/i.test(out);
      }),
      { numRuns: 300 },
    );
  });

  it('property: sanitizing twice changes nothing', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => sanitize(sanitize(s)) === sanitize(s)),
      { numRuns: 200 },
    );
  });
});
