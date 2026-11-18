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
  /** Forms switched off because their server is gone. */
  formsDisabled: number;
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

  // Forms: the server behind them is gone. Show them, switch them off, and say so. (R5.7)
  const forms = $('form');
  const formsDisabled = forms.length;
  forms.each((_, el) => {
    const form = $(el);
    form.removeAttr('action').removeAttr('method').removeAttr('target').attr('data-seance-dead-form', '');
    form.find('input, button, select, textarea').attr('disabled', 'disabled');
    form.prepend(
      '<p class="seance-dead-form-note" style="all:initial;display:block;font:13px/1.4 system-ui,sans-serif;color:#5b21b6;background:#f3e8ff;border:1px dashed #8b5cf6;padding:4px 8px;margin:4px 0">This form no longer works. The server behind it is gone.</p>',
    );
  });

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

  // Output is always written as UTF-8, so say so.
  $('meta[charset], meta[http-equiv]').filter((_, el) => {
    const m = $(el);
    return m.attr('charset') !== undefined || /content-type/i.test(m.attr('http-equiv') ?? '');
  }).remove();
  $('head').prepend('<meta charset="utf-8">');

  return { html: $.html(), assets: [...assets], scriptsRemoved, formsDisabled };
}
