// AI fill for a whole site (tasks 3.2 to 3.6). AI is optional: any failure leaves an honest, AI-free site.
import * as cheerio from 'cheerio';
import { findGaps } from './gaps.js';
import { patchPage } from './patches.js';
import { aiLostNote, plainLostNote, type LostFacts } from './lost-note.js';
import { LlmError, type Llm } from './llm.js';

export interface FillPage {
  path: string;
  html: string;
  pageUrl: string;
}

export interface FillOptions {
  maxAiPages: number;
  maxGapsPerPage: number;
}

export interface FillResult {
  pages: FillPage[];
  aiRestoredItems: number;
  aiDropped: number;
  /** True when no AI text was added at all. */
  aiSkipped: boolean;
  /** Why AI was skipped or stopped early, in plain words. */
  aiNote: string;
  lostNote: string;
  lostNoteAi: boolean;
}

/** Link text of lost-page links and alt text of lost images, across the site. */
export function lostNames(pages: FillPage[]): { pages: string[]; images: string[] } {
  const p = new Set<string>();
  const i = new Set<string>();
  for (const page of pages) {
    const $ = cheerio.load(page.html);
    $('a[data-seance-lost]').each((_, el) => {
      // Our own placeholder text ("[image lost]") is not a page name. (task 3.7 finding)
      const link = $(el).clone();
      link.find('[data-seance-missing], .ai-restored').remove();
      const t = link.text().replace(/\s+/g, ' ').trim();
      if (t && t.length <= 60 && /[\p{L}\p{N}]/u.test(t)) p.add(t);
    });
    $('[data-seance-missing=image]').each((_, el) => {
      const t = ($(el).attr('data-seance-alt') ?? '').trim();
      // Tracking pixels and spacers had alt="1" or "*": not worth naming. (task 3.7 finding)
      if (t && t.length <= 60 && (t.match(/\p{L}/gu) ?? []).length >= 3) i.add(t);
    });
  }
  return { pages: [...p], images: [...i] };
}

function why(e: unknown): string {
  if (e instanceof LlmError) {
    return {
      timeout: 'the AI did not answer in time',
      rate_limited: 'the AI is busy or its daily allowance is used up',
      budget: 'the daily AI budget is used up',
      bad_output: 'the AI gave an unusable answer',
      http: 'the AI service returned an error',
      config: 'AI is not set up',
    }[e.kind];
  }
  return 'the AI step failed';
}

export async function aiFill(pages: FillPage[], facts: Omit<LostFacts, 'lostPageNames' | 'lostImageNames'>, llm: Llm | undefined, o: FillOptions): Promise<FillResult> {
  const names = lostNames(pages);
  const allFacts: LostFacts = { ...facts, lostPageNames: names.pages, lostImageNames: names.images };
  const plain = plainLostNote(allFacts);
  const base = { aiRestoredItems: 0, aiDropped: 0, lostNote: plain, lostNoteAi: false };
  if (!llm) return { ...base, pages, aiSkipped: true, aiNote: 'AI is not set up for this server.' };

  let restored = 0;
  let dropped = 0;
  let stopped: string | null = null;
  let aiPages = 0;
  const out: FillPage[] = [];
  for (const page of pages) {
    if (stopped || aiPages >= o.maxAiPages) {
      out.push(page);
      continue;
    }
    const { html, gaps } = findGaps(page.html, o.maxGapsPerPage);
    if (gaps.length === 0) {
      out.push(page);
      continue;
    }
    aiPages++;
    try {
      const r = await patchPage(html, gaps, llm);
      restored += r.applied;
      dropped += r.dropped;
      out.push({ ...page, html: r.html });
    } catch (e) {
      stopped = why(e);
      out.push(page);
    }
  }

  let lostNote = plain;
  let lostNoteAi = false;
  if (!stopped) {
    try {
      const n = await aiLostNote(plain, allFacts, llm);
      if (n) {
        lostNote = n;
        lostNoteAi = true;
      }
    } catch (e) {
      stopped = why(e);
    }
  }

  const aiSkipped = restored === 0 && !lostNoteAi;
  const aiNote = stopped
    ? `AI ${restored || lostNoteAi ? 'stopped early' : 'was skipped'}: ${stopped}.`
    : dropped > 0
      ? `${dropped} AI suggestion${dropped === 1 ? ' was' : 's were'} dropped by the fact check (a detail not on the page, or nothing new to say).`
      : '';
  return { pages: out, aiRestoredItems: restored, aiDropped: dropped, aiSkipped, aiNote, lostNote, lostNoteAi };
}
