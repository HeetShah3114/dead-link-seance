import path from 'node:path';
import type { WaybackClient } from '../wayback/client.js';
import type { DiskCache } from '../wayback/cache.js';
import { fetchRaw } from '../wayback/fetch-page.js';
import { formatDate, viewUrl } from '../wayback/snapshot.js';
import { repairV0 } from '../repair/repair.js';
import { buildSiteV0 } from '../build/build.js';
import { decodeHtml } from './decode.js';

export class PipelineError extends Error {
  constructor(
    public code: 'INVALID_URL' | 'NO_SNAPSHOT' | 'UNSUPPORTED_TARGET',
    message: string,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

export interface ResurrectResult {
  outDir: string;
  indexPath: string;
  snapshotTimestamp: string;
  snapshotDate: string;
  beforeUrl: string;
  assets: number;
  scriptsRemoved: number;
  formsDisabled: number;
}

export interface ResurrectDeps {
  client: Pick<WaybackClient, 'get' | 'findBestSnapshot'>;
  cache: DiskCache;
  /** Folder that will hold one subfolder per resurrection. */
  outRoot: string;
  /** Subfolder name. Default: slug of the URL plus the snapshot timestamp. */
  outDirName?: string;
  /** Progress callback, called as each step starts and when the snapshot is known. */
  onStep?: (step: 'lookup' | 'fetch' | 'repair' | 'build', detail?: string) => void;
  onSnapshot?: (snap: { timestamp: string; date: string; archiveUrl: string }) => void;
}

function slug(url: URL): string {
  return (url.hostname + url.pathname).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'site';
}

/** Pipeline v0 (task 1.5): lookup, fetch, repair, build for ONE page. */
export async function resurrectV0(input: string, deps: ResurrectDeps): Promise<ResurrectResult> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new PipelineError('INVALID_URL', 'Not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PipelineError('INVALID_URL', 'Only http and https URLs can be summoned');
  }

  deps.onStep?.('lookup');
  const snap = await deps.client.findBestSnapshot(url.href);
  if (!snap) throw new PipelineError('NO_SNAPSHOT', 'No archived copy found');
  deps.onSnapshot?.({
    timestamp: snap.timestamp,
    date: formatDate(snap.timestamp),
    archiveUrl: viewUrl(snap.timestamp, snap.original),
  });

  deps.onStep?.('fetch', `Snapshot ${formatDate(snap.timestamp)}`);
  const page = await fetchRaw(deps.client, deps.cache, snap.timestamp, snap.original);
  if (page.status !== 200 || !/html/i.test(page.contentType)) {
    throw new PipelineError('UNSUPPORTED_TARGET', `Snapshot is not an HTML page (status ${page.status}, ${page.contentType})`);
  }

  deps.onStep?.('repair');
  const repaired = repairV0(decodeHtml(page.contentType, page.body), {
    pageUrl: snap.original,
    timestamp: snap.timestamp,
  });

  deps.onStep?.('build');
  const outDir = path.join(deps.outRoot, deps.outDirName ?? `${slug(url)}-${snap.timestamp}`);
  const { indexPath } = await buildSiteV0({
    html: repaired.html,
    outDir,
    pageUrl: snap.original,
    timestamp: snap.timestamp,
  });

  return {
    outDir,
    indexPath,
    snapshotTimestamp: snap.timestamp,
    snapshotDate: formatDate(snap.timestamp),
    beforeUrl: viewUrl(snap.timestamp, snap.original),
    assets: repaired.assets.length,
    scriptsRemoved: repaired.scriptsRemoved,
    formsDisabled: repaired.formsDisabled,
  };
}
