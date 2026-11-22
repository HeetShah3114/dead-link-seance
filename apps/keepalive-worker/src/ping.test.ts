import { describe, it, expect } from 'vitest';
import { checkTarget, ping } from './ping';

const fakeFetch = (res: () => Response | Promise<Response>) => (async () => res()) as unknown as typeof fetch;

describe('keepalive ping', () => {
  it('reports a healthy app', async () => {
    let t = 1000;
    const r = await ping('https://dead-link-seance.onrender.com/health', fakeFetch(() => { t += 250; return Response.json({ ok: true }); }), 20_000, () => t);
    expect(r).toEqual({ ok: true, status: 200, ms: 250 });
  });

  it('reports an error status and a failed fetch without throwing', async () => {
    expect((await ping('https://x.onrender.com/health', fakeFetch(() => new Response('', { status: 502 })))).status).toBe(502);
    const down = await ping('https://x.onrender.com/health', fakeFetch(() => Promise.reject(new Error('down'))));
    expect(down).toMatchObject({ ok: false, status: 0, error: 'Error' });
  });

  it('only pings https URLs', async () => {
    expect(checkTarget('http://x.onrender.com/health')).toBeNull();
    expect(checkTarget('https://user:pw@x.onrender.com/')).toBeNull();
    expect(checkTarget('nonsense')).toBeNull();
    expect((await ping('http://x.com/', fakeFetch(() => new Response('')))).ok).toBe(false);
  });
});
