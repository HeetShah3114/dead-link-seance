import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DiskCache } from '../wayback/cache.js';
import type { Snapshot } from '../wayback/snapshot.js';
import { resurrect, PipelineError } from './resurrect.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'seance-pipe-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const snap: Snapshot = { timestamp: '20030412101500', original: 'http://a.com/', mimetype: 'text/html', statuscode: '200' };
type Entry = { status?: number; type: string; body: string };

function deps(snapshot: Snapshot | null, files: Record<string, Entry>) {
  return {
    client: {
      findBestSnapshot: async () => snapshot,
      get: async (u: string) => {
        const original = u.replace(/^https:\/\/web\.archive\.org\/web\/\d+id_\//, '');
        const f = files[original];
        return f
          ? new Response(f.body, { status: f.status ?? 200, headers: { 'content-type': f.type } })
          : new Response('not archived', { status: 404, headers: { 'content-type': 'text/html' } });
      },
    },
    cache: new DiskCache(path.join(dir, 'cache')),
    outRoot: path.join(dir, 'out'),
  };
}

describe('resurrect', () => {
  it('goes from URL to a repaired, bannered multi-page site with local assets', async () => {
    const r = await resurrect(
      'http://a.com/',
      deps(snap, {
        'http://a.com/': { type: 'text/html', body: '<html><body><script>bad()</script><h1>Hi</h1><img src="p.gif"><img src="gone.gif"><a href="b.html">b</a><a href="lost.html">l</a></body></html>' },
        'http://a.com/b.html': { type: 'text/html', body: '<html><body><p>B page</p><a href="/">home</a></body></html>' },
        'http://a.com/p.gif': { type: 'image/gif', body: 'GIF89a' },
      }),
    );
    const out = await readFile(r.indexPath, 'utf8');
    expect(out).toContain('<h1>Hi</h1>');
    expect(out).not.toContain('bad()');
    expect(out).toMatch(/src="a\/[0-9a-f]{16}\.gif"/);
    expect(out).toContain('[image lost]');
    expect(out).toMatch(/href="p\/b-[0-9a-f]{8}\.html"/);
    expect(out).toContain('href="#lost"');
    expect(out).toContain('seance-banner');
    expect(out).toContain('<meta charset="utf-8">');
    expect(r).toMatchObject({
      snapshotDate: '2003-04-12',
      pagesFound: 3,
      pagesRecovered: 2,
      assetsFound: 2,
      assetsRecovered: 1,
      lostPages: ['http://a.com/lost.html'],
      lostAssets: ['http://a.com/gone.gif'],
      scriptsRemoved: 1,
    });
    expect(r.skippedPages).toEqual([{ url: 'http://a.com/lost.html', reason: 'not_found' }]);
  });

  it('rejects unsafe or invalid targets', async () => {
    await expect(resurrect('ftp://a.com/', deps(snap, {}))).rejects.toMatchObject({ code: 'INVALID_URL' });
    await expect(resurrect('nonsense', deps(snap, {}))).rejects.toBeInstanceOf(PipelineError);
    await expect(resurrect('http://localhost/', deps(snap, {}))).rejects.toMatchObject({ code: 'INVALID_URL' });
  });

  it('reports NO_SNAPSHOT when the archive has nothing', async () => {
    await expect(resurrect('http://a.com/', deps(null, {}))).rejects.toMatchObject({ code: 'NO_SNAPSHOT' });
  });

  it('reports UNSUPPORTED_TARGET for a non-html start page', async () => {
    await expect(resurrect('http://a.com/', deps(snap, { 'http://a.com/': { type: 'image/gif', body: 'x' } }))).rejects.toMatchObject({
      code: 'UNSUPPORTED_TARGET',
    });
  });
});
