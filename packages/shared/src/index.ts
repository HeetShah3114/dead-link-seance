// API contract types. Source of truth: .kiro/specs/resurrection-mvp/design.md section 5.

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type StepName = 'lookup' | 'fetch' | 'repair' | 'aifill' | 'build' | 'deploy';
export type StepState = 'done' | 'active' | 'pending' | 'failed';

export type ErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_TARGET'
  | 'NO_SNAPSHOT'
  | 'ARCHIVE_TIMEOUT'
  | 'ARCHIVE_RATE_LIMITED'
  | 'RATE_LIMITED'
  | 'JOB_ACTIVE'
  | 'DEPLOY_FAILED'
  | 'INTERNAL';

export interface ApiError {
  code: ErrorCode;
  message: string;
  spooky: string;
}

export interface SummonRequest {
  url: string;
}

export interface SummonResponse {
  jobId: string;
}

export interface StepInfo {
  name: StepName;
  state: StepState;
  detail?: string;
}

export interface SnapshotInfo {
  timestamp: string;
  date: string;
  archiveUrl: string;
}

export interface Report {
  pagesFound: number;
  pagesRecovered: number;
  assetsFound: number;
  assetsRecovered: number;
  aiRestoredItems: number;
  aiSkipped: boolean;
  /** Forms switched off because their server is gone. (R5.7) */
  formsDisabled: number;
  lostPages: string[];
  lostAssets: string[];
  /** True when an earlier build of the same url + snapshot was reused. (R8.3) */
  reused?: boolean;
}

export interface JobResult {
  siteUrl: string;
  beforeUrl: string;
  downloadUrl: string;
  lostNote: string;
  report: Report;
}

export interface JobView {
  jobId: string;
  status: JobStatus;
  step: StepName;
  steps: StepInfo[];
  snapshot: SnapshotInfo | null;
  result: JobResult | null;
  error: ApiError | null;
}
