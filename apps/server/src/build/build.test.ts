import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { injectBanner, BANNER_ID } from './banner.js';
import { buildSiteV0 } from './build.js';

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

describe('buildSiteV0', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'seance-build-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes index.html with the banner', async () => {
    const { indexPath } = await buildSiteV0({ ...opts, html: '<body><h1>Welcome</h1></body>', outDir: path.join(dir, 'site') });
    expect(path.basename(indexPath)).toBe('index.html');
    const written = await readFile(indexPath, 'utf8');
    expect(written).toContain('Welcome');
    expect(written).toContain(BANNER_ID);
  });
});
