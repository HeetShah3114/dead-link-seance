import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { JobResult, StepInfo, StepName } from '@seance/shared';
import { locate, rebuild, type ResurrectDeps } from '../pipeline/resurrect.js';
import type { Deployer } from '../deploy/s3.js';
import { DEFAULT_LIMITS, type Limits } from '../config.js';
import type { Llm } from '../ai/llm.js';
import { toApiError } from './errors.js';
import { JobStore } from './store.js';

export interface RunnerOptions {
  store: JobStore;
  /** Wayback client, cache and output root. Step callbacks are added by the runner. */
  pipeline: Pick<ResurrectDeps, 'client' | 'cache' | 'outRoot'>;
  limits?: Partial<Limits>;
  /** Prefix for site URLs when served locally, e.g. "" (same origin). Ignored when a deployer is set. */
  publicBase?: string;
  /** Publishes the built site (R2 + Worker). When absent, sites are served from this server. */
  deployer?: Deployer;
  /** Optional AI for gap-filling. Without it, sites are built with no AI text. */
  llm?: Llm;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
  now?: () => number;
}

/** 12 random lower-case letters and digits: not guessable from other users' links. (R8.5) */
export function newSiteId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(12);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

/** Runs jobs one at a time, in order. Enough for the MVP and keeps Wayback traffic polite. (R4.2) */
export class JobRunner {
  private tail: Promise<void> = Promise.resolve();
  private readonly limits: Limits;

  constructor(private readonly o: RunnerOptions) {
    this.limits = { ...DEFAULT_LIMITS, ...o.limits };
  }

  enqueue(jobId: string): void {
    this.tail = this.tail.then(() => this.run(jobId)).catch(() => undefined);
  }

  /** Resolves when everything queued so far has finished. Used by tests. */
  idle(): Promise<void> {
    return this.tail;
  }

  private setStep(jobId: string, step: StepName, detail?: string): void {
    const job = this.o.store.get(jobId)!;
    const idx = job.steps.findIndex((s) => s.name === step);
    const steps: StepInfo[] = job.steps.map((s, i) => {
      if (i === idx) return { name: s.name, state: 'active', ...(detail ? { detail } : {}) };
      if (i < idx && s.state !== 'done') return { ...s, state: 'done' };
      return s;
    });
    this.o.store.update(jobId, { status: 'running', step, steps });
  }

  private finish(jobId: string, siteId: string, result: JobResult, details: Partial<Record<StepName, string>>): void {
    const steps: StepInfo[] = this.o.store.get(jobId)!.steps.map((s) => {
      const detail = details[s.name] ?? s.detail;
      return { name: s.name, state: 'done', ...(detail ? { detail } : {}) };
    });
    this.o.store.update(jobId, { status: 'done', step: 'deploy', steps, siteId, result });
  }

  private siteUrlFor(siteId: string): string {
    return this.o.deployer ? this.o.deployer.urlFor(siteId) : `${this.o.publicBase ?? ''}/sites/${siteId}/`;
  }

  private async run(jobId: string): Promise<void> {
    const { store, pipeline } = this.o;
    const now = this.o.now ?? Date.now;
    const job = store.get(jobId);
    if (!job) return;
    try {
      const onStep = (step: StepName, detail?: string) => this.setStep(jobId, step, detail);
      const loc = await locate(job.inputUrl, { client: pipeline.client, onStep });
      store.update(jobId, { snapshot: loc.snapshot });

      // Same url and snapshot built recently: reuse it, no new archive traffic. (R8.3)
      const prior = store.findReusable(job.inputUrl, loc.snap.timestamp, now() - this.limits.reuseMaxAgeMs);
      if (prior?.result && prior.siteId && prior.result.siteUrl === this.siteUrlFor(prior.siteId)) {
        const stillThere = this.o.deployer || existsSync(path.join(pipeline.outRoot, prior.siteId, 'index.html'));
        if (stillThere) {
          const reusedNote = 'Reused an earlier resurrection';
          this.finish(jobId, prior.siteId, { ...prior.result, report: { ...prior.result.report, reused: true } }, {
            fetch: reusedNote,
            repair: reusedNote,
            build: reusedNote,
            aifill: prior.steps.find((s) => s.name === 'aifill')?.detail ?? 'Skipped',
            deploy: 'Already published',
          });
          return;
        }
      }

      const siteId = newSiteId();
      const r = await rebuild(loc, { ...pipeline, outDirName: siteId, limits: this.limits, onStep, ...(this.o.llm ? { llm: this.o.llm } : {}) });
      let siteUrl = this.siteUrlFor(siteId);
      let deployDetail = 'Served from this server';
      if (this.o.deployer) {
        this.setStep(jobId, 'deploy');
        siteUrl = (await this.o.deployer.deploy(siteId, r.outDir)).url;
        deployDetail = 'Published';
      }
      this.finish(
        jobId,
        siteId,
        {
          siteUrl,
          beforeUrl: r.beforeUrl,
          downloadUrl: '', // zip download arrives with task 4.6
          lostNote: r.lostNote,
          lostNoteIsAi: r.lostNoteAi,
          report: {
            pagesFound: r.pagesFound,
            pagesRecovered: r.pagesRecovered,
            assetsFound: r.assetsFound,
            assetsRecovered: r.assetsRecovered,
            aiRestoredItems: r.aiRestoredItems,
            aiSkipped: r.aiSkipped,
            ...(r.aiNote ? { aiNote: r.aiNote } : {}),
            formsDisabled: r.formsDisabled,
            lostPages: r.lostPages,
            lostAssets: r.lostAssets,
          },
        },
        {
          fetch: `${r.pagesRecovered} of ${r.pagesFound} pages, ${r.assetsRecovered} of ${r.assetsFound} images and files`,
          repair: `${r.lostPages.length} lost links marked, ${r.formsDisabled} forms switched off`,
          aifill: r.aiSkipped
            ? r.aiNote || 'Skipped: no gaps AI could help with'
            : `${r.aiRestoredItems} AI-restored item${r.aiRestoredItems === 1 ? '' : 's'}, all marked${r.lostNoteAi ? ', plus the lost note' : ''}`,
          deploy: deployDetail,
        },
      );
    } catch (e) {
      const cur = store.get(jobId)!;
      const steps: StepInfo[] = cur.steps.map((s) => (s.state === 'active' ? { ...s, state: 'failed' } : s));
      this.o.log?.('job failed', { jobId, step: cur.step, error: e instanceof Error ? e.message : String(e) });
      store.update(jobId, { status: 'failed', steps, error: toApiError(e) });
    }
  }
}
