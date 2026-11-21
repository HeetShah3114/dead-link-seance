import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { injectBanner } from './banner.js';
import { sanitize } from '../sanitize/sanitize.js';

export interface BuildPage {
  /** File in the site, e.g. index.html or p/x.html */
  path: string;
  /** Repaired HTML. */
  html: string;
  /** Original URL of this page, credited in its banner. (R7.4) */
  pageUrl: string;
}

export interface BuildInput {
  outDir: string;
  timestamp: string;
  pages: BuildPage[];
  assets: Array<{ path: string; body: Buffer }>;
  contactUrl?: string;
}

function safeJoin(root: string, rel: string): string {
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error(`Refusing to write outside the site: ${rel}`);
  return full;
}

/** Write a site: every page sanitized, then bannered; assets as-is. (R7, R8.1, R11.3) */
export async function buildSite(input: BuildInput): Promise<{ indexPath: string; bytes: number }> {
  const root = path.resolve(input.outDir);
  let bytes = 0;
  for (const p of input.pages) {
    const file = safeJoin(root, p.path);
    await mkdir(path.dirname(file), { recursive: true });
    const html = injectBanner(sanitize(p.html), {
      pageUrl: p.pageUrl,
      timestamp: input.timestamp,
      ...(input.contactUrl ? { contactUrl: input.contactUrl } : {}),
    });
    await writeFile(file, html, 'utf8');
    bytes += Buffer.byteLength(html);
  }
  for (const a of input.assets) {
    const file = safeJoin(root, a.path);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, a.body);
    bytes += a.body.length;
  }
  return { indexPath: path.join(root, 'index.html'), bytes };
}
