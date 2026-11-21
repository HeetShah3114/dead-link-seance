import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { injectBanner, BANNER_ID } from './banner.js';
import { buildSite } from './build.js';

const opts = { pageUrl: 'http://a.com/old/', timestamp: '20030412101500' };

describe('injectBanner', () => {
  it('adds a banner with the snapshot link, the date and the reconstruction notice', () => {
    const $ = cheerio.load(injectBanner('<html><body><p>hi</p></body></html>', opts));
    const banner = $(`#${BANNER_ID}`);
    expect(banner).toHaveLength(1);
    expect(banner.text()).toContain('reconstruction');
    expect(banner.text()).toContain('2003-04-12');
    expect(banner.find('a').first().attr('href')).toBe('https://web.archive.org/web/20030412101500/http://a.com/old/');
    expect($('p').text()).toBe('hi');
  });

  it('puts the banner and its style last in the body so page CSS cannot beat it', () => {
    const $ = cheerio.load(injectBanner('<body><p>hi</p></body>', opts));
    const kids = $('body').children().toArray();
    expect(kids[kids.length - 1]!.attribs.id).toBe(BANNER_ID);
    expect($('body style').text()).toContain('!important');
  });

  it('works on a fragment without html or body tags', () => {
    const $ = cheerio.load(injectBanner('<p>just text</p>', opts));
    expect($(`#${BANNER_ID}`)).toHaveLength(1);
    expect($('p').first().text()).toBe('just text');
  });

  it('escapes a hostile page url', () => {
    const html = injectBanner('<body></body>', { ...opts, pageUrl: 'http://a.com/"><script>x()</script>' });
    // Re-parse the output: a real injection would show up as a <script> element.
    const $ = cheerio.load(html);
    expect($('script')).toHaveLength(0);
    expect($(`#${BANNER_ID} a`).first().attr('href')).toContain('x()');
  });
});

describe('buildSite', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'seance-build-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes every page sanitized with its own banner, plus assets', async () => {
    const out = path.join(dir, 'site');
    const { indexPath } = await buildSite({
      outDir: out,
      timestamp: opts.timestamp,
      pages: [
        { path: 'index.html', html: '<body><h1>Welcome</h1><img src="x" onerror="alert(1)"></body>', pageUrl: 'http://a.com/old/' },
        { path: 'p/b.html', html: '<body><p>B</p></body>', pageUrl: 'http://a.com/old/b.html' },
      ],
      assets: [{ path: 'a/1.gif', body: Buffer.from('GIF89a') }],
    });
    expect(path.basename(indexPath)).toBe('index.html');
    const home = await readFile(indexPath, 'utf8');
    expect(home).toContain('Welcome');
    expect(home).toContain(BANNER_ID);
    expect(home).not.toContain('onerror');
    const b = await readFile(path.join(out, 'p', 'b.html'), 'utf8');
    // R7.4: each page credits its own snapshot
    expect(b).toContain('https://web.archive.org/web/20030412101500/http://a.com/old/b.html');
    expect((await readFile(path.join(out, 'a', '1.gif'))).toString()).toBe('GIF89a');
  });

  it('refuses to write outside the site folder', async () => {
    await expect(
      buildSite({ outDir: path.join(dir, 'site'), timestamp: opts.timestamp, pages: [{ path: '../evil.html', html: 'x', pageUrl: 'http://a.com/' }], assets: [] }),
    ).rejects.toThrow(/outside the site/);
  });
});
