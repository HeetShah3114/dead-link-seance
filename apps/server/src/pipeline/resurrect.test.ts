import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DiskCache } from '../wayback/cache.js';
import type { Snapshot } from '../wayback/snapshot.js';
import { resurrectV0, PipelineError } from './resurrect.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'seance-pipe-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const snap: Snapshot = { timestamp: '20030412101500', original: 'http://a.com/', mimetype: 'text/html', statuscode: '200' };

function deps(snapshot: Snapshot | null, res: () => Response) {
  return {
    client: { findBestSnapshot: async () => snapshot, get: async () => res() },
    cache: new DiskCache(path.join(dir, 'cache')),
    outRoot: path.join(dir, 'out'),
  };
}

describe('resurrectV0', () => {
  it('goes from URL to a banner-wrapped, repaired index.html', async () => {
    const html = '<html><body><script>bad()</script><h1>Hi</h1><img src="p.gif"></body></html>';
    const r = await resurrectV0(
      'http://a.com/',
      deps(snap, () => new Response(html, { headers: { 'content-type': 'text/html' } })),
    );
    const out = await readFile(r.indexPath, 'utf8');
    expect(out).toContain('<h1>Hi</h1>');
    expect(out).not.toContain('bad()');
    expect(out).toContain('web.archive.org/web/20030412101500id_/http://a.com/p.gif');
    expect(out).toContain('seance-banner');
    expect(out).toContain('<meta charset="utf-8">');
    expect(r.snapshotDate).toBe('2003-04-12');
    expect(r.assets).toBe(1);
  });

  it('rejects a non-http url', async () => {
    await expect(resurrectV0('ftp://a.com/', deps(snap, () => new Response('')))).rejects.toMatchObject({ code: 'INVALID_URL' });
    await expect(resurrectV0('nonsense', deps(snap, () => new Response('')))).rejects.toBeInstanceOf(PipelineError);
  });

  it('reports NO_SNAPSHOT when the archive has nothing', async () => {
    await expect(resurrectV0('http://a.com/', deps(null, () => new Response('')))).rejects.toMatchObject({ code: 'NO_SNAPSHOT' });
  });

  it('reports UNSUPPORTED_TARGET for a non-html snapshot', async () => {
    await expect(
      resurrectV0('http://a.com/', deps(snap, () => new Response('x', { headers: { 'content-type': 'image/gif' } }))),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_TARGET' });
  });
});
