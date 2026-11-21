import { describe, it, expect } from 'vitest';
import type { JobView } from '@seance/shared';
import { scenePhase } from './phase';

const job = (status: JobView['status'], step: JobView['step'] = 'lookup'): JobView => ({
  jobId: 'j',
  status,
  step,
  steps: [],
  snapshot: null,
  result: null,
  error: null,
});

describe('scenePhase', () => {
  it('follows the real job, never ahead of it', () => {
    expect(scenePhase({ starting: false, job: null, failed: false })).toBe('idle');
    expect(scenePhase({ starting: true, job: null, failed: false })).toBe('lookup');
    expect(scenePhase({ starting: false, job: job('queued'), failed: false })).toBe('lookup');
    expect(scenePhase({ starting: false, job: job('running', 'aifill'), failed: false })).toBe('aifill');
    expect(scenePhase({ starting: false, job: job('done', 'deploy'), failed: false })).toBe('done');
    expect(scenePhase({ starting: false, job: job('failed', 'fetch'), failed: false })).toBe('failed');
    expect(scenePhase({ starting: false, job: null, failed: true })).toBe('failed');
  });
});
