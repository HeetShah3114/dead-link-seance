import type { WaybackClient } from './client.js';
import { DiskCache, type CachedBody } from './cache.js';
import { rawUrl } from './snapshot.js';

export interface FetchedPage extends CachedBody {
  fromCache: boolean;
}

/**
 * Fetch the raw original page (id_ form: no toolbar, no rewritten links) for one snapshot.
 * Cached by url + timestamp, so a repeat summon makes no archive request. (R3.1, R4.3)
 */
export async function fetchRaw(
  client: Pick<WaybackClient, 'get'>,
  cache: DiskCache,
  timestamp: string,
  original: string,
): Promise<FetchedPage> {
  const key = DiskCache.key(timestamp, original);
  const hit = await cache.get(key);
  if (hit) return { ...hit, fromCache: true };

  const res = await client.get(rawUrl(timestamp, original));
  const value: CachedBody = {
    status: res.status,
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    body: Buffer.from(await res.arrayBuffer()),
  };
  await cache.put(key, value);
  return { ...value, fromCache: false };
}
