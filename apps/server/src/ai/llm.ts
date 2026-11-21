// One door to the language model (task 3.1, R6.6). Swappable: the pipeline only sees `Llm`.
import { createHash } from 'node:crypto';
import type { DiskCache } from '../wayback/cache.js';

export interface LlmRequest {
  system: string;
  user: string;
  /** JSON Schema the answer must follow. */
  schema: Record<string, unknown>;
  maxTokens: number;
}

export interface Llm {
  readonly model: string;
  /** Returns parsed JSON. Throws LlmError on any failure; callers must handle it. */
  json(req: LlmRequest): Promise<unknown>;
}

export class LlmError extends Error {
  constructor(
    public readonly kind: 'timeout' | 'rate_limited' | 'budget' | 'bad_output' | 'http' | 'config',
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** Hard caps on what we send, whatever the caller asks. */
export const MAX_INPUT_CHARS = 16_000;
export const MAX_OUTPUT_TOKENS = 800;

export interface WorkersAiOptions {
  accountId: string;
  /** Workers AI API token. From env only, never in code or logs. */
  token: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Cloudflare Workers AI over its REST API, with JSON mode. */
export class WorkersAiLlm implements Llm {
  readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly o: WorkersAiOptions) {
    if (!/^[0-9a-f]{32}$/.test(o.accountId)) throw new LlmError('config', 'Invalid Cloudflare account id');
    if (!o.token) throw new LlmError('config', 'Missing Workers AI token');
    this.model = o.model ?? DEFAULT_MODEL;
    if (!/^@(cf|hf)\/[\w.-]+\/[\w.-]+$/.test(this.model)) throw new LlmError('config', 'Invalid model name');
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  async json(req: LlmRequest): Promise<unknown> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.o.accountId}/ai/run/${this.model}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.o.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: req.system.slice(0, MAX_INPUT_CHARS) },
            { role: 'user', content: req.user.slice(0, MAX_INPUT_CHARS) },
          ],
          max_tokens: Math.min(req.maxTokens, MAX_OUTPUT_TOKENS),
          temperature: 0.2,
          response_format: { type: 'json_schema', json_schema: req.schema },
        }),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 30_000),
        redirect: 'error',
      });
    } catch (e) {
      throw new LlmError('timeout', e instanceof Error ? e.name : 'request failed');
    }
    if (res.status === 429) throw new LlmError('rate_limited', 'Workers AI rate limit or daily allowance used up');
    if (!res.ok) throw new LlmError('http', `Workers AI HTTP ${res.status}`);
    const body = (await res.json().catch(() => null)) as { success?: boolean; result?: { response?: unknown } } | null;
    const out = body?.result?.response;
    if (!body?.success || out === undefined) throw new LlmError('bad_output', 'Workers AI returned no response');
    if (typeof out === 'string') {
      try {
        return JSON.parse(out);
      } catch {
        throw new LlmError('bad_output', 'Workers AI returned text, not JSON');
      }
    }
    return out;
  }
}

/** Remembers answers on disk, so a rebuild or a demo rerun costs nothing. */
export class CachedLlm implements Llm {
  constructor(
    private readonly inner: Llm,
    private readonly cache: DiskCache,
  ) {}

  get model(): string {
    return this.inner.model;
  }

  async json(req: LlmRequest): Promise<unknown> {
    const key = createHash('sha256').update(JSON.stringify([this.model, req])).digest('hex');
    const hit = await this.cache.get(key);
    if (hit) return JSON.parse(hit.body.toString('utf8'));
    const out = await this.inner.json(req);
    await this.cache.put(key, { status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(out)) });
    return out;
  }
}

/** Caps model calls per UTC day, to stay inside the free allowance. Cached answers do not count. */
export class BudgetedLlm implements Llm {
  private day = '';
  private used = 0;

  constructor(
    private readonly inner: Llm,
    private readonly perDay: number,
    private readonly now: () => number = Date.now,
  ) {}

  get model(): string {
    return this.inner.model;
  }

  async json(req: LlmRequest): Promise<unknown> {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
    if (this.used >= this.perDay) throw new LlmError('budget', 'Daily AI budget used up');
    this.used++;
    return this.inner.json(req);
  }
}
