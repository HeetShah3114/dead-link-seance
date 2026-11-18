import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { JobView, SummonRequest, SummonResponse } from '@seance/shared';
import { apiError } from './jobs/errors.js';
import type { JobRunner } from './jobs/runner.js';
import type { JobRow, JobStore } from './jobs/store.js';

export interface RouteContext {
  store: JobStore;
  runner: JobRunner;
  /** Folder holding one subfolder per resurrected site. */
  outRoot: string;
}

export function toView(j: JobRow): JobView {
  return {
    jobId: j.id,
    status: j.status,
    step: j.step,
    steps: j.steps,
    snapshot: j.snapshot,
    result: j.result,
    error: j.error,
  };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function validUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 2048) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function registerRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/health', async () => ({ ok: true }));

  app.post('/api/summons', async (req, reply) => {
    const body = (req.body ?? {}) as Partial<SummonRequest>;
    if (!validUrl(body.url)) {
      return reply.code(400).send({ error: apiError('INVALID_URL') });
    }
    // Client identity is hashed so raw IPs are never stored. (design 7)
    const clientHash = createHash('sha256').update(req.ip).digest('hex').slice(0, 16);
    const job = ctx.store.create(body.url, clientHash);
    ctx.runner.enqueue(job.id);
    const res: SummonResponse = { jobId: job.id };
    return reply.code(202).send(res);
  });

  app.get<{ Params: { id: string } }>('/api/summons/:id', async (req, reply) => {
    const job = ctx.store.get(req.params.id);
    if (!job) return reply.code(404).send({ error: apiError('INTERNAL') });
    return toView(job);
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
        .header('content-type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
        // Resurrected pages must never run scripts. (R11.3)
        .header('content-security-policy', "script-src 'none'; frame-ancestors *")
        .header('x-content-type-options', 'nosniff')
        .send(data);
    } catch {
      return reply.code(404).send();
    }
  });
}
