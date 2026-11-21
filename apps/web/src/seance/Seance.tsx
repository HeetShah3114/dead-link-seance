import { useState } from 'react';
import './seance.css';

/** Scene phase. Each one waits for the real pipeline step (no fake progress). */
export type ScenePhase = 'idle' | 'lookup' | 'fetch' | 'repair' | 'aifill' | 'build' | 'deploy' | 'done' | 'failed';

interface Props {
  phase: ScenePhase;
  /** The dead address being summoned, shown on the floating link card. */
  deadUrl?: string;
  /** The new site link, shown rising out of the CRT when done. */
  newUrl?: string;
}

/** Five points of the star, as % of the circle box, for the candles. */
const STAR_POINTS: Array<[number, number]> = [
  [50, 2],
  [97, 36],
  [79, 94],
  [21, 94],
  [3, 36],
];

/** Where the vampires stand, as % of the stage. Back row is smaller and darker. */
const VAMPIRES: Array<{ left: number; bottom: number; h: number; flip: boolean; delay: number; back: boolean }> = [
  { left: 30, bottom: 30, h: 26, flip: false, delay: 0, back: true },
  { left: 62, bottom: 30, h: 26, flip: true, delay: 0.3, back: true },
  { left: 18, bottom: 6, h: 36, flip: false, delay: 0.15, back: false },
  { left: 74, bottom: 6, h: 36, flip: true, delay: 0.45, back: false },
];

function host(url?: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return (u.host + u.pathname).replace(/\/$/, '');
  } catch {
    return url;
  }
}

export function Seance({ phase, deadUrl, newUrl }: Props) {
  const [paused, setPaused] = useState(false);
  const active = phase !== 'idle' && phase !== 'done' && phase !== 'failed';
  return (
    <figure className="seance" data-phase={phase} data-paused={paused || undefined}>
      <div className="seance-stage" aria-hidden="true">
        <div className="seance-moonlight" />

        <div className="seance-circle">
          <svg viewBox="0 0 100 100" className="seance-star" preserveAspectRatio="none">
            <circle cx="50" cy="50" r="48" />
            <circle cx="50" cy="50" r="40" />
            <polygon points="50,10 85.6,77.6 12,35.2 88,35.2 14.4,77.6" />
          </svg>
          <div className="seance-runes" />
          {STAR_POINTS.map(([x, y], i) => (
            <span key={i} className="seance-candle" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 0.17}s` }}>
              <span className="seance-flame" style={{ animationDelay: `${i * 0.23}s` }} />
            </span>
          ))}
        </div>

        {VAMPIRES.map((v, i) => (
          <span
            key={i}
            className={`seance-vampire${v.back ? ' is-back' : ''}${v.flip ? ' is-flip' : ''}`}
            style={{ left: `${v.left}%`, bottom: `${v.bottom}%`, height: `${v.h}%`, animationDelay: `${v.delay}s` }}
          />
        ))}

        {deadUrl && phase !== 'idle' && (
          <div className="seance-card seance-dead">
            <span className="seance-card-bar" />
            <span className="seance-card-text">{host(deadUrl)}</span>
            <span className="seance-card-404">404</span>
          </div>
        )}

        <div className="seance-crt" />
        {phase === 'done' && newUrl && (
          <div className="seance-card seance-new">
            <span className="seance-card-bar" />
            <span className="seance-card-text">{host(newUrl)}</span>
          </div>
        )}

        <div className="seance-flash" />
      </div>

      {active && (
        <button type="button" className="seance-pause" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
          {paused ? 'Resume animation' : 'Pause animation'}
        </button>
      )}
    </figure>
  );
}
