// Find the holes AI may help with (task 3.2, R6.1). Pure, no network.
import * as cheerio from 'cheerio';

export interface ImageGap {
  id: string;
  kind: 'lost_image';
  /** Alt text the author wrote, if any. */
  alt: string;
  /** File name of the lost image, e.g. "my_cat.gif". */
  file: string;
  /** Visible words around the image. */
  context: string;
}

const BLOCK = 'p, td, th, li, dd, dt, center, div, h1, h2, h3, h4, h5, h6, blockquote, body';

/** Lost-image placeholders that have something to go on, tagged with gap ids. */
export function findGaps(html: string, maxGaps: number): { html: string; gaps: ImageGap[] } {
  const $ = cheerio.load(html);
  const gaps: ImageGap[] = [];
  $('[data-seance-missing=image]').each((_, el) => {
    if (gaps.length >= maxGaps) return false;
    const node = $(el);
    if (node.attr('data-seance-gap') !== undefined || node.find('.ai-restored').length) return;
    const alt = (node.attr('data-seance-alt') ?? '').trim();
    let file = '';
    try {
      file = decodeURIComponent(new URL(node.attr('data-seance-src') ?? '').pathname.split('/').pop() ?? '');
    } catch {
      file = '';
    }
    const block = node.closest(BLOCK).clone();
    block.find('[data-seance-missing], style, #seance-banner').remove();
    const context = block.text().replace(/\s+/g, ' ').trim().slice(0, 300);
    // Nothing to go on: leave the honest "[image lost]" box alone.
    if (!alt && !context && !/[a-z]{3}/i.test(file.replace(/\.\w+$/, ''))) return;
    const id = `g${gaps.length + 1}`;
    node.attr('data-seance-gap', id);
    gaps.push({ id, kind: 'lost_image', alt, file, context });
  });
  return { html: $.html(), gaps };
}

/** The archive copy stopped mid-page (download was cut off when it was captured). */
export function isTruncated(raw: string): boolean {
  if (raw.length < 400) return false;
  const tail = raw.slice(-600).toLowerCase();
  return !tail.includes('</html>') && !tail.includes('</body>');
}

export const TRUNCATED_NOTE =
  '<p class="seance-truncated" data-seance-truncated="" style="all:initial;display:block;margin:16px 0;padding:6px 10px;border:1px dashed #8b5cf6;background:#f3e8ff;color:#5b21b6;font:13px/1.4 system-ui,sans-serif">The archived copy of this page ends here. The rest was never saved.</p>';

/** Add the truncation notice at the end of the body, once. */
export function markTruncated(html: string): string {
  const $ = cheerio.load(html);
  if ($('[data-seance-truncated]').length === 0) $('body').append(TRUNCATED_NOTE);
  return $.html();
}
