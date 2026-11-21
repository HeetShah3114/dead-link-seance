import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { JobView } from '@seance/shared';
import { buildApp } from './index.js';
import { DiskCache } from './wayback/cache.js';
import { WaybackError } from './wayback/client.js';
import { DeployError, type Deployer } from './deploy/s3.js';
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

function make(find: () => Promise<Snapshot | null>, deployer?: Deployer, summonsPerHour = 50) {
  return buildApp({
    dbFile: ':memory:',
    logger: false,
    limits: { summonsPerHour },
    ...(deployer ? { deployer } : {}),
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
    for (const bad of [
      undefined,
      '',
      'nonsense',
      'ftp://a.com/',
      42,
      'http://localhost:3000/',
      'http://169.254.169.254/latest/meta-data/',
      'http://192.168.1.1/',
      'http://[::1]/',
      'http://2130706433/',
    ]) {
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

describe('deploy step', () => {
  it('uses the deployer URL and marks the deploy step Published', async () => {
    const calls: Array<{ siteId: string; dir: string }> = [];
    const deployer: Deployer = {
      urlFor: (siteId) => `https://d1.cloudfront.net/sites/${siteId}/`,
      deploy: async (siteId, dir) => {
        calls.push({ siteId, dir });
        return { url: `https://d1.cloudfront.net/sites/${siteId}/` };
      },
    };
    const { app, runner } = make(async () => snap, deployer);
    const { jobId } = (await summon(app, 'http://a.com/')).json();
    await runner.idle();
    const view = (await app.inject({ method: 'GET', url: `/api/summons/${jobId}` })).json() as JobView;
    expect(view.status).toBe('done');
    expect(view.result?.siteUrl).toBe(`https://d1.cloudfront.net/sites/${calls[0]!.siteId}/`);
    expect(view.steps.find((s) => s.name === 'deploy')).toMatchObject({ state: 'done', detail: 'Published' });
  });

  it('reports DEPLOY_FAILED without leaking upload details', async () => {
    const deployer: Deployer = {
      urlFor: (siteId) => `https://d1.cloudfront.net/sites/${siteId}/`,
      deploy: async () => {
        throw new DeployError('AccessDenied: arn:aws:iam::123:role/secret');
      },
    };
    const { app, runner } = make(async () => snap, deployer);
    const { jobId } = (await summon(app, 'http://a.com/')).json();
    await runner.idle();
    const view = (await app.inject({ method: 'GET', url: `/api/summons/${jobId}` })).json() as JobView;
    expect(view.status).toBe('failed');
    expect(view.error?.code).toBe('DEPLOY_FAILED');
    expect(view.steps.find((s) => s.name === 'deploy')?.state).toBe('failed');
    expect(JSON.stringify(view)).not.toContain('arn:aws');
  });
});

describe('limits (task 2.7)', () => {
  it('allows one active job per client', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { app, runner } = make(async () => {
      await gate;
      return snap;
    });
    expect((await summon(app, 'http://a.com/')).statusCode).toBe(202);
    const second = await summon(app, 'http://b.com/');
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('JOB_ACTIVE');
    release();
    await runner.idle();
    expect((await summon(app, 'http://b.com/')).statusCode).toBe(202);
    await runner.idle();
  });

  it('limits summons per hour', async () => {
    const { app, runner } = make(async () => snap, undefined, 2);
    for (const u of ['http://a.com/', 'http://b.com/']) {
      expect((await summon(app, u)).statusCode).toBe(202);
      await runner.idle();
    }
    const third = await summon(app, 'http://c.com/');
    expect(third.statusCode).toBe(429);
    expect(third.json().error).toMatchObject({ code: 'RATE_LIMITED', spooky: expect.any(String) });
  });

  it('rejects oversized request bodies', async () => {
    const { app } = make(async () => snap);
    const res = await app.inject({ method: 'POST', url: '/api/summons', payload: { url: `http://a.com/${'x'.repeat(20000)}` } });
    expect(res.statusCode).toBe(413);
  });
});

describe('reuse (task 2.8)', () => {
  it('reuses an earlier build of the same url and snapshot without fetching pages again', async () => {
    let gets = 0;
    const { app, runner } = buildApp({
      dbFile: ':memory:',
      logger: false,
      pipeline: {
        client: {
          findBestSnapshot: async () => snap,
          get: async () => {
            gets++;
            return new Response(page, { headers: { 'content-type': 'text/html' } });
          },
        },
        cache: new DiskCache(path.join(dir, 'cache')),
        outRoot: path.join(dir, 'out'),
      },
    });
    const first = (await summon(app, 'http://a.com/')).json().jobId;
    await runner.idle();
    const after1 = gets;
    const second = (await summon(app, 'http://a.com/')).json().jobId;
    await runner.idle();
    const v1 = (await app.inject({ method: 'GET', url: `/api/summons/${first}` })).json() as JobView;
    const v2 = (await app.inject({ method: 'GET', url: `/api/summons/${second}` })).json() as JobView;
    expect(v2.status).toBe('done');
    expect(v2.result?.siteUrl).toBe(v1.result?.siteUrl);
    expect(v2.result?.report.reused).toBe(true);
    expect(gets).toBe(after1);
  });
});
