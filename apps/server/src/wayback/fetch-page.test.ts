import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DiskCache } from './cache.js';
import { fetchRaw } from './fetch-page.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'seance-cache-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeClient(res: () => Response) {
  const urls: string[] = [];
  return {
    urls,
    client: {
      get: async (url: string) => {
        urls.push(url);
        return res();
      },
    },
  };
}

describe('fetchRaw', () => {
  it('fetches the id_ url and returns body, status and type', async () => {
    const cache = new DiskCache(dir);
    const { client, urls } = fakeClient(
      () => new Response('<html>hi</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    const page = await fetchRaw(client, cache, '20030412101500', 'http://a.com/');
    expect(urls).toEqual(['https://web.archive.org/web/20030412101500id_/http://a.com/']);
    expect(page.status).toBe(200);
    expect(page.contentType).toBe('text/html');
    expect(page.body.toString()).toBe('<html>hi</html>');
    expect(page.fromCache).toBe(false);
  });

  it('serves a repeat request from cache with no archive call', async () => {
    const cache = new DiskCache(dir);
    const { client, urls } = fakeClient(() => new Response('x', { status: 200 }));
    await fetchRaw(client, cache, '20030412101500', 'http://a.com/');
    const again = await fetchRaw(client, cache, '20030412101500', 'http://a.com/');
    expect(again.fromCache).toBe(true);
    expect(again.body.toString()).toBe('x');
    expect(urls).toHaveLength(1);
  });

  it('keeps different snapshots and urls apart', async () => {
    const cache = new DiskCache(dir);
    const { client, urls } = fakeClient(() => new Response('x', { status: 200 }));
    await fetchRaw(client, cache, '20030412101500', 'http://a.com/');
    await fetchRaw(client, cache, '20040412101500', 'http://a.com/');
    await fetchRaw(client, cache, '20030412101500', 'http://a.com/b');
    expect(urls).toHaveLength(3);
  });

  it('caches a 404 so a missing page is not asked for twice', async () => {
    const cache = new DiskCache(dir);
    const { client, urls } = fakeClient(() => new Response('nope', { status: 404 }));
    const first = await fetchRaw(client, cache, '20030412101500', 'http://a.com/gone');
    const second = await fetchRaw(client, cache, '20030412101500', 'http://a.com/gone');
    expect(first.status).toBe(404);
    expect(second.fromCache).toBe(true);
    expect(urls).toHaveLength(1);
  });
});
