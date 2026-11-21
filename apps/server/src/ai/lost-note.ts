// The "what was lost" note (task 3.5, R6.4). Always written from facts; AI may only reword it.
import type { Llm } from './llm.js';
import { validatePatch } from './patches.js';

export interface LostFacts {
  siteUrl: string;
  snapshotDate: string;
  pagesFound: number;
  pagesRecovered: number;
  assetsFound: number;
  assetsRecovered: number;
  formsDisabled: number;
  truncatedPages: number;
  /** Link text of pages that did not come back, e.g. "Sign my guestbook". */
  lostPageNames: string[];
  /** Alt text of images that did not come back. */
  lostImageNames: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const quoteList = (xs: string[]) => xs.slice(0, 4).map((x) => `"${x}"`).join(', ');

/** Plain, factual note. Used as-is when AI is off or its answer fails the checks. */
export function plainLostNote(f: LostFacts): string {
  const parts = [
    `${f.pagesRecovered} of ${plural(f.pagesFound, 'page')} and ${f.assetsRecovered} of ${plural(f.assetsFound, 'image and file', 'images and files')} came back from the ${f.snapshotDate} snapshot.`,
  ];
  const lostPages = f.pagesFound - f.pagesRecovered;
  if (lostPages > 0) {
    const names = f.lostPageNames.slice(0, lostPages);
    parts.push(`${plural(lostPages, 'page was', 'pages were')} never saved by the archive${names.length ? `, including ${quoteList(names)}` : ''}.`);
  }
  const lostImages = f.assetsFound - f.assetsRecovered;
  if (lostImages > 0 && f.lostImageNames.length) parts.push(`Lost images include ${quoteList(f.lostImageNames)}.`);
  if (f.formsDisabled > 0) {
    parts.push(
      f.formsDisabled === 1
        ? '1 form no longer works, because the server behind it is gone.'
        : `${f.formsDisabled} forms no longer work, because the server behind them is gone.`,
    );
  }
  if (f.truncatedPages > 0) parts.push(`${plural(f.truncatedPages, 'page was', 'pages were')} cut off when they were saved.`);
  return parts.join(' ');
}

export const NOTE_SCHEMA = { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] };

export const NOTE_SYSTEM = [
  'You write a short epitaph-style note for an old website rebuilt from the Internet Archive.',
  'Rewrite the given facts as two or three gentle sentences with a light, spooky tone.',
  'Keep every number exactly as given. Do not add any fact, name, date or number that is not in the facts.',
  'No HTML, no links. Answer in JSON only.',
].join(' ');

/** Common words that may start a sentence of the note. Names are still checked against the facts. */
const NOTE_STARTERS: ReadonlySet<string> = new Set(
  'only just here there once now still some most all its their these those what where when and but yet so of in from beyond sadly alas nothing none every each one no its we you they here\'s gone lost silent within'.split(' '),
);

/** AI rewording of the plain note, or null if AI is off, fails, or adds anything. */
export async function aiLostNote(plain: string, f: LostFacts, llm: Llm): Promise<string | null> {
  const answer = (await llm.json({ system: NOTE_SYSTEM, user: JSON.stringify({ facts: plain }), schema: NOTE_SCHEMA, maxTokens: 200 })) as {
    note?: unknown;
  };
  const note = typeof answer?.note === 'string' ? answer.note.replace(/\s+/g, ' ').trim() : '';
  if (note.length < 20 || note.length > 600) return null;
  // Same fact check as patches, sentence by sentence, against the plain note and the facts.
  const source = `${plain} ${f.siteUrl} ${[...f.lostPageNames, ...f.lostImageNames].join(' ')} archive internet wayback machine website site web page pages`;
  const sentences = note.split(/(?<=[.!?])\s+/);
  for (const s of sentences) if (!validatePatch(s.length > 160 ? s.slice(0, 160) : s, source, NOTE_STARTERS)) return null;
  // No new numbers (checked above), and no swapped counts: every "X of Y" must be one of ours.
  // Allows up to two words between "of" and the number ("2 of its 4 pages"). (task 3.7 finding)
  const pairs = (s: string) => new Set([...s.matchAll(/(\d+)\s+(?:out\s+)?of\s+(?:[\p{L}']+\s+){0,2}(\d+)/giu)].map((m) => `${m[1]}/${m[2]}`));
  const ours = pairs(plain);
  for (const p of pairs(note)) if (!ours.has(p)) return null;
  return note;
}
