// AI patches: ask, validate, apply (tasks 3.3, 3.4, R6.2, R6.3).
// The model never writes HTML. It returns short text per gap; the server checks it and wraps it.
import * as cheerio from 'cheerio';
import type { ImageGap } from './gaps.js';
import type { Llm } from './llm.js';

export const PATCH_SCHEMA = {
  type: 'object',
  properties: {
    patches: {
      type: 'array',
      items: {
        type: 'object',
        properties: { gap: { type: 'string' }, text: { type: 'string' } },
        required: ['gap', 'text'],
      },
    },
  },
  required: ['patches'],
};

export const PATCH_SYSTEM = [
  'You help restore old personal web pages rebuilt from the Internet Archive.',
  'Some images were lost. For each gap, write what the lost image most likely was, in at most 8 plain words.',
  'Use ONLY words from the alt text, file name and nearby words you are given, plus generic words like image, icon, button, banner, logo, photo.',
  'Never add names, places, dates, numbers, colors, shapes or any detail that is not in them.',
  'If there is nothing to go on, return an empty string for that gap.',
  'No HTML, no links, no quotes from the page. Answer in JSON only.',
].join(' ');

export function patchPrompt(gaps: ImageGap[]): string {
  return JSON.stringify({
    gaps: gaps.map((g) => ({ gap: g.id, alt_text: g.alt, file_name: g.file, nearby_words: g.context })),
  });
}

/** Words allowed to start a description without being in the source. */
const STARTERS = new Set(
  ['a', 'an', 'the', 'this', 'it', 'probably', 'likely', 'possibly', 'perhaps', 'maybe', 'image', 'photo', 'picture', 'graphic', 'banner', 'logo', 'icon', 'animated', 'small', 'large', 'button', 'drawing', 'scan', 'i'],
);

const NO_EXTRA: ReadonlySet<string> = new Set();

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

/**
 * Keep a patch only if it adds no facts. Returns cleaned text, or null to drop it.
 * - short plain text: no markup, links or emails
 * - every number must appear in the source
 * - every capitalized word (a likely name or place) must appear in the source, except plain sentence starters
 */
export function validatePatch(text: unknown, source: string, extraStarters: ReadonlySet<string> = NO_EXTRA): string | null {
  if (typeof text !== 'string') return null;
  const t = text.replace(/\s+/g, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, '');
  if (t.length < 3 || t.length > 160) return null;
  if (/[<>{}]|https?:|www\.|@|\.(com|net|org)\b/i.test(t)) return null;
  const src = new Set(words(source));
  for (const n of t.match(/\d+/g) ?? []) if (!src.has(n)) return null;
  for (const m of t.matchAll(/\p{Lu}[\p{L}']*/gu)) {
    const w = m[0].toLowerCase().replace(/'s$/, '');
    if (STARTERS.has(w) || extraStarters.has(w)) continue;
    if (!src.has(w) && !src.has(`${w}'s`)) return null;
  }
  return t;
}

/** Generic words a caption may use without the source saying them. Nothing descriptive (no colors, shapes). */
const CAPTION_WORDS = new Set(
  (
    'a an the of for with and or to on in from by at this that its it some probably likely possibly perhaps maybe ' +
    'image images picture pictures photo photos graphic graphics icon icons button buttons banner banners logo logos ' +
    'animated animation small large title header heading divider bar line background link links page site home ' +
    'drawing scan clip art gif jpg text sign label badge award counter webring ring'
  ).split(' '),
);

/**
 * Stricter check for image captions (task 3.7 finding: "heart shaped button" from "Lovers Lane" + ll_buttonm.gif).
 * Every word must come from the source (alt, file name, nearby words), or be a generic image word.
 * Words may also match part of a file-name word, e.g. "mail" from "coolmail".
 */
export function validateCaption(text: unknown, source: string): string | null {
  const t = validatePatch(text, source);
  if (!t) return null;
  const srcWords = words(source);
  const src = new Set(srcWords);
  let informative = 0;
  for (const w of words(t)) {
    const base = w.replace(/'s$/, '');
    const fromSource = src.has(base) || (base.length >= 4 && srcWords.some((s) => s.includes(base))) || (base.endsWith('s') && src.has(base.slice(0, -1)));
    if (fromSource && !CAPTION_WORDS.has(base)) informative++;
    if (fromSource || CAPTION_WORDS.has(base)) continue;
    return null;
  }
  // "AI guess: image" tells the reader nothing the box does not already say. (task 3.7 finding)
  return informative > 0 ? t : null;
}

export const AI_STYLE =
  'display:inline-block;margin-left:4px;padding:0 3px;border:1px dotted #a855f7;color:#6b21a8;background:#faf5ff;font:italic 12px/1.3 system-ui,sans-serif;';

/** Wrap each valid patch in a visibly marked span inside its placeholder. */
export function applyPatches(html: string, gaps: ImageGap[], answer: unknown): { html: string; applied: number; dropped: number } {
  const $ = cheerio.load(html);
  const list = (answer as { patches?: unknown })?.patches;
  let applied = 0;
  let dropped = 0;
  if (!Array.isArray(list)) return { html, applied, dropped: gaps.length };
  const byId = new Map(gaps.map((g) => [g.id, g]));
  const done = new Set<string>();
  for (const p of list) {
    const gapId = (p as { gap?: unknown })?.gap;
    const gap = typeof gapId === 'string' ? byId.get(gapId) : undefined;
    if (!gap || done.has(gap.id)) continue;
    done.add(gap.id);
    const text = validateCaption((p as { text?: unknown }).text, `${gap.alt} ${gap.file.replace(/[_\-.]/g, ' ')} ${gap.context}`);
    const node = $(`[data-seance-gap="${gap.id}"]`);
    if (!text || node.length === 0) {
      dropped++;
      continue;
    }
    node.append(
      $('<span></span>')
        .attr('class', 'ai-restored')
        .attr('data-seance-ai', 'image-caption')
        .attr('title', 'AI-restored: a guess from the alt text, file name and nearby words. Not from the original page.')
        .attr('style', AI_STYLE)
        .text(`AI guess: ${text}`),
    );
    applied++;
  }
  return { html: $.html(), applied, dropped };
}

export async function patchPage(html: string, gaps: ImageGap[], llm: Llm) {
  const answer = await llm.json({ system: PATCH_SYSTEM, user: patchPrompt(gaps), schema: PATCH_SCHEMA, maxTokens: 60 * gaps.length + 50 });
  return applyPatches(html, gaps, answer);
}
