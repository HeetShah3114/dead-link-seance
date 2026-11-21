import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DiskCache } from '../wayback/cache.js';
import { BudgetedLlm, CachedLlm, LlmError, WorkersAiLlm, MAX_OUTPUT_TOKENS, type Llm } from './llm.js';

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const req = { system: 'sys', user: 'hello', schema: { type: 'object' }, maxTokens: 5000 };

function fake(respond: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('WorkersAiLlm', () => {
  it('posts to the Workers AI run endpoint with JSON mode and capped tokens', async () => {
    const { calls, fetchImpl } = fake(() => Response.json({ success: true, result: { response: { ok: 1 } } }));
    const llm = new WorkersAiLlm({ accountId: ACCOUNT, token: 't0k', fetchImpl });
    expect(await llm.json(req)).toEqual({ ok: 1 });
    expect(calls[0]!.url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast`);
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer t0k');
  });

  it('parses a JSON string response', async () => {
    const { fetchImpl } = fake(() => Response.json({ success: true, result: { response: '{"a":2}' } }));
    expect(await new WorkersAiLlm({ accountId: ACCOUNT, token: 't', fetchImpl }).json(req)).toEqual({ a: 2 });
  });

  it('maps failures to LlmError kinds and never echoes the token', async () => {
    const cases: Array<[() => Response | Promise<Response>, string]> = [
      [() => new Response('', { status: 429 }), 'rate_limited'],
      [() => new Response('', { status: 500 }), 'http'],
      [() => Response.json({ success: true, result: { response: 'not json' } }), 'bad_output'],
      [() => Response.json({ success: false, errors: [{ message: 'x' }] }), 'bad_output'],
      [() => Promise.reject(new Error('net down')), 'timeout'],
    ];
    for (const [respond, kind] of cases) {
      const { fetchImpl } = fake(respond);
      const err = await new WorkersAiLlm({ accountId: ACCOUNT, token: 'SECRET-TOKEN', fetchImpl }).json(req).catch((e) => e);
      expect(err).toBeInstanceOf(LlmError);
      expect(err.kind).toBe(kind);
      expect(String(err.message)).not.toContain('SECRET-TOKEN');
    }
  });

  it('refuses bad config', () => {
    expect(() => new WorkersAiLlm({ accountId: 'nope', token: 't' })).toThrow(LlmError);
    expect(() => new WorkersAiLlm({ accountId: ACCOUNT, token: '' })).toThrow(LlmError);
    expect(() => new WorkersAiLlm({ accountId: ACCOUNT, token: 't', model: '../../x' })).toThrow(LlmError);
  });
});

describe('CachedLlm and BudgetedLlm', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'seance-llm-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const counting = (): Llm & { n: number } => ({
    model: 'm',
    n: 0,
    async json() {
      this.n++;
      return { n: this.n };
    },
  });

  it('answers repeats from cache', async () => {
    const inner = counting();
    const llm = new CachedLlm(inner, new DiskCache(dir));
    expect(await llm.json(req)).toEqual({ n: 1 });
    expect(await llm.json(req)).toEqual({ n: 1 });
    expect(inner.n).toBe(1);
  });

  it('stops after the daily budget and resets the next UTC day', async () => {
    let t = Date.UTC(2026, 10, 21, 23, 0);
    const llm = new BudgetedLlm(counting(), 2, () => t);
    await llm.json(req);
    await llm.json(req);
    await expect(llm.json(req)).rejects.toMatchObject({ kind: 'budget' });
    t = Date.UTC(2026, 10, 22, 0, 1);
    await expect(llm.json(req)).resolves.toBeDefined();
  });
});
