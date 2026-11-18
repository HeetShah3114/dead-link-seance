// Usage: npm run resurrect -- http://example.com/
import { WaybackClient } from './wayback/client.js';
import { DiskCache } from './wayback/cache.js';
import { resurrectV0, PipelineError } from './pipeline/resurrect.js';

const url = process.argv[2];
if (!url) {
  console.error('Usage: npm run resurrect -- <url>');
  process.exit(2);
}

const client = new WaybackClient({
  userAgent: 'DeadLinkSeance/0.1 (+https://github.com/HeetShah3114/dead-link-seance)',
});

try {
  const r = await resurrectV0(url, {
    client,
    cache: new DiskCache('data/cache'),
    outRoot: 'out',
  });
  console.log(`Snapshot:  ${r.snapshotDate} (${r.beforeUrl})`);
  console.log(`Assets:    ${r.assets} pointed at archived copies, ${r.scriptsRemoved} scripts removed`);
  console.log(`Written:   ${r.indexPath}`);
} catch (e) {
  if (e instanceof PipelineError) {
    console.error(`${e.code}: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
