import { useEffect, useRef, useState } from 'react';
import type { JobView } from '@seance/shared';
import { absoluteUrl, reportLines } from './report';
import './reveal.css';

type View = 'both' | 'before' | 'after';

interface Props {
  job: JobView;
  onAgain: () => void;
}

const NARROW = '(max-width: 720px)';
const SHOW_AFTER_MS = 2500;

/** The before/after reveal: archive snapshot beside the resurrected site, plus share link and report. (R9.3, R9.4) */
export function Reveal({ job, onAgain }: Props) {
  const r = job.result!;
  const shareUrl = absoluteUrl(r.siteUrl, window.location.origin);
  const [view, setView] = useState<View>(() => (window.matchMedia?.(NARROW).matches ? 'after' : 'both'));
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the result so keyboard and screen reader users land on it.
  useEffect(() => headingRef.current?.focus(), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied('done');
    } catch {
      inputRef.current?.select();
      setCopied('failed');
    }
  }

  const lost = r.report.lostPages.length;
  return (
    <section className="reveal" aria-labelledby="reveal-title">
      <h2 id="reveal-title" tabIndex={-1} ref={headingRef}>
        It lives
      </h2>
      <p className="reveal-sub">Rebuilt from the Wayback Machine snapshot taken on {job.snapshot?.date}.</p>

      <div className="reveal-share">
        <label htmlFor="share-url">Share link</label>
        <div className="reveal-share-row">
          <input id="share-url" ref={inputRef} readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" onClick={copy}>
            {copied === 'done' ? 'Copied' : 'Copy link'}
          </button>
          <a className="button-link" href={shareUrl} target="_blank" rel="noreferrer">
            Open site
          </a>
        </div>
        <p className="reveal-status" role="status">
          {copied === 'done' ? 'Link copied.' : copied === 'failed' ? 'Could not copy. The link is selected: press Ctrl+C.' : ''}
        </p>
      </div>

      <div className="reveal-tabs" role="group" aria-label="Compare">
        {(['both', 'before', 'after'] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={v === 'both' ? 'reveal-tab-both' : undefined}>
            {v === 'both' ? 'Side by side' : v === 'before' ? 'Before: the archive' : 'After: resurrected'}
          </button>
        ))}
      </div>

      <div className="reveal-panes" data-view={view}>
        <Pane
          className="reveal-before"
          label="Before"
          sub="the raw archive snapshot"
          title="Before: the archived snapshot on the Wayback Machine"
          src={r.beforeUrl}
          waiting="The archive is slow to wake…"
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
        <Pane
          className="reveal-after"
          label="After"
          sub="the resurrected site"
          title="After: the resurrected site"
          src={shareUrl}
          waiting="The spirit is taking shape…"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
        />
      </div>

      <div className="reveal-report">
        <h3>What came back</h3>
        <dl>
          {reportLines(r).map((l) => (
            <div key={l.label}>
              <dt>{l.label}</dt>
              <dd>{l.value}</dd>
            </div>
          ))}
        </dl>
        {r.report.aiNote && <p className="reveal-muted">{r.report.aiNote}</p>}
      </div>

      <div className="reveal-lost">
        <h3>What was lost</h3>
        <p className={r.lostNoteIsAi ? 'ai-note' : undefined}>
          {r.lostNoteIsAi && <span className="ai-tag">AI-worded</span>}
          {r.lostNote}
        </p>
        {lost > 0 && (
          <details>
            <summary>
              {lost} lost page{lost === 1 ? '' : 's'}
            </summary>
            <ul>
              {r.report.lostPages.slice(0, 50).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <button type="button" className="reveal-again" onClick={onAgain}>
        Summon another
      </button>
    </section>
  );
}

interface PaneProps {
  className: string;
  label: string;
  sub: string;
  title: string;
  src: string;
  waiting: string;
  sandbox: string;
}

/** One side of the comparison. Shows a waiting line until the frame loads, and a plain link out. */
function Pane({ className, label, sub, title, src, waiting, sandbox }: PaneProps) {
  const [loaded, setLoaded] = useState(false);
  // "load" waits for every image, and archive images can take a long time.
  // Show the page after a short wait anyway, so the text is readable while images arrive.
  useEffect(() => {
    const t = window.setTimeout(() => setLoaded(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <figure className={`reveal-pane ${className}`}>
      <figcaption>
        {label} <span>{sub}</span>{' '}
        <a href={src} target="_blank" rel="noreferrer" className="reveal-pane-open">
          Open in new tab
        </a>
      </figcaption>
      <div className="reveal-frame" data-loaded={loaded || undefined}>
        <p className="reveal-waiting" aria-hidden={loaded}>
          {waiting}
        </p>
        <iframe title={title} src={src} referrerPolicy="no-referrer" sandbox={sandbox} onLoad={() => setLoaded(true)} />
      </div>
    </figure>
  );
}
