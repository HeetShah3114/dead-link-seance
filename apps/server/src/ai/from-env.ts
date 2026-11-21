import path from 'node:path';
import { DiskCache } from '../wayback/cache.js';
import { BudgetedLlm, CachedLlm, WorkersAiLlm, type Llm } from './llm.js';

/**
 * Builds the AI from env, or returns undefined (AI off) when it is not configured.
 * CF_ACCOUNT_ID and CF_AI_TOKEN come from env or apps/server/.env, never from code. (R6, tech.md)
 */
export function llmFromEnv(dataDir: string, perDay: number): Llm | undefined {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_AI_TOKEN;
  if (!accountId || !token) return undefined;
  const base = new WorkersAiLlm({ accountId, token, ...(process.env.CF_AI_MODEL ? { model: process.env.CF_AI_MODEL } : {}) });
  // Cache outside the budget: repeat answers are free and never count.
  return new CachedLlm(new BudgetedLlm(base, perDay), new DiskCache(path.join(dataDir, 'ai-cache')));
}
