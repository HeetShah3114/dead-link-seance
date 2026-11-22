import { useEffect, useState } from 'react';
import type { Example } from '@seance/shared';
import './examples.css';

interface Props {
  /** Put an example's address in the box, ready to summon. */
  onPick: (url: string) => void;
  disabled: boolean;
}

/** Pre-summoned demo sites. Hidden when there are none or the call fails. (task 4.5) */
export function Examples({ onPick, disabled }: Props) {
  const [list, setList] = useState<Example[]>([]);
  useEffect(() => {
    let alive = true;
    fetch('/api/examples')
      .then((r) => (r.ok ? r.json() : []))
      .then((x: unknown) => alive && Array.isArray(x) && setList(x as Example[]))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (list.length === 0) return null;
  return (
    <section className="examples" aria-labelledby="examples-title">
      <h2 id="examples-title">Spirits already summoned</h2>
      <ul>
        {list.map((e) => (
          <li key={e.siteUrl}>
            <strong>{e.title}</strong>
            <span className="examples-meta">
              {e.blurb ? `${e.blurb} \u00b7 ` : ''}
              {e.snapshotDate}
            </span>
            <span className="examples-actions">
              <a href={e.siteUrl} target="_blank" rel="noreferrer">
                See it
              </a>
              <button type="button" disabled={disabled} onClick={() => onPick(e.url)}>
                Summon it yourself
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
