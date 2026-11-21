// Task 3.7: run real sites with AI on and print every AI text beside its source, for a human check.
// Usage (from apps/server): npx tsx scripts/ai-eval.ts <url> [<url> ...]
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { WaybackClient } from '../src/wayback/client.js';
import { DiskCache } from '../src/wayback/cache.js';
import { resurrect } from '../src/pipeline/resurrect.js';
import { loadLimits } from '../src/config.js';
import { llmFromEnv } from '../src/ai/from-env.js';

try {
  process.loadEnvFile('.env');
} catch {
  /* env only */
}
const limits = { ...loadLimits(), maxPages: 5, maxAssets: 25 };
const llm = llmFromEnv('data', limits.aiCallsPerDay);
if (!llm) {
  console.log('AI is not configured (CF_ACCOUNT_ID / CF_AI_TOKEN).');
  process.exit(1);
}
const client = new WaybackClient({ userAgent: 'DeadLinkSeance/0.1 (+https://github.com/HeetShah3114/dead-link-seance)' });

for (const url of process.argv.slice(2)) {
  console.log(`\n=== ${url}`);
  try {
    const r = await resurrect(url, { client, cache: new DiskCache('data/cache'), outRoot: 'out/eval', limits, llm });
    console.log(`snapshot ${r.snapshotDate} | pages ${r.pagesRecovered}/${r.pagesFound} | images ${r.assetsRecovered}/${r.assetsFound} | AI items ${r.aiRestoredItems} | AI note: ${r.lostNoteAi} | ${r.aiNote || 'no AI warnings'}`);
    const files = (await readdir(r.outDir, { recursive: true })).filter((f) => String(f).endsWith('.html') && !String(f).includes('_lost'));
    for (const f of files) {
      const $ = cheerio.load(await readFile(path.join(r.outDir, String(f)), 'utf8'));
      $('.ai-restored[data-seance-ai=image-caption]').each((_, el) => {
        const box = $(el).closest('[data-seance-missing]');
        const file = (box.attr('data-seance-src') ?? '').split('/').pop();
        console.log(`  [${f}] alt="${box.attr('data-seance-alt') ?? ''}" file="${file}"\n      -> ${$(el).text()}`);
      });
    }
    console.log(`  LOST NOTE${r.lostNoteAi ? ' (AI-worded)' : ' (plain)'}: ${r.lostNote}`);
  } catch (e) {
    console.log(`  failed: ${(e as Error).message}`);
  }
}
