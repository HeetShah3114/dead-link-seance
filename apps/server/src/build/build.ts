import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { injectBanner } from './banner.js';
import { sanitize } from '../sanitize/sanitize.js';
import { relPath } from '../site/paths.js';
import { formatDate, viewUrl } from '../wayback/snapshot.js';
import { AI_STYLE } from '../ai/patches.js';

export interface BuildPage {
  /** File in the site, e.g. index.html or p/x.html */
  path: string;
  /** Repaired HTML. */
  html: string;
  /** Original URL of this page, credited in its banner. (R7.4) */
  pageUrl: string;
}

export interface LostPageInfo {
  note: string;
  noteIsAi: boolean;
  aiNote: string;
  siteUrl: string;
  lostPages: string[];
  lostAssets: string[];
}

export interface BuildInput {
  outDir: string;
  timestamp: string;
  pages: BuildPage[];
  assets: Array<{ path: string; body: Buffer }>;
  /** When set, writes _lost.html and links it from every banner. (R6.4) */
  lost?: LostPageInfo;
  contactUrl?: string;
}

export const LOST_PAGE = '_lost.html';

function safeJoin(root: string, rel: string): string {
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error(`Refusing to write outside the site: ${rel}`);
  return full;
}

/** The "what was lost" page. Built from our own data; every value is inserted as text. */
export function lostPageHtml(info: LostPageInfo, timestamp: string): string {
  const $ = cheerio.load(
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>What was lost</title></head>' +
      '<body style="margin:0;background:#14101c;color:#f1e9ff;font:16px/1.6 system-ui,sans-serif"><main style="max-width:42rem;margin:0 auto;padding:2rem 1rem"></main></body></html>',
  );
  const main = $('main');
  main.append($('<h1></h1>').text('What was lost'));
  const note = $('<p></p>').text(info.note);
  if (info.noteIsAi) {
    note.attr('class', 'ai-restored').attr('data-seance-ai', 'lost-note').attr('style', `${AI_STYLE}display:block;font-size:16px;padding:8px`);
    main.append(note);
    main.append($('<p style="color:#cbbfe3;font-size:14px"></p>').text('This note was worded by AI from the facts below. The facts were checked; the wording is AI\u2019s.'));
  } else {
    main.append(note);
  }
  if (info.aiNote) main.append($('<p style="color:#cbbfe3;font-size:14px"></p>').text(info.aiNote));
  const list = (title: string, urls: string[]) => {
    if (urls.length === 0) return;
    main.append($('<h2></h2>').text(title));
    const ul = $('<ul></ul>');
    for (const u of urls.slice(0, 200)) {
      ul.append($('<li></li>').append($('<a style="color:#c4b5fd"></a>').attr('href', viewUrl(timestamp, u)).text(u)));
    }
    main.append(ul);
  };
  list('Pages the archive never saved', info.lostPages);
  list('Images and files that did not come back', info.lostAssets);
  main.append(
    $('<p style="color:#cbbfe3;font-size:14px"></p>').text(
      `Each link above tries the Wayback Machine again, in case a copy from another date exists. Snapshot: ${formatDate(timestamp)}.`,
    ),
  );
  main.append($('<p></p>').append($('<a style="color:#c4b5fd" href="index.html"></a>').text('Back to the resurrected site')));
  return $.html();
}

/** Write a site: every page sanitized, then bannered; assets as-is. (R6.4, R7, R8.1, R11.3) */
export async function buildSite(input: BuildInput): Promise<{ indexPath: string; bytes: number }> {
  const root = path.resolve(input.outDir);
  let bytes = 0;
  const pages: BuildPage[] = [...input.pages];
  if (input.lost) pages.push({ path: LOST_PAGE, html: lostPageHtml(input.lost, input.timestamp), pageUrl: input.lost.siteUrl });
  for (const p of pages) {
    const file = safeJoin(root, p.path);
    await mkdir(path.dirname(file), { recursive: true });
    const clean = sanitize(p.html);
    const html = injectBanner(clean, {
      pageUrl: p.pageUrl,
      timestamp: input.timestamp,
      ...(input.contactUrl ? { contactUrl: input.contactUrl } : {}),
      ...(input.lost && p.path !== LOST_PAGE ? { lostHref: relPath(p.path, LOST_PAGE) } : {}),
      aiLegend: clean.includes('ai-restored'),
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
