import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { resolveInside, serveWeb } from './web.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'seance-web-'));
  await writeFile(path.join(dir, 'index.html'), '<html>ui</html>');
  await mkdir(path.join(dir, 'assets'));
  await writeFile(path.join(dir, 'assets', 'app-1a2b.js'), 'console.log(1)');
  await mkdir(path.join(dir, 'art'));
  await writeFile(path.join(dir, 'art', 'room.png'), 'PNG');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function app() {
  const a = Fastify({ logger: false });
  a.get('/api/ping', async () => ({ ok: true }));
  expect(serveWeb(a, dir)).toBe(true);
  return a;
}

describe('serveWeb', () => {
  it('serves the page, assets and art with the right types and caching', async () => {
    const a = app();
    const home = await a.inject({ method: 'GET', url: '/' });
    expect(home.body).toBe('<html>ui</html>');
    expect(home.headers['cache-control']).toBe('no-cache');
    const js = await a.inject({ method: 'GET', url: '/assets/app-1a2b.js' });
    expect(js.headers['content-type']).toContain('text/javascript');
    expect(js.headers['cache-control']).toContain('immutable');
    expect((await a.inject({ method: 'GET', url: '/art/room.png' })).headers['content-type']).toBe('image/png');
  });

  it('keeps API routes working and never answers unknown /api paths with the page', async () => {
    const a = app();
    expect((await a.inject({ method: 'GET', url: '/api/ping' })).json()).toEqual({ ok: true });
    expect((await a.inject({ method: 'GET', url: '/api/nope' })).statusCode).toBe(404);
  });

  it('falls back to the page for app paths, 404s missing files', async () => {
    const a = app();
    expect((await a.inject({ method: 'GET', url: '/some/page?x=1' })).body).toBe('<html>ui</html>');
    expect((await a.inject({ method: 'GET', url: '/missing.png' })).statusCode).toBe(404);
  });

  it('never leaves the dist folder', async () => {
    const a = app();
    for (const u of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/%2e%2e/%2e%2e/x.js']) {
      const r = await a.inject({ method: 'GET', url: u });
      expect(r.body, u).not.toContain('secret');
    }
    expect(resolveInside(dir, '/../x')).toBeNull();
    expect(resolveInside(dir, '/%2e%2e%2fx')).toBeNull();
    expect(resolveInside(dir, '/a%00b')).toBeNull();
  });

  it('does nothing when there is no built UI', () => {
    expect(serveWeb(Fastify({ logger: false }), path.join(dir, 'nope'))).toBe(false);
  });
});
