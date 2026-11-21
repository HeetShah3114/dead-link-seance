// Checks the Workers AI setup with one tiny JSON-mode call. Prints no secrets.
// Usage (from apps/server): npx tsx scripts/ai-ping.ts
import { WorkersAiLlm, LlmError } from '../src/ai/llm.js';

try {
  process.loadEnvFile('.env');
} catch {
  /* env only */
}
const accountId = process.env.CF_ACCOUNT_ID ?? '';
const token = process.env.CF_AI_TOKEN ?? '';
try {
  const llm = new WorkersAiLlm({ accountId, token, ...(process.env.CF_AI_MODEL ? { model: process.env.CF_AI_MODEL } : {}) });
  const t = Date.now();
  const out = await llm.json({
    system: 'Answer in JSON only.',
    user: 'Return {"ok": true, "word": "boo"}.',
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, word: { type: 'string' } }, required: ['ok', 'word'] },
    maxTokens: 30,
  });
  console.log(`model ${llm.model} answered in ${Date.now() - t} ms:`, JSON.stringify(out));
} catch (e) {
  console.log(e instanceof LlmError ? `LlmError ${e.kind}: ${e.message}` : `Error: ${(e as Error).message}`);
  process.exit(1);
}
