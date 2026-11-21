// Usage: npm run resurrect -- http://example.com/
import { WaybackClient } from './wayback/client.js';
import { DiskCache } from './wayback/cache.js';
import { resurrect, PipelineError } from './pipeline/resurrect.js';
import { loadLimits } from './config.js';
import { llmFromEnv } from './ai/from-env.js';

const url = process.argv[2];
if (!url) {
  console.error('Usage: npm run resurrect -- <url>');
  process.exit(2);
}

const client = new WaybackClient({
  userAgent: 'DeadLinkSeance/0.1 (+https://github.com/HeetShah3114/dead-link-seance)',
});

try {
  process.loadEnvFile('.env');
} catch {
  /* no .env: AI stays off unless CF_ACCOUNT_ID and CF_AI_TOKEN are set */
}
const limits = loadLimits();
const llm = llmFromEnv('data', limits.aiCallsPerDay);

try {
  const r = await resurrect(url, {
    client,
    cache: new DiskCache('data/cache'),
    outRoot: 'out',
    limits,
    ...(llm ? { llm } : {}),
    onStep: (step, detail) => process.stderr.write(`\r${step}${detail ? `: ${detail}` : ''}`.padEnd(90)),
  });
  process.stderr.write('\n');
  console.log(`Snapshot:  ${r.snapshotDate} (${r.beforeUrl})`);
  console.log(`Pages:     ${r.pagesRecovered} of ${r.pagesFound} recovered, ${r.lostPages.length} lost links marked`);
  console.log(`Assets:    ${r.assetsRecovered} of ${r.assetsFound} downloaded, ${r.lostAssets.length} lost`);
  console.log(`Cleaned:   ${r.scriptsRemoved} scripts removed, ${r.formsDisabled} forms switched off, ${r.truncatedPages} cut-off pages marked`);
  console.log(`AI:        ${llm ? llm.model : 'off'} \u00b7 ${r.aiRestoredItems} restored items${r.lostNoteAi ? ' + AI lost note' : ''}${r.aiNote ? ` \u00b7 ${r.aiNote}` : ''}`);
  console.log(`Lost note: ${r.lostNote}`);
  console.log(`Written:   ${r.indexPath} (${Math.round(r.bytes / 1024)} KB)`);
} catch (e) {
  if (e instanceof PipelineError) {
    console.error(`\n${e.code}: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
