import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { JobView } from '@seance/shared';
import { buildApp } from './index.js';
import { DiskCache } from './wayback/cache.js';
import { WaybackError } from './wayback/client.js';
import type { Snapshot } from './wayback/snapshot.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'seance-api-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const snap: Snapshot = { timestamp: '20030412101500', original: 'http://a.com/', mimetype: 'text/html', statuscode: '200' };
const page = '<html><body><h1>Welcome</h1><script>x()</script><img src="p.gif"></body></html>';

function make(find: () => Promise<Snapshot | null>) {
  return buildApp({
    dbFile: ':memory:',
    logger: false,
    pipeline: {
      client: {
        findBestSnapshot: find,
        get: async () => new Response(page, { headers: { 'content-type': 'text/html' } }),
      },
      cache: new DiskCache(path.join(dir, 'cache')),
      outRoot: path.join(dir, 'out'),
    },
  });
}

async function summon(app: ReturnType<typeof make>['app'], url: unknown) {
  return app.inject({ method: 'POST', url: '/api/summons', payload: { url } });
}

describe('POST /api/summons', () => {
  it('rejects bad input with INVALID_URL', async () => {
    const { app } = make(async () => snap);
    for (const bad of [undefined, '', 'nonsense', 'ftp://a.com/', 42]) {
      const res = await summon(app, bad);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_URL');
    }
  });

  it('accepts a url and returns a job id', async () => {
    const { app, runner } = make(async () => snap);
    const res = await summon(app, 'http://a.com/');
    expect(res.statusCode).toBe(202);
    expect(res.json().jobId).toMatch(/^j_[0-9a-f]{12}$/);
    await runner.idle();
  });
});

describe('GET /api/summons/:id', () => {
  it('runs a job to done and serves the resurrected site', async () => {
    const { app, runner } = make(async () => snap);
    const { jobId } = (await summon(app, 'http://a.com/')).json();
    await runner.idle();

    const view = (await app.inject({ method: 'GET', url: `/api/summons/${jobId}` })).json() as JobView;
    expect(view.status).toBe('done');
    expect(view.steps.every((s) => s.state === 'done')).toBe(true);
    expect(view.snapshot).toMatchObject({ timestamp: '20030412101500', date: '2003-04-12' });
    expect(view.result?.beforeUrl).toContain('web.archive.org/web/20030412101500/');
    expect(view.error).toBeNull();

    const site = await app.inject({ method: 'GET', url: view.result!.siteUrl });
    expect(site.statusCode).toBe(200);
    expect(site.headers['content-type']).toContain('text/html');
    expect(site.headers['content-security-policy']).toContain("script-src 'none'");
    expect(site.body).toContain('Welcome');
    expect(site.body).toContain('seance-banner');
    expect(site.body).not.toContain('x()');
  });

  it('fails with a themed NO_SNAPSHOT error and no stack trace', async () => {
    const { app, runner } = make(async () => null);
    const { jobId } = (await summon(app, 'http://a.com/')).json();
    await runner.idle();
    const view = (await app.inject({ method: 'GET', url: `/api/summons/${jobId}` })).json() as JobView;
    expect(view.status).toBe('failed');
    expect(view.error).toEqual({ code: 'NO_SNAPSHOT', message: expect.any(String), spooky: 'The spirits are silent.' });
    expect(view.steps.find((s) => s.name === 'lookup')?.state).toBe('failed');
    expect(view.result).toBeNull();
  });

  it('maps archive failures to ARCHIVE_* codes', async () => {
    const { app, runner } = make(async () => {
      throw new WaybackError('ARCHIVE_RATE_LIMITED', 'raw upstream text');
    });
    const { jobId } = (await summon(app, 'http://a.com/')).json();
    await runner.idle();
    const view = (await app.inject({ method: 'GET', url: `/api/summons/${jobId}` })).json() as JobView;
    expect(view.error?.code).toBe('ARCHIVE_RATE_LIMITED');
    expect(JSON.stringify(view)).not.toContain('raw upstream text');
  });

  it('hides unexpected errors behind INTERNAL', async () => {
    const { app, runner } = make(async () => {
      throw new Error('db password is hunter2');
    });
    const { jobId } = (await summon(app, 'http://a.com/')).json();
    await runner.idle();
    const view = (await app.inject({ method: 'GET', url: `/api/summons/${jobId}` })).json() as JobView;
    expect(view.error?.code).toBe('INTERNAL');
    expect(JSON.stringify(view)).not.toContain('hunter2');
  });

  it('returns 404 for an unknown job', async () => {
    const { app } = make(async () => snap);
    expect((await app.inject({ method: 'GET', url: '/api/summons/j_nope' })).statusCode).toBe(404);
  });
});

describe('GET /sites/*', () => {
  it('404s on unknown ids and on path traversal', async () => {
    const { app } = make(async () => snap);
    expect((await app.inject({ method: 'GET', url: '/sites/abcdefabcdef/' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/sites/abcdefabcdef/..%2F..%2Fsecret' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/sites/..%2F/index.html' })).statusCode).toBe(404);
  });
});
