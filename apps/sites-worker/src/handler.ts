// Serves resurrected sites from R2 at /sites/<siteId>/<path>.
// Pure request -> response logic, kept free of runtime globals so it can be unit tested in Node.

/** The slice of the R2 binding this Worker uses. */
export interface SiteObject {
  body: ReadableStream | null;
  httpEtag: string;
  httpMetadata?: { contentType?: string; cacheControl?: string };
}
export interface SiteBucket {
  get(key: string): Promise<SiteObject | null>;
}

/**
 * Resurrected pages must never run scripts, even if sanitizing missed something (R11.3).
 * No frame-ancestors / X-Frame-Options: the reveal screen shows sites in an iframe.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': "script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
};

const SITE_ID = /^[a-z0-9]{12}$/;

/** Map a URL path to an R2 key, or null if it is not a valid site path. */
export function keyFor(pathname: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const m = /^\/sites\/([^/]+)(\/.*)?$/.exec(path);
  if (!m) return null;
  const [, siteId, restRaw] = m;
  if (!siteId || !SITE_ID.test(siteId)) return null;
  let rest = restRaw ?? '/';
  if (rest.endsWith('/')) rest += 'index.html';
  const parts = rest.split('/').filter(Boolean);
  // No dot segments, no backslashes, no empty names: keys stay inside sites/<id>/.
  if (parts.some((p) => p === '.' || p === '..' || p.includes('\\'))) return null;
  return `sites/${siteId}/${parts.join('/')}`;
}

function notFound(): Response {
  return new Response('Not found. This page was not recovered.', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS },
  });
}

export async function handle(request: Request, bucket: SiteBucket): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD', ...SECURITY_HEADERS } });
  }
  const url = new URL(request.url);

  // /sites/<id> without a trailing slash: redirect so relative links resolve.
  if (/^\/sites\/[a-z0-9]{12}$/.test(url.pathname)) {
    return new Response(null, { status: 301, headers: { location: `${url.pathname}/`, ...SECURITY_HEADERS } });
  }

  const key = keyFor(url.pathname);
  if (!key) return notFound();

  const obj = await bucket.get(key);
  if (!obj) return notFound();

  const headers = new Headers(SECURITY_HEADERS);
  headers.set('content-type', obj.httpMetadata?.contentType ?? 'application/octet-stream');
  headers.set('cache-control', obj.httpMetadata?.cacheControl ?? 'public, max-age=3600');
  headers.set('etag', obj.httpEtag);
  return new Response(request.method === 'HEAD' ? null : obj.body, { status: 200, headers });
}
