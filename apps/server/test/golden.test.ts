// Task 2.9: one saved site through the whole pipeline, offline, compared with stored output.
// The fixture is a made-up GeoCities-style page (no real third-party content).
// To accept intended changes: npx vitest run apps/server/test/golden.test.ts -u
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DiskCache } from '../src/wayback/cache.js';
import { resurrect, type ResurrectResult } from '../src/pipeline/resurrect.js';
import type { Snapshot } from '../src/wayback/snapshot.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures', 'geo-site');
const BASE = 'http://www.geocities.com/Hollywood/Hills/1234/';
const TS = '19990220012606';
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** The fake archive: two pages and two images exist; everything else was never archived. */
async function archive(): Promise<Record<string, { type: string; body: Buffer }>> {
  const latin1 = (s: string) => Buffer.from(s, 'latin1');
  return {
    [BASE]: { type: 'text/html', body: latin1(await readFile(path.join(fixtures, 'index.html'), 'utf8')) },
    [`${BASE}episodes.html`]: { type: 'text/html', body: latin1(await readFile(path.join(fixtures, 'episodes.html'), 'utf8')) },
    [`${BASE}banner.gif`]: { type: 'image/gif', body: GIF },
    [`${BASE}stars.gif`]: { type: 'image/gif', body: GIF },
  };
}

let dir: string;
let result: ResurrectResult;
let files: string[];

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'seance-golden-'));
  const store = await archive();
  const snap: Snapshot = { timestamp: TS, original: BASE, mimetype: 'text/html', statuscode: '200' };
  result = await resurrect(BASE, {
    client: {
      findBestSnapshot: async () => snap,
      get: async (u: string) => {
        const original = u.replace(/^https:\/\/web\.archive\.org\/web\/\d+id_\//, '');
        const f = store[original];
        return f
          ? new Response(f.body, { headers: { 'content-type': f.type } })
          : new Response('not archived', { status: 404, headers: { 'content-type': 'text/html' } });
      },
    },
    cache: new DiskCache(path.join(dir, 'cache')),
    outRoot: path.join(dir, 'out'),
    outDirName: 'goldensite01',
  });
  files = (await readdir(result.outDir, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => path.relative(result.outDir, path.join(e.parentPath, e.name)).replace(/\\/g, '/'))
    .sort();
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('golden: GeoCities-style site, end to end', () => {
  it('produces the expected files', () => {
    expect(files).toMatchSnapshot();
  });

  it('produces the expected report', () => {
    // outDir and indexPath are temp paths: leave them out of the snapshot.
    const report = Object.fromEntries(Object.entries(result).filter(([k]) => k !== 'outDir' && k !== 'indexPath'));
    expect(report).toMatchSnapshot();
  });

  it('produces the expected pages', async () => {
    for (const f of files.filter((x) => x.endsWith('.html'))) {
      const html = await readFile(path.join(result.outDir, f), 'utf8');
      await expect(html).toMatchFileSnapshot(path.join(here, '__golden__', f));
    }
  });

  it('keeps the promises that matter, whatever the snapshot says', async () => {
    const home = await readFile(path.join(result.outDir, 'index.html'), 'utf8');
    expect(home).toContain('Café'); // latin1 decoded correctly
    expect(home).toContain('This is a reconstruction');
    expect(home).toContain('This form no longer works');
    expect(home).toContain('[image lost: Buffy webring]');
    expect(home).not.toMatch(/<script|<embed|onload/i);
    expect(home).toContain(`https://web.archive.org/web/${TS}/http://www.delphi.com/buffyfans/`);
  });
});
