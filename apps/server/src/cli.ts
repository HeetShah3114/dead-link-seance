// Usage: npm run resurrect -- http://example.com/
import { WaybackClient } from './wayback/client.js';
import { DiskCache } from './wayback/cache.js';
import { resurrect, PipelineError } from './pipeline/resurrect.js';
import { loadLimits } from './config.js';

const url = process.argv[2];
if (!url) {
  console.error('Usage: npm run resurrect -- <url>');
  process.exit(2);
}

const client = new WaybackClient({
  userAgent: 'DeadLinkSeance/0.1 (+https://github.com/HeetShah3114/dead-link-seance)',
});

try {
  const r = await resurrect(url, {
    client,
    cache: new DiskCache('data/cache'),
    outRoot: 'out',
    limits: loadLimits(),
    onStep: (step, detail) => process.stderr.write(`\r${step}${detail ? `: ${detail}` : ''}`.padEnd(90)),
  });
  process.stderr.write('\n');
  console.log(`Snapshot:  ${r.snapshotDate} (${r.beforeUrl})`);
  console.log(`Pages:     ${r.pagesRecovered} of ${r.pagesFound} recovered, ${r.lostPages.length} lost links marked`);
  console.log(`Assets:    ${r.assetsRecovered} of ${r.assetsFound} downloaded, ${r.lostAssets.length} lost`);
  console.log(`Cleaned:   ${r.scriptsRemoved} scripts removed, ${r.formsDisabled} forms switched off`);
  console.log(`Written:   ${r.indexPath} (${Math.round(r.bytes / 1024)} KB)`);
} catch (e) {
  if (e instanceof PipelineError) {
    console.error(`\n${e.code}: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
