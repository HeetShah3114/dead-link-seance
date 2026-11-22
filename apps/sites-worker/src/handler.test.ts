import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { handle, keyFor, type SiteBucket, type SiteObject } from './handler';

const ID = 'abcdefabcdef';

function bucket(files: Record<string, { body: string; type?: string }>): SiteBucket & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async get(key: string): Promise<SiteObject | null> {
      asked.push(key);
      const f = files[key];
      if (!f) return null;
      return {
        body: new Response(f.body).body,
        httpEtag: '"e1"',
        httpMetadata: f.type ? { contentType: f.type } : {},
      };
    },
  };
}

const req = (path: string, method = 'GET') => new Request(`https://w.example${path}`, { method });

describe('keyFor', () => {
  it('maps folder urls to index.html', () => {
    expect(keyFor(`/sites/${ID}/`)).toBe(`sites/${ID}/index.html`);
    expect(keyFor(`/sites/${ID}/a/`)).toBe(`sites/${ID}/a/index.html`);
  });
  it('serves pinned demo sites from pinned/', () => {
    expect(keyFor(`/pinned/${ID}/`)).toBe(`pinned/${ID}/index.html`);
    expect(keyFor(`/other/${ID}/`)).toBeNull();
  });
  it('maps files directly', () => {
    expect(keyFor(`/sites/${ID}/img/a.gif`)).toBe(`sites/${ID}/img/a.gif`);
  });
  it('rejects bad ids, other paths and dot segments', () => {
    for (const p of ['/', '/sites/', '/sites/short/', `/x/${ID}/`, `/sites/${ID}/../x`, `/sites/${ID}/%2e%2e/x`, `/sites/${ID}/a\\b`]) {
      expect(keyFor(p)).toBeNull();
    }
  });
  it('property: any accepted key stays inside sites/<id>/', () => {
    fc.assert(
      fc.property(fc.string(), (tail) => {
        const k = keyFor(`/sites/${ID}/${tail}`);
        return k === null || (k.startsWith(`sites/${ID}/`) && !k.split('/').includes('..'));
      }),
    );
  });
});

describe('handle', () => {
  it('serves index.html with the no-scripts header', async () => {
    const b = bucket({ [`sites/${ID}/index.html`]: { body: '<h1>hi</h1>', type: 'text/html; charset=utf-8' } });
    const res = await handle(req(`/sites/${ID}/`), b);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('content-security-policy')).toContain("script-src 'none'");
    expect(res.headers.get('x-frame-options')).toBeNull();
    expect(await res.text()).toBe('<h1>hi</h1>');
  });

  it('redirects /sites/<id> to /sites/<id>/', async () => {
    const res = await handle(req(`/sites/${ID}`), bucket({}));
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`/sites/${ID}/`);
  });

  it('404s on missing files and bad paths without asking R2 for bad paths', async () => {
    const b = bucket({});
    expect((await handle(req(`/sites/${ID}/nope.html`), b)).status).toBe(404);
    expect((await handle(req('/sites/../secret'), b)).status).toBe(404);
    expect(b.asked).toEqual([`sites/${ID}/nope.html`]);
  });

  it('answers HEAD with no body and rejects other methods', async () => {
    const b = bucket({ [`sites/${ID}/index.html`]: { body: 'x', type: 'text/html' } });
    const head = await handle(req(`/sites/${ID}/`, 'HEAD'), b);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect((await handle(req(`/sites/${ID}/`, 'POST'), b)).status).toBe(405);
  });
});
