// Download a site's assets from the archive, within limits (task 2.2, R5.3, R5.4).
import type { WaybackClient } from '../wayback/client.js';
import { WaybackError } from '../wayback/client.js';
import type { DiskCache } from '../wayback/cache.js';
import { fetchRaw } from '../wayback/fetch-page.js';
import { assetPath } from '../site/paths.js';
import type { AssetTarget } from '../repair/repair.js';

export interface LocalAsset {
  path: string;
  body: Buffer;
}

export interface AssetResult {
  targets: Map<string, AssetTarget>;
  files: LocalAsset[];
  recovered: number;
  missing: number;
  /** Not downloaded (over a limit, or the archive was busy). Pointed at the archived copy instead. */
  remote: number;
}

export interface AssetOptions {
  maxAssets: number;
  maxAssetBytes: number;
  /** Byte budget for the whole site, pages included. */
  maxSiteBytes: number;
  /** Bytes already used by pages. */
  usedBytes: number;
  onAsset?: (done: number, total: number) => void;
}

/** The archive answers "not archived" with an HTML page. An image that comes back as HTML is lost. */
function looksWrong(url: string, contentType: string): boolean {
  const html = /text\/html/i.test(contentType);
  const wantsCss = /\.css(\?|$)/i.test(new URL(url).pathname);
  return html || (wantsCss && !/css|text\/plain/i.test(contentType));
}

export async function fetchAssets(
  urls: string[],
  timestamp: string,
  deps: { client: Pick<WaybackClient, 'get'>; cache: DiskCache },
  o: AssetOptions,
): Promise<AssetResult> {
  const targets = new Map<string, AssetTarget>();
  const files: LocalAsset[] = [];
  let used = o.usedBytes;
  let recovered = 0;
  let missing = 0;
  let remote = 0;
  let archiveBusy = false;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]!;
    if (i >= o.maxAssets || archiveBusy) {
      targets.set(url, { kind: 'remote' });
      remote++;
      continue;
    }
    try {
      const res = await fetchRaw(deps.client, deps.cache, timestamp, url);
      if (res.status !== 200 || res.body.length === 0 || looksWrong(url, res.contentType)) {
        targets.set(url, { kind: 'missing' });
        missing++;
      } else if (res.body.length > o.maxAssetBytes || used + res.body.length > o.maxSiteBytes) {
        targets.set(url, { kind: 'remote' });
        remote++;
      } else {
        const path = assetPath(url, res.contentType);
        files.push({ path, body: res.body });
        used += res.body.length;
        targets.set(url, { kind: 'local', path });
        recovered++;
      }
    } catch (e) {
      // Rate limit or timeout: stop downloading, keep the page working with archived links.
      if (e instanceof WaybackError) {
        archiveBusy = true;
        targets.set(url, { kind: 'remote' });
        remote++;
      } else {
        targets.set(url, { kind: 'missing' });
        missing++;
      }
    }
    o.onAsset?.(i + 1, urls.length);
  }
  return { targets, files, recovered, missing, remote };
}
