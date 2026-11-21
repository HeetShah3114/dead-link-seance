// The resurrection pipeline: lookup, crawl, assets, repair, build. (R2, R3, R5, R7)
import path from 'node:path';
import type { WaybackClient } from '../wayback/client.js';
import type { DiskCache } from '../wayback/cache.js';
import { formatDate, viewUrl, type Snapshot } from '../wayback/snapshot.js';
import { collectAssets, repairPage } from '../repair/repair.js';
import { buildSite } from '../build/build.js';
import { checkTargetUrl } from '../safety/url-guard.js';
import { crawl, StartPageError, type SkippedPage } from '../crawl/crawler.js';
import { fetchAssets } from '../crawl/assets.js';
import { pageKey } from '../site/paths.js';
import { DEFAULT_LIMITS, type Limits } from '../config.js';

export class PipelineError extends Error {
  constructor(
    public code: 'INVALID_URL' | 'NO_SNAPSHOT' | 'UNSUPPORTED_TARGET',
    message: string,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

export type PipelineStep = 'lookup' | 'fetch' | 'repair' | 'build';

export interface ResurrectDeps {
  client: Pick<WaybackClient, 'get' | 'findBestSnapshot'>;
  cache: DiskCache;
  /** Folder that will hold one subfolder per resurrection. */
  outRoot: string;
  /** Subfolder name. Default: slug of the URL plus the snapshot timestamp. */
  outDirName?: string;
  limits?: Partial<Limits>;
  /** Progress callback, called as each step starts and as it moves. */
  onStep?: (step: PipelineStep, detail?: string) => void;
}

export interface Located {
  url: URL;
  snap: Snapshot;
  snapshot: { timestamp: string; date: string; archiveUrl: string };
}

export interface ResurrectResult {
  outDir: string;
  indexPath: string;
  snapshotTimestamp: string;
  snapshotDate: string;
  beforeUrl: string;
  pagesFound: number;
  pagesRecovered: number;
  skippedPages: SkippedPage[];
  assetsFound: number;
  assetsRecovered: number;
  lostPages: string[];
  lostAssets: string[];
  scriptsRemoved: number;
  formsDisabled: number;
  bytes: number;
}

function slug(url: URL): string {
  return (url.hostname + url.pathname).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'site';
}

/** Step 1: check the target and find its best snapshot. */
export async function locate(input: string, deps: Pick<ResurrectDeps, 'client' | 'onStep'>): Promise<Located> {
  // Checked again here so the CLI and any future caller get the same guard as the API. (R11.2)
  const guard = checkTargetUrl(input);
  if (!guard.ok) throw new PipelineError('INVALID_URL', `Target refused: ${guard.reason}`);
  const url = guard.url;
  deps.onStep?.('lookup');
  const snap = await deps.client.findBestSnapshot(url.href);
  if (!snap) throw new PipelineError('NO_SNAPSHOT', 'No archived copy found');
  return {
    url,
    snap,
    snapshot: { timestamp: snap.timestamp, date: formatDate(snap.timestamp), archiveUrl: viewUrl(snap.timestamp, snap.original) },
  };
}

/** Steps 2 to 5: crawl, fetch assets, repair, build. */
export async function rebuild(loc: Located, deps: ResurrectDeps): Promise<ResurrectResult> {
  const limits = { ...DEFAULT_LIMITS, ...deps.limits };
  const { snap, url } = loc;
  const ts = snap.timestamp;
  const start = new URL(snap.original);

  deps.onStep?.('fetch', `Snapshot ${formatDate(ts)}`);
  let crawled;
  try {
    crawled = await crawl(start, ts, deps, {
      maxPages: limits.maxPages,
      maxDepth: limits.maxDepth,
      maxPageBytes: limits.maxPageBytes,
      onPage: (n) => deps.onStep?.('fetch', `Snapshot ${formatDate(ts)} \u00b7 ${n} page${n === 1 ? '' : 's'} recovered`),
    });
  } catch (e) {
    if (e instanceof StartPageError) {
      throw new PipelineError('UNSUPPORTED_TARGET', e.message);
    }
    throw e;
  }

  const assetUrls = [...new Set(crawled.pages.flatMap((p) => collectAssets(p.html, p.url.href)))];
  const pageBytes = crawled.pages.reduce((n, p) => n + Buffer.byteLength(p.html), 0);
  const assets = await fetchAssets(assetUrls, ts, deps, {
    maxAssets: limits.maxAssets,
    maxAssetBytes: limits.maxAssetBytes,
    maxSiteBytes: limits.maxSiteBytes,
    usedBytes: pageBytes,
    onAsset: (done, total) => deps.onStep?.('fetch', `Snapshot ${formatDate(ts)} \u00b7 ${crawled.pages.length} pages \u00b7 images ${done}/${total}`),
  });

  deps.onStep?.('repair');
  const byKey = new Map(crawled.pages.map((p) => [p.key, p.path]));
  const lostPages = new Set<string>();
  const lostAssets = new Set<string>();
  let scriptsRemoved = 0;
  let formsDisabled = 0;
  const pages = crawled.pages.map((p) => {
    const r = repairPage(p.html, {
      pageUrl: p.url.href,
      siteUrl: start.href,
      timestamp: ts,
      fromPath: p.path,
      resolvePage: (u) => {
        const hit = byKey.get(pageKey(u));
        return hit ? { kind: 'page', path: hit } : { kind: 'lost' };
      },
      resolveAsset: (u) => assets.targets.get(u) ?? { kind: 'remote' },
    });
    r.lostPages.forEach((x) => lostPages.add(x));
    r.lostAssets.forEach((x) => lostAssets.add(x));
    scriptsRemoved += r.scriptsRemoved;
    formsDisabled += r.formsDisabled;
    return { path: p.path, html: r.html, pageUrl: p.url.href };
  });

  deps.onStep?.('build');
  const outDir = path.join(deps.outRoot, deps.outDirName ?? `${slug(url)}-${ts}`);
  const built = await buildSite({ outDir, timestamp: ts, pages, assets: assets.files });

  return {
    outDir,
    indexPath: built.indexPath,
    snapshotTimestamp: ts,
    snapshotDate: formatDate(ts),
    beforeUrl: viewUrl(ts, snap.original),
    pagesFound: crawled.found,
    pagesRecovered: crawled.pages.length,
    skippedPages: crawled.skipped,
    assetsFound: assetUrls.length,
    assetsRecovered: assets.recovered,
    lostPages: [...lostPages],
    lostAssets: [...lostAssets],
    scriptsRemoved,
    formsDisabled,
    bytes: built.bytes,
  };
}

/** The whole pipeline, for the CLI and tests. */
export async function resurrect(input: string, deps: ResurrectDeps): Promise<ResurrectResult> {
  return rebuild(await locate(input, deps), deps);
}
