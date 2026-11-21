import type { JobView } from '@seance/shared';
import type { ScenePhase } from './Seance';

/** Map the real job to a scene phase. The scene never runs ahead of the pipeline. */
export function scenePhase(state: { starting: boolean; job: JobView | null | undefined; failed: boolean }): ScenePhase {
  if (state.failed || state.job?.status === 'failed') return 'failed';
  if (state.job?.status === 'done') return 'done';
  if (state.job && (state.job.status === 'running' || state.job.status === 'queued')) {
    return state.job.status === 'queued' ? 'lookup' : state.job.step;
  }
  if (state.starting) return 'lookup';
  return 'idle';
}
