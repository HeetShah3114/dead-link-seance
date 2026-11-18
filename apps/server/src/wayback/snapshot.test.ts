import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseCdx, pickBest, rawUrl, viewUrl, formatDate, type Snapshot } from './snapshot.js';

const header = ['timestamp', 'original', 'mimetype', 'statuscode'];

describe('parseCdx', () => {
  it('parses rows and ignores the header', () => {
    const rows = parseCdx([header, ['20030412101500', 'http://a.com/', 'text/html', '200']]);
    expect(rows).toEqual([
      { timestamp: '20030412101500', original: 'http://a.com/', mimetype: 'text/html', statuscode: '200' },
    ]);
  });

  it('returns [] for empty or malformed input', () => {
    expect(parseCdx([])).toEqual([]);
    expect(parseCdx([header])).toEqual([]);
    expect(parseCdx(null)).toEqual([]);
    expect(parseCdx([['x'], ['y']])).toEqual([]);
  });

  it('skips bad rows', () => {
    const rows = parseCdx([header, ['bad', 'http://a.com/', 'text/html', '200'], ['20030412101500', 'http://a.com/', 'text/html', '200']]);
    expect(rows).toHaveLength(1);
  });
});

describe('pickBest', () => {
  const s = (timestamp: string, statuscode = '200', mimetype = 'text/html'): Snapshot => ({
    timestamp,
    original: 'http://a.com/',
    mimetype,
    statuscode,
  });

  it('picks the newest 200 html snapshot', () => {
    expect(pickBest([s('20010101000000'), s('20050101000000'), s('20030101000000')])?.timestamp).toBe('20050101000000');
  });

  it('ignores non-200 and non-html', () => {
    expect(pickBest([s('20050101000000', '404'), s('20060101000000', '200', 'image/gif')])).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(pickBest([])).toBeNull();
  });

  it('property: result is in the input and no ok snapshot is newer', () => {
    const snap = fc.record({
      timestamp: fc.integer({ min: 19960101000000, max: 20261231235959 }).map(String),
      original: fc.constant('http://a.com/'),
      mimetype: fc.constantFrom('text/html', 'image/gif', 'warc/revisit'),
      statuscode: fc.constantFrom('200', '301', '404', '-'),
    });
    fc.assert(
      fc.property(fc.array(snap), (list) => {
        const best = pickBest(list);
        const ok = list.filter((x) => x.statuscode === '200' && x.mimetype === 'text/html');
        if (ok.length === 0) return best === null;
        return best !== null && ok.every((x) => x.timestamp <= best.timestamp);
      }),
    );
  });
});

describe('urls and dates', () => {
  it('builds raw and view urls', () => {
    expect(rawUrl('20030412101500', 'http://a.com/')).toBe('https://web.archive.org/web/20030412101500id_/http://a.com/');
    expect(viewUrl('20030412101500', 'http://a.com/')).toBe('https://web.archive.org/web/20030412101500/http://a.com/');
  });

  it('formats dates', () => {
    expect(formatDate('20030412101500')).toBe('2003-04-12');
  });
});
