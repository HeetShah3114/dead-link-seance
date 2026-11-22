import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Example, JobView, SummonRequest, SummonResponse } from '@seance/shared';
import type { Deployer } from './deploy/s3.js';
import { zipFolder } from './site/zip.js';
import { mimeFor } from './mime.js';
import { checkTargetUrl } from './safety/url-guard.js';
import { apiError } from './jobs/errors.js';
import type { JobRunner } from './jobs/runner.js';
import type { JobRow, JobStore } from './jobs/store.js';

export interface RouteContext {
  store: JobStore;
  runner: JobRunner;
  /** Folder holding one subfolder per resurrected site. */
  outRoot: string;
  summonsPerHour: number;
  /** Pre-summoned demo sites for the home page. */
  examples?: () => Promise<Example[]>;
  /** Takedown token. When unset, the takedown route is off. (R11.4) */
  adminToken?: string;
  /** Deletes published copies on takedown. */
  deployer?: Pick<Deployer, 'remove'>;
  now?: () => number;
}

const SITE_ID = /^[a-z0-9]{12}$/;

function siteDir(outRoot: string, siteId: string | null): string | null {
  if (!siteId || !SITE_ID.test(siteId)) return null;
  const dir = path.resolve(outRoot, siteId);
  return existsSync(path.join(dir, 'index.html')) ? dir : null;
}

export function toView(j: JobRow, outRoot?: string): JobView {
  const zip = outRoot && j.error?.code !== 'REMOVED' && siteDir(outRoot, j.siteId) ? `/api/summons/${j.id}/download` : null;
  return {
    jobId: j.id,
    status: j.status,
    step: j.step,
    steps: j.steps,
    snapshot: j.snapshot,
    result: j.result ? { ...j.result, downloadUrl: zip ?? '' } : null,
    error: j.error,
    downloadUrl: zip,
  };
}

/** Constant-time token check: compare digests so length does not leak either. */
function tokenOk(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || given.length === 0) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function registerRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/health', async () => ({ ok: true }));

  app.post('/api/summons', async (req, reply) => {
    const body = (req.body ?? {}) as Partial<SummonRequest>;
    // Refused before any job exists or any external call is made. (R1.2, R11.2)
    const guard = checkTargetUrl(body.url);
    if (!guard.ok) {
      return reply.code(400).send({ error: apiError('INVALID_URL') });
    }
    // Client identity is hashed so raw IPs are never stored. (design 7)
    const clientHash = createHash('sha256').update(req.ip).digest('hex').slice(0, 16);
    // One summoning at a time per client, and a few per hour. (R1.4, R11.1)
    if (ctx.store.hasActive(clientHash)) {
      return reply.code(409).send({ error: apiError('JOB_ACTIVE') });
    }
    const now = (ctx.now ?? Date.now)();
    if (ctx.store.countSince(clientHash, now - 3600_000) >= ctx.summonsPerHour) {
      return reply.code(429).header('retry-after', '3600').send({ error: apiError('RATE_LIMITED') });
    }
    const job = ctx.store.create(guard.url.href, clientHash);
    ctx.runner.enqueue(job.id);
    const res: SummonResponse = { jobId: job.id };
    return reply.code(202).send(res);
  });

  app.get<{ Params: { id: string } }>('/api/summons/:id', async (req, reply) => {
    const job = ctx.store.get(req.params.id);
    if (!job) return reply.code(404).send({ error: apiError('INTERNAL') });
    return toView(job, ctx.outRoot);
  });

  // Zip of the built site. Works even when publishing failed. (R10.4)
  app.get<{ Params: { id: string } }>('/api/summons/:id/download', async (req, reply) => {
    const job = ctx.store.get(req.params.id);
    const dir = job && job.error?.code !== 'REMOVED' ? siteDir(ctx.outRoot, job.siteId) : null;
    if (!job || !dir) return reply.code(404).send({ error: apiError('INTERNAL') });
    const host = (() => {
      try {
        return new URL(job.inputUrl).hostname.replace(/[^a-z0-9.-]/gi, '');
      } catch {
        return 'site';
      }
    })();
    const name = `resurrected-${host}-${job.snapshot?.timestamp ?? 'site'}`;
    const zip = await zipFolder(dir, name);
    return reply
      .header('content-type', 'application/zip')
      .header('content-disposition', `attachment; filename="${name}.zip"`)
      .header('cache-control', 'no-store')
      .send(Buffer.from(zip));
  });

  app.get('/api/examples', async () => (ctx.examples ? ctx.examples() : []));

  // Takedown. Off unless ADMIN_TOKEN is set; the token goes in a header, never the URL. (R11.4)
  app.delete<{ Params: { siteId: string } }>('/api/sites/:siteId', async (req, reply) => {
    if (!ctx.adminToken) return reply.code(404).send();
    if (!tokenOk(req.headers['x-admin-token'], ctx.adminToken)) return reply.code(401).send({ error: 'unauthorized' });
    const { siteId } = req.params;
    if (!SITE_ID.test(siteId)) return reply.code(400).send({ error: 'bad site id' });
    const published = ctx.deployer ? await ctx.deployer.remove(siteId) : 0;
    const dir = path.resolve(ctx.outRoot, siteId);
    if (dir.startsWith(path.resolve(ctx.outRoot) + path.sep)) await rm(dir, { recursive: true, force: true });
    const jobs = ctx.store.markRemoved(siteId, apiError('REMOVED'));
    req.log.warn({ siteId, published, jobs }, 'site taken down');
    return { siteId, publishedFilesDeleted: published, jobsUpdated: jobs };
  });

  // Serve built sites from disk. Replaced by S3 + CloudFront in task 1.8.
  app.get<{ Params: { siteId: string; '*': string } }>('/sites/:siteId/*', async (req, reply) => {
    const { siteId } = req.params;
    if (!/^[a-z0-9]{12}$/.test(siteId)) return reply.code(404).send();
    const rel = decodeURIComponent(req.params['*'] || 'index.html') || 'index.html';
    const root = path.resolve(ctx.outRoot, siteId);
    let file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) return reply.code(404).send();
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      const data = await readFile(file);
      return reply
        .header('content-type', mimeFor(file))
        // Resurrected pages must never run scripts. (R11.3)
        .header('content-security-policy', "script-src 'none'; frame-ancestors *")
        .header('x-content-type-options', 'nosniff')
        .send(data);
    } catch {
      return reply.code(404).send();
    }
  });
}
