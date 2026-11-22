import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type { ApiError, JobResult, JobStatus, SnapshotInfo, StepInfo, StepName } from '@seance/shared';

export const STEP_ORDER: StepName[] = ['lookup', 'fetch', 'repair', 'aifill', 'build', 'deploy'];

export interface JobRow {
  id: string;
  status: JobStatus;
  step: StepName;
  steps: StepInfo[];
  inputUrl: string;
  snapshot: SnapshotInfo | null;
  siteId: string | null;
  result: JobResult | null;
  error: ApiError | null;
  clientHash: string;
  createdAt: number;
  updatedAt: number;
}

export function openDb(file: string): Database {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      step TEXT NOT NULL,
      steps_json TEXT NOT NULL,
      input_url TEXT NOT NULL,
      snapshot_json TEXT,
      site_id TEXT,
      result_json TEXT,
      error_json TEXT,
      client_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_client ON jobs (client_hash, status);
  `);
  return db;
}

type Raw = {
  id: string;
  status: string;
  step: string;
  steps_json: string;
  input_url: string;
  snapshot_json: string | null;
  site_id: string | null;
  result_json: string | null;
  error_json: string | null;
  client_hash: string;
  created_at: number;
  updated_at: number;
};

function fromRaw(r: Raw): JobRow {
  return {
    id: r.id,
    status: r.status as JobStatus,
    step: r.step as StepName,
    steps: JSON.parse(r.steps_json) as StepInfo[],
    inputUrl: r.input_url,
    snapshot: r.snapshot_json ? (JSON.parse(r.snapshot_json) as SnapshotInfo) : null,
    siteId: r.site_id,
    result: r.result_json ? (JSON.parse(r.result_json) as JobResult) : null,
    error: r.error_json ? (JSON.parse(r.error_json) as ApiError) : null,
    clientHash: r.client_hash,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export type JobPatch = Partial<Pick<JobRow, 'status' | 'step' | 'steps' | 'snapshot' | 'siteId' | 'result' | 'error'>>;

export class JobStore {
  constructor(private readonly db: Database) {}

  create(inputUrl: string, clientHash: string): JobRow {
    const id = `j_${randomBytes(6).toString('hex')}`;
    const steps: StepInfo[] = STEP_ORDER.map((name) => ({ name, state: 'pending' }));
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO jobs (id, status, step, steps_json, input_url, client_hash, created_at, updated_at)
         VALUES (?, 'queued', 'lookup', ?, ?, ?, ?, ?)`,
      )
      .run(id, JSON.stringify(steps), inputUrl, clientHash, now, now);
    return this.get(id)!;
  }

  get(id: string): JobRow | null {
    const r = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Raw | undefined;
    return r ? fromRaw(r) : null;
  }

  /** Jobs this client started since `sinceMs`. Used for the per-client limit. (R11.1) */
  countSince(clientHash: string, sinceMs: number): number {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE client_hash = ? AND created_at >= ?').get(clientHash, sinceMs) as { n: number };
    return r.n;
  }

  /** Whether this client has a job queued or running. (R1.4) */
  hasActive(clientHash: string): boolean {
    return this.db.prepare("SELECT 1 FROM jobs WHERE client_hash = ? AND status IN ('queued', 'running') LIMIT 1").get(clientHash) !== undefined;
  }

  /** Newest finished job for the same url + snapshot, younger than `sinceMs`. (R8.3) */
  findReusable(inputUrl: string, timestamp: string, sinceMs: number): JobRow | null {
    const rows = this.db
      .prepare("SELECT * FROM jobs WHERE input_url = ? AND status = 'done' AND created_at >= ? ORDER BY created_at DESC LIMIT 20")
      .all(inputUrl, sinceMs) as Raw[];
    for (const r of rows) {
      const job = fromRaw(r);
      if (job.snapshot?.timestamp === timestamp && job.result && job.siteId) return job;
    }
    return null;
  }

  /** Takedown: every job that produced this site now reports it removed, and is never reused. */
  markRemoved(siteId: string, error: ApiError): number {
    return this.db
      .prepare("UPDATE jobs SET status = 'failed', result_json = NULL, error_json = ?, updated_at = ? WHERE site_id = ?")
      .run(JSON.stringify(error), Date.now(), siteId).changes;
  }

  update(id: string, patch: JobPatch): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    const add = (col: string, v: unknown) => {
      sets.push(`${col} = ?`);
      vals.push(v);
    };
    if (patch.status !== undefined) add('status', patch.status);
    if (patch.step !== undefined) add('step', patch.step);
    if (patch.steps !== undefined) add('steps_json', JSON.stringify(patch.steps));
    if (patch.snapshot !== undefined) add('snapshot_json', patch.snapshot ? JSON.stringify(patch.snapshot) : null);
    if (patch.siteId !== undefined) add('site_id', patch.siteId);
    if (patch.result !== undefined) add('result_json', patch.result ? JSON.stringify(patch.result) : null);
    if (patch.error !== undefined) add('error_json', patch.error ? JSON.stringify(patch.error) : null);
    add('updated_at', Date.now());
    this.db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  }
}
