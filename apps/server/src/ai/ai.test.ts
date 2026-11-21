import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as cheerio from 'cheerio';
import { findGaps, isTruncated, markTruncated } from './gaps.js';
import { applyPatches, validateCaption, validatePatch } from './patches.js';
import { aiLostNote, plainLostNote, type LostFacts } from './lost-note.js';
import { aiFill, lostNames } from './aifill.js';
import { LlmError, type Llm } from './llm.js';

const placeholder = (alt: string, src = 'http://a.com/my_cat.gif') =>
  `<span role="img" class="seance-missing" data-seance-missing="image" data-seance-src="${src}" data-seance-alt="${alt}">[image lost${alt ? `: ${alt}` : ''}]</span>`;

describe('findGaps (3.2)', () => {
  it('finds lost images with alt text, file name and nearby words', () => {
    const { html, gaps } = findGaps(`<body><p>This is Mittens on the porch. ${placeholder('my cat')}</p></body>`, 8);
    expect(gaps).toEqual([{ id: 'g1', kind: 'lost_image', alt: 'my cat', file: 'my_cat.gif', context: 'This is Mittens on the porch.' }]);
    expect(html).toContain('data-seance-gap="g1"');
  });

  it('skips placeholders with nothing to go on, and respects the cap', () => {
    expect(findGaps(`<body><p>${placeholder('', 'http://a.com/x1.gif')}</p></body>`, 8).gaps).toHaveLength(0);
    expect(findGaps(`<body><p>hi ${placeholder('a')}${placeholder('b')}${placeholder('c')}</p></body>`, 2).gaps).toHaveLength(2);
  });

  it('spots a page the archive cut off', () => {
    expect(isTruncated(`<html><body>${'x'.repeat(500)}</body></html>`)).toBe(false);
    expect(isTruncated(`<html><body><p>${'x'.repeat(500)}`)).toBe(true);
    const marked = markTruncated('<body><p>x</p></body>');
    expect(markTruncated(marked)).toBe(marked);
    expect(marked).toContain('ends here');
  });
});

describe('validatePatch (3.3)', () => {
  const src = 'my cat Mittens on the porch my_cat.gif';
  it('keeps plain descriptions built from the source', () => {
    expect(validatePatch('A photo of Mittens the cat on the porch', src)).toBe('A photo of Mittens the cat on the porch');
    expect(validatePatch('  "Probably a small cat picture"  ', src)).toBe('Probably a small cat picture');
  });
  it('drops new names, numbers, links and markup', () => {
    for (const bad of ['A photo of Garfield', 'Mittens in 1998', 'See www.cats.com', '<b>cat</b>', 'email me@aol.com', 'x', 'a'.repeat(200), 42, null]) {
      expect(validatePatch(bad, src), String(bad)).toBeNull();
    }
  });
  it('property: a kept patch never holds a number or a capitalized word missing from the source', () => {
    const word = fc.constantFrom('cat', 'Mittens', 'Garfield', 'porch', 'Paris', '1998', 'photo', 'A', 'The', 'Probably', 'of', 'on', 'Tokyo', '42');
    fc.assert(
      fc.property(fc.array(word, { minLength: 1, maxLength: 10 }), (ws) => {
        const kept = validatePatch(ws.join(' '), src);
        if (kept === null) return true;
        const srcWords = new Set(src.toLowerCase().split(/[^a-z0-9']+/));
        return kept.split(' ').every((w) => {
          if (/\d/.test(w)) return srcWords.has(w);
          if (/^[A-Z]/.test(w)) return srcWords.has(w.toLowerCase()) || ['a', 'the', 'probably'].includes(w.toLowerCase());
          return true;
        });
      }),
      { numRuns: 400 },
    );
  });
});

describe('validateCaption (3.7 findings)', () => {
  it('drops invented visual details that the plain check let through', () => {
    expect(validateCaption('heart shaped button', 'Lovers Lane ll buttonm gif')).toBeNull();
    expect(validateCaption('bittersweet scene', 'bittersweet jpg')).toBeNull();
    expect(validateCaption('red flashing email icon', 'coolmail gif')).toBeNull();
  });
  it('drops captions that say nothing new ("image", "icon")', () => {
    expect(validateCaption('image', 'welcome gif')).toBeNull();
    expect(validateCaption('An animated icon', 'mainup gif')).toBeNull();
    expect(validateCaption('welcome banner', 'welcome gif')).toBe('welcome banner');
  });

  it('catches swapped counts even with words in between', async () => {
    const plain = plainLostNote(facts);
    const llm: Llm = { model: 'f', json: async () => ({ note: '3 of its 4 pages came back from the 1999-02-20 snapshot, and 1 form.' }) };
    expect(await aiLostNote(plain, facts, llm)).toBeNull();
  });

  it('keeps captions made of source words and generic image words', () => {
    expect(validateCaption('Lovers Lane button', 'Lovers Lane ll buttonm gif')).toBe('Lovers Lane button');
    expect(validateCaption('mail icon', 'coolmail gif')).toBe('mail icon');
    expect(validateCaption('Probably a Buffy webring banner', 'Buffy webring webring gif')).toBe('Probably a Buffy webring banner');
  });
});

describe('lost names (3.7 findings)', () => {
  it('never lists our own placeholder text as a page name', () => {
    const page = {
      path: 'index.html',
      pageUrl: 'http://a.com/',
      html: `<body><a href="#lost" data-seance-lost="x">${placeholder('')}</a><a href="#lost" data-seance-lost="y">BANDS I LIKE</a>${placeholder('1')}${placeholder('my cat')}</body>`,
    };
    expect(lostNames([page])).toEqual({ pages: ['BANDS I LIKE'], images: ['my cat'] });
  });
  it('uses the right pronoun for forms', () => {
    expect(plainLostNote({ ...facts, formsDisabled: 2 })).toContain('2 forms no longer work, because the server behind them is gone.');
  });
});

describe('applyPatches (3.4)', () => {
  it('wraps valid patches in a labeled ai-restored span and drops the rest', () => {
    const { html, gaps } = findGaps(`<body><p>Mittens on the porch ${placeholder('my cat')}</p><p>Garden ${placeholder('rose', 'http://a.com/rose.gif')}</p></body>`, 8);
    const r = applyPatches(html, gaps, {
      patches: [
        { gap: 'g1', text: 'A photo of Mittens on the porch' },
        { gap: 'g2', text: 'Roses from Paris' },
        { gap: 'g9', text: 'ghost gap' },
      ],
    });
    expect(r).toMatchObject({ applied: 1, dropped: 1 });
    const $ = cheerio.load(r.html);
    const ai = $('.ai-restored');
    expect(ai).toHaveLength(1);
    expect(ai.text()).toBe('AI guess: A photo of Mittens on the porch');
    expect(ai.attr('title')).toMatch(/^AI-restored/);
    expect(ai.attr('style')).toContain('dotted');
  });
  it('treats a malformed answer as nothing applied', () => {
    const { html, gaps } = findGaps(`<body><p>x ${placeholder('cat')}</p></body>`, 8);
    expect(applyPatches(html, gaps, 'nonsense')).toMatchObject({ applied: 0, dropped: 1 });
  });
});

const facts: LostFacts = {
  siteUrl: 'http://www.geocities.com/Hollywood/Hills/1234/',
  snapshotDate: '1999-02-20',
  pagesFound: 4,
  pagesRecovered: 2,
  assetsFound: 3,
  assetsRecovered: 2,
  formsDisabled: 1,
  truncatedPages: 0,
  lostPageNames: ['The cast'],
  lostImageNames: ['Buffy webring'],
};

describe('lost note (3.5)', () => {
  it('writes a plain factual note', () => {
    expect(plainLostNote(facts)).toBe(
      '2 of 4 pages and 2 of 3 images and files came back from the 1999-02-20 snapshot. 2 pages were never saved by the archive, including "The cast". Lost images include "Buffy webring". 1 form no longer works, because the server behind it is gone.',
    );
  });
  const llmSaying = (note: unknown): Llm => ({ model: 'fake', json: async () => ({ note }) });
  it('accepts an AI rewording that keeps the facts', async () => {
    const plain = plainLostNote(facts);
    const n = 'Only 2 of 4 pages and 2 of 3 images and files rose from the 1999-02-20 snapshot. The cast page and the Buffy webring image stay in the dark, and 1 form will never answer again.';
    expect(await aiLostNote(plain, facts, llmSaying(n))).toBe(n);
  });
  it('rejects an AI rewording that adds or changes facts', async () => {
    const plain = plainLostNote(facts);
    expect(await aiLostNote(plain, facts, llmSaying('2 of 4 pages came back. Stacy built this in Ohio.'))).toBeNull();
    expect(await aiLostNote(plain, facts, llmSaying('3 of 4 pages and 2 of 3 images came back from 1999-02-20, 1 form.'))).toBeNull();
    expect(await aiLostNote(plain, facts, llmSaying(42))).toBeNull();
  });
});

describe('aiFill (3.6)', () => {
  const pages = [{ path: 'index.html', pageUrl: facts.siteUrl, html: `<body><p>Mittens on the porch ${placeholder('my cat')}</p><a data-seance-lost="x" href="#lost">The cast</a></body>` }];
  const base = { siteUrl: facts.siteUrl, snapshotDate: facts.snapshotDate, pagesFound: 2, pagesRecovered: 1, assetsFound: 1, assetsRecovered: 0, formsDisabled: 0, truncatedPages: 0 };
  const opts = { maxAiPages: 5, maxGapsPerPage: 8 };

  it('without AI: plain note, no AI marks, says so', async () => {
    const r = await aiFill(pages, base, undefined, opts);
    expect(r).toMatchObject({ aiSkipped: true, aiRestoredItems: 0, lostNoteAi: false });
    expect(r.lostNote).toContain('"The cast"');
    expect(r.pages[0]!.html).not.toContain('ai-restored');
  });

  it('with AI: patches applied and counted', async () => {
    const llm: Llm = {
      model: 'fake',
      json: async (req) => (req.schema === undefined ? {} : 'patches' in ((req.schema as { properties: object }).properties) ? { patches: [{ gap: 'g1', text: 'A photo of Mittens on the porch' }] } : { note: 'nope' }),
    };
    const r = await aiFill(pages, base, llm, opts);
    expect(r).toMatchObject({ aiSkipped: false, aiRestoredItems: 1, lostNoteAi: false });
    expect(r.pages[0]!.html).toContain('ai-restored');
  });

  it('when AI fails: finishes the site without AI and says why (R6.5)', async () => {
    const llm: Llm = {
      model: 'fake',
      json: async () => {
        throw new LlmError('rate_limited', 'x');
      },
    };
    const r = await aiFill(pages, base, llm, opts);
    expect(r).toMatchObject({ aiSkipped: true, aiRestoredItems: 0, lostNoteAi: false });
    expect(r.aiNote).toContain('daily allowance');
    expect(r.pages[0]!.html).not.toContain('ai-restored');
    expect(r.lostNote.length).toBeGreaterThan(10);
  });
});
