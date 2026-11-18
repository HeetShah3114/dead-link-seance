import * as cheerio from 'cheerio';
import { rawUrl } from '../wayback/snapshot.js';

export interface RepairOptions {
  /** URL the page was originally served from. Used to resolve relative links. */
  pageUrl: string;
  /** 14-digit snapshot timestamp. Assets are pointed at archived copies from this moment. */
  timestamp: string;
}

export interface RepairResult {
  html: string;
  /** Distinct asset URLs rewritten to archived copies. */
  assets: string[];
  scriptsRemoved: number;
}

/** Elements dropped entirely: they run code or embed other sites. (R5.5) */
const DROP = 'script, iframe, frame, frameset, object, embed, applet, base';

/** [selector, attribute] pairs that hold an asset URL. */
const ASSET_ATTRS: Array<[string, string]> = [
  ['img', 'src'],
  ['img', 'lowsrc'],
  ['source', 'src'],
  ['audio', 'src'],
  ['video', 'src'],
  ['video', 'poster'],
  ['input[type=image]', 'src'],
  ['body', 'background'],
  ['table', 'background'],
  ['td', 'background'],
  ['th', 'background'],
  ['link[rel~=stylesheet]', 'href'],
  ['link[rel~=icon]', 'href'],
];

const WAYBACK_HOST = /^https?:\/\/web\.archive\.org\//i;

function resolve(value: string, base: string): string | null {
  const v = value.trim();
  if (!v || v.startsWith('#') || /^(data|javascript|mailto|about|blob):/i.test(v)) return null;
  try {
    const u = new URL(v, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Repair v0 (task 1.3): strip code, point assets at archived copies.
 * Links between pages, asset download and placeholders come later (task 2.2).
 */
export function repairV0(html: string, opts: RepairOptions): RepairResult {
  const $ = cheerio.load(html);
  const assets = new Set<string>();

  const scriptsRemoved = $('script').length;
  $(DROP).remove();

  // Inline handlers and javascript: URLs
  $('*').each((_, el) => {
    if (el.type !== 'tag') return;
    for (const name of Object.keys(el.attribs)) {
      const val = el.attribs[name] ?? '';
      if (/^on/i.test(name) || (/^(href|src|action|background|poster)$/i.test(name) && /^\s*javascript:/i.test(val))) {
        $(el).removeAttr(name);
      }
    }
  });

  for (const [selector, attr] of ASSET_ATTRS) {
    $(selector).each((_, el) => {
      const val = $(el).attr(attr);
      if (val === undefined) return;
      if (WAYBACK_HOST.test(val)) return; // already an archive URL
      const abs = resolve(val, opts.pageUrl);
      if (!abs) return;
      assets.add(abs);
      $(el).attr(attr, rawUrl(opts.timestamp, abs));
    });
  }

  return { html: $.html(), assets: [...assets], scriptsRemoved };
}
