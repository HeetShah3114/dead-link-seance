// Pure helpers for Wayback snapshots. No network here. (R2)

export interface Snapshot {
  /** 14-digit Wayback timestamp, e.g. 20030412101500 */
  timestamp: string;
  /** Original URL that was archived */
  original: string;
  mimetype: string;
  statuscode: string;
  /** Stored size in bytes, when the archive reports it. Used to prefer fuller pages. */
  length?: number;
}

const CDX_FIELDS = ['timestamp', 'original', 'mimetype', 'statuscode'] as const;

export const CDX_FL = [...CDX_FIELDS, 'length'].join(',');

/** Parse CDX `output=json` (first row is the header). Skips malformed rows. */
export function parseCdx(body: unknown): Snapshot[] {
  if (!Array.isArray(body) || body.length < 2) return [];
  const header = body[0];
  if (!Array.isArray(header)) return [];
  const idx = CDX_FIELDS.map((f) => header.indexOf(f));
  if (idx.some((i) => i < 0)) return [];
  const lengthIdx = header.indexOf('length');
  const out: Snapshot[] = [];
  for (const row of body.slice(1)) {
    if (!Array.isArray(row)) continue;
    const [timestamp, original, mimetype, statuscode] = idx.map((i) => row[i]);
    if (
      typeof timestamp === 'string' &&
      /^\d{14}$/.test(timestamp) &&
      typeof original === 'string' &&
      typeof mimetype === 'string' &&
      typeof statuscode === 'string'
    ) {
      const len = lengthIdx >= 0 ? Number(row[lengthIdx]) : NaN;
      out.push(Number.isFinite(len) && len > 0 ? { timestamp, original, mimetype, statuscode, length: len } : { timestamp, original, mimetype, statuscode });
    }
  }
  return out;
}

/** Candidates at least this fraction of the biggest page count as "full". */
export const FULLNESS = 0.6;

/**
 * Pick the best snapshot (R2.2): among HTTP 200 HTML copies, keep the "full" ones
 * (size >= FULLNESS of the largest, when sizes are known), then take the newest of those.
 * This avoids picking a late "site is closed" or parked-domain page over the real site.
 */
export function pickBest(snapshots: Snapshot[]): Snapshot | null {
  const ok = snapshots.filter(
    (s) => s.statuscode === '200' && /^text\/html\b|^application\/xhtml\+xml\b/i.test(s.mimetype),
  );
  if (ok.length === 0) return null;
  const sizes = ok.map((s) => s.length ?? 0);
  const biggest = Math.max(...sizes);
  const full = biggest > 0 ? ok.filter((s) => (s.length ?? 0) >= biggest * FULLNESS) : ok;
  return full.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
}

/** Raw original HTML, no toolbar, no rewritten links. (R3.1) */
export function rawUrl(timestamp: string, original: string): string {
  return `https://web.archive.org/web/${timestamp}id_/${original}`;
}

/** Normal archive page, with toolbar. Used for credit links and the "before" view. (R7) */
export function viewUrl(timestamp: string, original: string): string {
  return `https://web.archive.org/web/${timestamp}/${original}`;
}

/** 20030412101500 -> 2003-04-12 */
export function formatDate(timestamp: string): string {
  return `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
}
