import { useEffect, useRef, useState } from 'react';
import type { ApiError, JobView } from '@seance/shared';
import { ApiCallError, getJob, startSummons } from './api';
import { describeStep } from './labels';

const POLL_MS = 1500;

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'running'; jobId: string; job: JobView | null }
  | { kind: 'done'; job: JobView }
  | { kind: 'failed'; error: ApiError; job?: JobView };

export function App() {
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const timer = useRef<number | undefined>(undefined);

  // Poll the job until it is done or failed.
  useEffect(() => {
    if (phase.kind !== 'running') return;
    const { jobId } = phase;
    let stopped = false;

    const tick = async () => {
      try {
        const job = await getJob(jobId);
        if (stopped) return;
        if (job.status === 'done') return setPhase({ kind: 'done', job });
        if (job.status === 'failed' && job.error) return setPhase({ kind: 'failed', error: job.error, job });
        setPhase({ kind: 'running', jobId, job });
      } catch (e) {
        if (stopped) return;
        if (e instanceof ApiCallError) return setPhase({ kind: 'failed', error: e.apiError });
      }
      timer.current = window.setTimeout(tick, POLL_MS);
    };

    timer.current = window.setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer.current);
    };
    // Only restart polling when the job id changes, not on every status update.
  }, [phase.kind === 'running' ? phase.jobId : null]);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setPhase({ kind: 'starting' });
    try {
      const { jobId } = await startSummons(url.trim());
      setPhase({ kind: 'running', jobId, job: null });
    } catch (e) {
      if (e instanceof ApiCallError) setPhase({ kind: 'failed', error: e.apiError });
    }
  }

  const busy = phase.kind === 'starting' || phase.kind === 'running';
  const job = phase.kind === 'running' ? phase.job : phase.kind === 'done' || phase.kind === 'failed' ? phase.job : undefined;

  return (
    <main>
      <h1>Dead Link Séance</h1>
      <p>Paste the address of a dead website. We will ask the Internet Archive for its last saved copy and rebuild it.</p>

      <form onSubmit={onSubmit}>
        <label htmlFor="url">Address of the dead site</label>
        <input
          id="url"
          type="url"
          required
          placeholder="http://www.geocities.com/Hollywood/Hills/"
          value={url}
          disabled={busy}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit" disabled={busy || url.trim() === ''}>
          {busy ? 'Summoning…' : 'Summon'}
        </button>
      </form>

      {job && (
        <ol aria-label="Progress">
          {job.steps.map((s) => {
            const d = describeStep(s);
            return (
              <li key={s.name} data-state={s.state}>
                <strong>{d.title}</strong> <span>({d.plain})</span>: {d.state}
                {d.detail ? ` \u2013 ${d.detail}` : ''}
              </li>
            );
          })}
        </ol>
      )}

      {phase.kind === 'failed' && (
        <section role="alert" className="error">
          <h2>{phase.error.spooky}</h2>
          <p>{phase.error.message}</p>
        </section>
      )}

      {phase.kind === 'done' && phase.job.result && (
        <section className="result">
          <h2>It lives</h2>
          <p>
            Rebuilt from the {phase.job.snapshot?.date} snapshot.{' '}
            <a href={phase.job.result.siteUrl} target="_blank" rel="noreferrer">
              Open the resurrected site
            </a>
          </p>
          <p>
            <a href={phase.job.result.beforeUrl} target="_blank" rel="noreferrer">
              See the original archive snapshot
            </a>
          </p>
          <p>
            Found {phase.job.result.report.assetsFound} images and files. Page links, asset checks and AI repairs are not built yet.
          </p>
        </section>
      )}
    </main>
  );
}
