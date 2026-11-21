import * as cheerio from 'cheerio';
import { formatDate, viewUrl } from '../wayback/snapshot.js';

export interface BannerOptions {
  /** Original URL of THIS page. */
  pageUrl: string;
  /** 14-digit snapshot timestamp. */
  timestamp: string;
  /** Contact link for takedown requests. (R11.4) */
  contactUrl?: string;
  /** Relative link to the site's "what was lost" page. */
  lostHref?: string;
  /** This page holds AI-restored text: explain the dotted outline. (R6.2) */
  aiLegend?: boolean;
}

export const BANNER_ID = 'seance-banner';
const DEFAULT_CONTACT = 'https://github.com/HeetShah3114/dead-link-seance/issues';

/**
 * Rules use `all: initial` then `!important` on everything, and sit at the end of <body>,
 * so the original page's CSS cannot hide or restyle the banner. (R7.3)
 */
const BANNER_CSS = `
#${BANNER_ID}{all:initial !important;display:block !important;position:fixed !important;top:0 !important;left:0 !important;right:0 !important;z-index:2147483647 !important;box-sizing:border-box !important;padding:8px 12px !important;background:#14101c !important;color:#f1e9ff !important;font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif !important;border-bottom:2px solid #8b5cf6 !important;visibility:visible !important;opacity:1 !important;height:auto !important;text-align:left !important}
#${BANNER_ID} a{all:initial !important;color:#c4b5fd !important;text-decoration:underline !important;cursor:pointer !important;font:inherit !important}
#${BANNER_ID} strong{all:initial !important;color:#f1e9ff !important;font:inherit !important;font-weight:700 !important}
#${BANNER_ID} span{all:initial !important;color:inherit !important;font:inherit !important}
#${BANNER_ID} br{display:block !important}
body{margin-top:0 !important;padding-top:64px !important}
`;

/** Add the credit banner to a page. Safe to call once per page. (R7.1, R7.2, R7.4) */
export function injectBanner(html: string, opts: BannerOptions): string {
  const $ = cheerio.load(html);
  const view = viewUrl(opts.timestamp, opts.pageUrl);
  const date = formatDate(opts.timestamp);

  const banner = $('<div role="note"></div>').attr('id', BANNER_ID);
  banner.append($('<strong></strong>').text('This is a reconstruction. '));
  banner.append(textSpan(`Rebuilt from the Wayback Machine snapshot of ${opts.pageUrl} taken on ${date}. `, $));
  banner.append($('<a></a>').attr('href', view).text('View the original snapshot'));
  banner.append(textSpan(' \u00b7 ', $));
  if (opts.lostHref) {
    banner.append($('<a></a>').attr('href', opts.lostHref).text('What was lost'));
    banner.append(textSpan(' \u00b7 ', $));
  }
  banner.append($('<a></a>').attr('href', opts.contactUrl ?? DEFAULT_CONTACT).text('Report or request removal'));
  if (opts.aiLegend) {
    banner.append($('<br>'));
    banner.append(textSpan('Text in a dotted outline marked \u201cAI guess\u201d was written by AI to describe what was lost. It is not from the original page.', $));
  }

  const style = $('<style></style>').text(BANNER_CSS);
  $('body').append(style).append(banner);
  return $.html();
}

function textSpan(text: string, $: cheerio.CheerioAPI) {
  return $('<span></span>').text(text);
}
