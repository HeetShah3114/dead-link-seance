import { describe, it, expect } from 'vitest';
import { buildApp } from './index.js';
import { DiskCache } from './wayback/cache.js';

describe('health', () => {
  it('returns ok', async () => {
    const { app } = buildApp({
      dbFile: ':memory:',
      logger: false,
      pipeline: {
        client: { get: async () => new Response(''), findBestSnapshot: async () => null },
        cache: new DiskCache('unused'),
        outRoot: 'unused',
      },
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
