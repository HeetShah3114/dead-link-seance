// Task 5.1: resurrect the demo sites once, publish them under pinned/ (never expires),
// and write examples.json for GET /api/examples. Rerun any time; archive and AI answers are cached.
// Usage (from apps/server, with .env set up): npx tsx scripts/pin-examples.ts
import { writeFile } from 'node:fs/promises';
import { S3Client } from '@aws-sdk/client-s3';
import type { Example } from '@seance/shared';
import { WaybackClient } from '../src/wayback/client.js';
import { DiskCache } from '../src/wayback/cache.js';
import { resurrect } from '../src/pipeline/resurrect.js';
import { S3Deployer } from '../src/deploy/s3.js';
import { loadLimits } from '../src/config.js';
import { llmFromEnv } from '../src/ai/from-env.js';

/** Edit this list to change the demo sites. Blurbs must be plain facts about the page. */
const DEMOS: Array<{ url: string; title: string; blurb: string; siteId: string }> = [
  { url: 'http://www.geocities.com/Hollywood/Hills/2000/', title: 'A Hollywood Hills home page', blurb: 'Personal GeoCities page', siteId: 'demohills200' },
  { url: 'http://www.geocities.com/SiliconValley/Lakes/', title: 'Silicon Valley: Lakes', blurb: 'GeoCities neighborhood page', siteId: 'demosvlakes0' },
  { url: 'http://www.geocities.com/Hollywood/Hills/', title: 'Hollywood: Hills', blurb: 'GeoCities neighborhood page', siteId: 'demohillshub' },
];

try {
  process.loadEnvFile('.env');
} catch {
  /* env only */
}
const { DEPLOY_BUCKET, DEPLOY_BASE_URL, DEPLOY_S3_ENDPOINT } = process.env;
if (!DEPLOY_BUCKET || !DEPLOY_BASE_URL || !DEPLOY_S3_ENDPOINT) {
  console.log('Set DEPLOY_BUCKET, DEPLOY_BASE_URL and DEPLOY_S3_ENDPOINT (see .env.example).');
  process.exit(1);
}
const deployer = new S3Deployer({
  bucket: DEPLOY_BUCKET,
  baseUrl: DEPLOY_BASE_URL,
  prefix: 'pinned',
  s3: new S3Client({ endpoint: DEPLOY_S3_ENDPOINT, region: 'auto', forcePathStyle: true }),
});
const limits = { ...loadLimits(), maxPages: 8 };
const llm = llmFromEnv('data', limits.aiCallsPerDay);
const client = new WaybackClient({ userAgent: 'DeadLinkSeance/0.1 (+https://github.com/HeetShah3114/dead-link-seance)' });

const out: Example[] = [];
for (const d of DEMOS) {
  try {
    const r = await resurrect(d.url, { client, cache: new DiskCache('data/cache'), outRoot: 'out/pinned', outDirName: d.siteId, limits, ...(llm ? { llm } : {}) });
    const { url } = await deployer.deploy(d.siteId, r.outDir);
    out.push({ url: d.url, title: d.title, blurb: d.blurb, siteUrl: url, snapshotDate: r.snapshotDate });
    console.log(`pinned ${d.url} -> ${url} (${r.pagesRecovered}/${r.pagesFound} pages, ${r.assetsRecovered}/${r.assetsFound} images, AI ${r.aiRestoredItems})`);
  } catch (e) {
    console.log(`FAILED ${d.url}: ${(e as Error).message}`);
  }
}
await writeFile('examples.json', `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote examples.json with ${out.length} example(s)`);
