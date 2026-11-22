// Serves the built séance UI (apps/web/dist) from the API server, so one host runs both.
// Only used when the dist folder exists (production). In dev, Vite serves the UI.
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { mimeFor } from './mime.js';

const EXTRA_MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function typeFor(file: string): string {
  return EXTRA_MIME[path.extname(file).toLowerCase()] ?? mimeFor(file);
}

/** Map a request path to a file inside root, or null if it would leave root. */
export function resolveInside(root: string, urlPath: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  } catch {
    return null;
  }
  if (rel.includes('\0')) return null;
  const file = path.resolve(root, `.${rel.startsWith('/') ? rel : `/${rel}`}`);
  return file === root || file.startsWith(root + path.sep) ? file : null;
}

export function serveWeb(app: FastifyInstance, distDir: string): boolean {
  const root = path.resolve(distDir);
  const indexFile = path.join(root, 'index.html');
  if (!existsSync(indexFile)) return false;

  // Anything no other route matched: a UI file, or index.html for "/".
  app.setNotFoundHandler(async (req, reply) => {
    const urlPath = req.url.split('?')[0] ?? '/';
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply.code(404).send({ error: 'not found' });
    if (urlPath.startsWith('/api/') || urlPath.startsWith('/sites/')) return reply.code(404).send({ error: 'not found' });

    let file = resolveInside(root, urlPath);
    if (file) {
      try {
        if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      } catch {
        file = null;
      }
    }
    // Single page app: unknown paths get the page, missing files with an extension get 404.
    if (!file || !existsSync(file)) {
      if (path.extname(urlPath)) return reply.code(404).send({ error: 'not found' });
      file = indexFile;
    }
    const hashed = file.includes(`${path.sep}assets${path.sep}`);
    return reply
      .header('content-type', typeFor(file))
      .header('cache-control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache')
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'no-referrer')
      .send(await readFile(file));
  });
  return true;
}
