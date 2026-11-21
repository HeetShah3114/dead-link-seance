import path from 'node:path';
import { mkdirSync } from 'node:fs';
import Fastify from 'fastify';
import { WaybackClient } from './wayback/client.js';
import { DiskCache } from './wayback/cache.js';
import { JobRunner } from './jobs/runner.js';
import { JobStore, openDb } from './jobs/store.js';
import { registerRoutes } from './routes.js';
import type { ResurrectDeps } from './pipeline/resurrect.js';
import { S3Client } from '@aws-sdk/client-s3';
import { S3Deployer, type Deployer } from './deploy/s3.js';

export interface AppOptions {
  /** SQLite file, or ":memory:". */
  dbFile: string;
  pipeline: Pick<ResurrectDeps, 'client' | 'cache' | 'outRoot'>;
  publicBase?: string;
  deployer?: Deployer;
  logger?: boolean;
}

export function buildApp(opts: AppOptions) {
  const app = Fastify({ logger: opts.logger ?? true });
  const store = new JobStore(openDb(opts.dbFile));
  const runner = new JobRunner({
    store,
    pipeline: opts.pipeline,
    ...(opts.publicBase !== undefined ? { publicBase: opts.publicBase } : {}),
    ...(opts.deployer ? { deployer: opts.deployer } : {}),
    log: (msg, extra) => app.log.warn(extra ?? {}, msg),
  });
  registerRoutes(app, { store, runner, outRoot: opts.pipeline.outRoot });
  return { app, runner, store };
}

function main() {
  const dataDir = process.env.DATA_DIR ?? 'data';
  const outRoot = process.env.OUT_DIR ?? 'out';
  mkdirSync(dataDir, { recursive: true });
  // Publishing is on only when both are set. Credentials come from the standard AWS chain (AWS_PROFILE etc.).
  const deployer: Deployer | undefined =
    process.env.DEPLOY_BUCKET && process.env.DEPLOY_BASE_URL
      ? new S3Deployer({
          bucket: process.env.DEPLOY_BUCKET,
          baseUrl: process.env.DEPLOY_BASE_URL,
          // R2 speaks the S3 API: set DEPLOY_S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
          // and pass an R2 access key as AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (env only, never in code).
          s3: new S3Client(
            process.env.DEPLOY_S3_ENDPOINT
              ? { endpoint: process.env.DEPLOY_S3_ENDPOINT, region: 'auto', forcePathStyle: true }
              : { ...(process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {}) },
          ),
        })
      : undefined;
  const { app } = buildApp({
    dbFile: path.join(dataDir, 'seance.db'),
    pipeline: {
      client: new WaybackClient({
        userAgent: 'DeadLinkSeance/0.1 (+https://github.com/HeetShah3114/dead-link-seance)',
      }),
      cache: new DiskCache(path.join(dataDir, 'cache')),
      outRoot,
    },
    ...(process.env.PUBLIC_BASE_URL ? { publicBase: process.env.PUBLIC_BASE_URL } : {}),
    ...(deployer ? { deployer } : {}),
  });
  app
    .listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '127.0.0.1' })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

if (process.env.VITEST === undefined) main();
