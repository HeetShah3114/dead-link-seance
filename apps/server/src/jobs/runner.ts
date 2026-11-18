import { randomBytes } from 'node:crypto';
import type { StepInfo, StepName } from '@seance/shared';
import { resurrectV0, type ResurrectDeps } from '../pipeline/resurrect.js';
import type { Deployer } from '../deploy/s3.js';
import { toApiError } from './errors.js';
import { JobStore } from './store.js';

export interface RunnerOptions {
  store: JobStore;
  /** Wayback client, cache and output root. Step callbacks are added by the runner. */
  pipeline: Pick<ResurrectDeps, 'client' | 'cache' | 'outRoot'>;
  /** Prefix for site URLs when served locally, e.g. "" (same origin). Ignored when a deployer is set. */
  publicBase?: string;
  /** Publishes the built site (S3 + CloudFront). When absent, sites are served from this server. */
  deployer?: Deployer;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

/** Runs jobs one at a time, in order. Enough for the MVP and keeps Wayback traffic polite. (R4.2) */
export class JobRunner {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly o: RunnerOptions) {}

  enqueue(jobId: string): void {
    this.tail = this.tail.then(() => this.run(jobId)).catch(() => undefined);
  }

  /** Resolves when everything queued so far has finished. Used by tests. */
  idle(): Promise<void> {
    return this.tail;
  }

  private setStep(jobId: string, step: StepName, detail?: string): void {
    const job = this.o.store.get(jobId)!;
    const steps: StepInfo[] = job.steps.map((s) => {
      if (s.name === step) return { name: s.name, state: 'active', ...(detail ? { detail } : {}) };
      if (s.state === 'active') return { ...s, state: 'done' };
      return s;
    });
    this.o.store.update(jobId, { status: 'running', step, steps });
  }

  private async run(jobId: string): Promise<void> {
    const { store, pipeline, publicBase = '' } = this.o;
    const siteId = randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(12, '0').slice(0, 12);
    const job = store.get(jobId);
    if (!job) return;
    try {
      const r = await resurrectV0(job.inputUrl, {
        ...pipeline,
        outDirName: siteId,
        onStep: (step, detail) => this.setStep(jobId, step, detail),
        onSnapshot: (snapshot) => store.update(jobId, { snapshot }),
      });
      let siteUrl = `${publicBase}/sites/${siteId}/`;
      let deployDetail = 'Served from this server';
      if (this.o.deployer) {
        this.setStep(jobId, 'deploy');
        siteUrl = (await this.o.deployer.deploy(siteId, r.outDir)).url;
        deployDetail = 'Published';
      }
      const done = store.get(jobId)!;
      // aifill is not built yet (tasks 3.x): mark it honestly.
      const steps: StepInfo[] = done.steps.map((s) =>
        s.name === 'aifill'
          ? { name: s.name, state: 'done', detail: 'Skipped (not built yet)' }
          : s.name === 'deploy'
            ? { name: s.name, state: 'done', detail: deployDetail }
            : { ...s, state: 'done' },
      );
      store.update(jobId, {
        status: 'done',
        step: 'deploy',
        steps,
        siteId,
        result: {
          siteUrl,
          beforeUrl: r.beforeUrl,
          downloadUrl: '', // zip download arrives with task 4.6
          lostNote: '', // "what was lost" note arrives with task 3.5
          report: {
            pagesFound: 1,
            pagesRecovered: 1,
            assetsFound: r.assets,
            assetsRecovered: 0, // not verified until task 2.2 downloads assets
            aiRestoredItems: 0,
            aiSkipped: true,
            lostPages: [],
            lostAssets: [],
          },
        },
      });
    } catch (e) {
      const cur = store.get(jobId)!;
      const steps: StepInfo[] = cur.steps.map((s) => (s.state === 'active' ? { ...s, state: 'failed' } : s));
      this.o.log?.('job failed', { jobId, step: cur.step, error: e instanceof Error ? e.message : String(e) });
      store.update(jobId, { status: 'failed', steps, error: toApiError(e) });
    }
  }
}
