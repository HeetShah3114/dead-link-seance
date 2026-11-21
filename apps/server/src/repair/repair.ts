// Page repair (tasks 1.3 and 2.2, R5): strip code, switch off forms, rewrite links and assets.
import * as cheerio from 'cheerio';
import { rawUrl, viewUrl } from '../wayback/snapshot.js';
import { inScope, relPath, resolveUrl } from '../site/paths.js';

/** Where a same-site page link should point. */
export type PageTarget = { kind: 'page'; path: string } | { kind: 'lost' };
/** What happened to an asset. */
export type AssetTarget = { kind: 'local'; path: string } | { kind: 'remote' } | { kind: 'missing' };

export interface RepairOptions {
  /** URL the page was originally served from. Used to resolve relative links. */
  pageUrl: string;
  /** Start URL of the site. Decides what counts as same-site. */
  siteUrl: string;
  /** 14-digit snapshot timestamp. */
  timestamp: string;
  /** This page's file in the output site, e.g. index.html or p/x.html */
  fromPath: string;
  resolvePage: (url: URL) => PageTarget;
  resolveAsset: (url: string) => AssetTarget;
}

export interface RepairResult {
  html: string;
  lostPages: string[];
  lostAssets: string[];
  scriptsRemoved: number;
  formsDisabled: number;
}

/** Elements dropped entirely: they run code or embed other sites. (R5.5) */
const DROP = 'script, noscript, iframe, frame, frameset, object, embed, applet, base';

/** [selector, attribute] pairs that hold an asset URL. */
export const ASSET_ATTRS: Array<[string, string]> = [
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
  ['tr', 'background'],
  ['link[rel~=stylesheet]', 'href'],
  ['link[rel~=icon]', 'href'],
];

/** Every asset URL a page refers to, resolved and de-duplicated. */
export function collectAssets(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const out = new Set<string>();
  for (const [selector, attr] of ASSET_ATTRS) {
    $(selector).each((_, el) => {
      const v = $(el).attr(attr);
      const u = v === undefined ? null : resolveUrl(v, pageUrl);
      if (u) out.add(u.href);
    });
  }
  return [...out];
}

const LOST_STYLE = 'text-decoration:line-through;cursor:help;';
const MISSING_STYLE =
  'display:inline-block;box-sizing:border-box;min-width:60px;min-height:30px;padding:2px 4px;' +
  'border:1px dashed #8b5cf6;background:#f3e8ff;color:#5b21b6;font:12px/1.3 system-ui,sans-serif;vertical-align:middle;overflow:hidden;';

function px(v: string | undefined, max: number): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : null;
}

export function repairPage(html: string, o: RepairOptions): RepairResult {
  const $ = cheerio.load(html);
  const site = new URL(o.siteUrl);
  const lostPages = new Set<string>();
  const lostAssets = new Set<string>();

  // Forms: the server behind them is gone. Show them, switch them off, and say so. (R5.7)
  let formsDisabled = 0;
  $('form').each((_, el) => {
    const form = $(el);
    if (form.attr('data-seance-dead-form') !== undefined) return;
    formsDisabled++;
    form.removeAttr('action').removeAttr('method').removeAttr('target').attr('data-seance-dead-form', '');
    form.find('input, button, select, textarea').attr('disabled', 'disabled');
    form.prepend(
      '<p class="seance-dead-form-note" style="all:initial;display:block;font:13px/1.4 system-ui,sans-serif;color:#5b21b6;background:#f3e8ff;border:1px dashed #8b5cf6;padding:4px 8px;margin:4px 0">This form no longer works. The server behind it is gone.</p>',
    );
  });

  const scriptsRemoved = $('script').length;
  $(DROP).remove();
  $('meta').filter((_, el) => /refresh/i.test($(el).attr('http-equiv') ?? '')).remove();

  // Inline handlers and script URLs anywhere.
  $('*').each((_, el) => {
    if (el.type !== 'tag') return;
    for (const [name, val] of Object.entries(el.attribs)) {
      if (/^on/i.test(name) || /^\s*(javascript|vbscript):/i.test(val.replace(/[\u0000-\u001f]/g, ''))) $(el).removeAttr(name);
    }
  });

  // Page links. (R5.1, R5.2)
  $('a[href], area[href]').each((_, el) => {
    const a = $(el);
    if (a.attr('data-seance-link') !== undefined) return; // already rewritten: keeps repair idempotent
    const raw = (a.attr('href') ?? '').trim();
    if (raw === '' || raw.startsWith('#') || /^mailto:/i.test(raw)) return;
    const u = resolveUrl(raw, o.pageUrl);
    if (!u) {
      // ftp:, gopher:, news: and other dead schemes: keep the text, drop the link.
      a.removeAttr('href').attr('data-seance-link', 'dead-scheme');
      return;
    }
    if (!inScope(u, site)) {
      a.attr('href', viewUrl(o.timestamp, u.href)).attr('data-seance-link', 'offsite').attr('rel', 'noopener noreferrer');
      return;
    }
    const hash = u.hash;
    u.hash = '';
    const target = o.resolvePage(u);
    if (target.kind === 'page') {
      a.attr('href', relPath(o.fromPath, target.path) + hash).attr('data-seance-link', 'page');
    } else {
      lostPages.add(u.href);
      a.attr('href', '#lost')
        .attr('data-seance-link', 'lost')
        .attr('data-seance-lost', u.href)
        .attr('title', 'This page was not recovered from the archive.')
        .attr('style', `${a.attr('style') ?? ''};${LOST_STYLE}`.replace(/^;/, ''));
    }
  });

  // Assets. (R5.3, R5.4)
  for (const [selector, attr] of ASSET_ATTRS) {
    $(selector).each((_, el) => {
      const node = $(el);
      if (node.attr('data-seance-asset') !== undefined) return;
      const v = node.attr(attr);
      if (v === undefined) return;
      const u = resolveUrl(v, o.pageUrl);
      if (!u) return; // data: urls and the like stay as they are
      const t = o.resolveAsset(u.href);
      if (t.kind === 'local') {
        node.attr(attr, relPath(o.fromPath, t.path)).attr('data-seance-asset', 'local');
      } else if (t.kind === 'remote') {
        node.attr(attr, rawUrl(o.timestamp, u.href)).attr('data-seance-asset', 'remote');
      } else {
        lostAssets.add(u.href);
        if (el.type === 'tag' && el.name === 'img' && attr === 'src') {
          const w = px(node.attr('width'), 2000);
          const h = px(node.attr('height'), 2000);
          const alt = (node.attr('alt') ?? '').trim().slice(0, 120);
          const box = $('<span role="img"></span>')
            .attr('class', 'seance-missing')
            .attr('data-seance-missing', 'image')
            .attr('data-seance-asset', 'missing')
            .attr('aria-label', alt ? `Lost image: ${alt}` : 'Lost image')
            .attr('title', 'This image was not recovered from the archive.')
            .attr('style', MISSING_STYLE + (w ? `width:${w}px;` : '') + (h ? `height:${h}px;` : ''))
            .text(alt ? `[image lost: ${alt}]` : '[image lost]');
          node.replaceWith(box);
        } else if (el.type === 'tag' && el.name === 'link') {
          node.remove();
        } else {
          node.removeAttr(attr).attr('data-seance-asset', 'missing');
        }
      }
    });
  }

  // Output is always written as UTF-8, so say so.
  $('meta[charset], meta[http-equiv]')
    .filter((_, el) => {
      const m = $(el);
      return m.attr('charset') !== undefined || /content-type/i.test(m.attr('http-equiv') ?? '');
    })
    .remove();
  $('head').prepend('<meta charset="utf-8">');

  return { html: $.html(), lostPages: [...lostPages], lostAssets: [...lostAssets], scriptsRemoved, formsDisabled };
}
