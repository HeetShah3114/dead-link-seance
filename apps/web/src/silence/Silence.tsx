import { useEffect, useRef } from 'react';
import type { ApiError } from '@seance/shared';
import { hintFor } from './hints';
import './silence.css';

interface Props {
  error: ApiError;
  /** Set when the job failed after the site was built (R10.4). */
  downloadUrl?: string;
  onRetry: () => void;
  onEdit: () => void;
}

const REPORT_URL = 'https://github.com/HeetShah3114/dead-link-seance/issues';

/** The "silence" screen: themed line, the plain reason, and what to do next. (R10) */
export function Silence({ error, downloadUrl, onRetry, onEdit }: Props) {
  const hint = hintFor(error.code);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), [error.code]);

  return (
    <section className="silence" role="alert" aria-labelledby="silence-title" data-code={error.code}>
      <h2 id="silence-title" tabIndex={-1} ref={headingRef}>
        {error.spooky || hint.title}
      </h2>
      <p className="silence-plain">{error.message}</p>
      <p className="silence-next">{hint.next}</p>
      <div className="silence-actions">
        {hint.retry && (
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        )}
        {hint.editUrl && (
          <button type="button" onClick={onEdit}>
            Change the address
          </button>
        )}
        {downloadUrl && (
          <a className="button-link" href={downloadUrl}>
            Download the rebuilt site
          </a>
        )}
        {error.code === 'INTERNAL' && (
          <a href={REPORT_URL} target="_blank" rel="noreferrer">
            Report a problem
          </a>
        )}
      </div>
      <p className="silence-code">Code: {error.code}</p>
    </section>
  );
}
