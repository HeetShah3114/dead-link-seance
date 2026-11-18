// Manual smoke test against the real Wayback Machine. Usage:
//   npx tsx apps/server/scripts/smoke-wayback.ts http://example.com/
import { WaybackClient } from '../src/wayback/client.js';
import { DiskCache } from '../src/wayback/cache.js';
import { fetchRaw } from '../src/wayback/fetch-page.js';
import { formatDate } from '../src/wayback/snapshot.js';

const url = process.argv[2] ?? 'http://example.com/';
const client = new WaybackClient({
  userAgent: 'DeadLinkSeance/0.1 (+https://github.com/HeetShah3114/dead-link-seance)',
});
const cache = new DiskCache('data/cache');

const snap = await client.findBestSnapshot(url);
if (!snap) {
  console.log('No snapshot found.');
  process.exit(0);
}
console.log(`Snapshot ${snap.timestamp} (${formatDate(snap.timestamp)}) of ${snap.original}`);
for (let i = 1; i <= 2; i++) {
  const page = await fetchRaw(client, cache, snap.timestamp, snap.original);
  console.log(`fetch ${i}: status=${page.status} type=${page.contentType} bytes=${page.body.length} fromCache=${page.fromCache}`);
}
