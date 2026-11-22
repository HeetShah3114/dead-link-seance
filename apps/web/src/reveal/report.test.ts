import { describe, it, expect } from 'vitest';
import type { JobResult } from '@seance/shared';
import { absoluteUrl, reportLines } from './report';

const result = (over: Partial<JobResult['report']> = {}): JobResult => ({
  siteUrl: '/sites/abcdefabcdef/',
  beforeUrl: 'https://web.archive.org/web/2001/http://a.com/',
  downloadUrl: '',
  lostNote: 'x',
  report: {
    pagesFound: 4,
    pagesRecovered: 2,
    assetsFound: 17,
    assetsRecovered: 8,
    aiRestoredItems: 1,
    aiSkipped: false,
    formsDisabled: 2,
    lostPages: [],
    lostAssets: [],
    ...over,
  },
});

describe('reportLines', () => {
  it('lists counts, forms and AI items in plain words', () => {
    expect(reportLines(result())).toEqual([
      { label: 'Pages', value: '2 of 4 came back' },
      { label: 'Images and files', value: '8 of 17 came back' },
      { label: 'Forms', value: '2 switched off (their server is gone)' },
      { label: 'AI-restored', value: '1 item, each marked "AI guess"' },
    ]);
  });
  it('says None when AI was skipped, and hides zero forms', () => {
    const lines = reportLines(result({ aiSkipped: true, aiRestoredItems: 0, formsDisabled: 0, reused: true }));
    expect(lines.find((l) => l.label === 'AI-restored')?.value).toBe('None');
    expect(lines.find((l) => l.label === 'Forms')).toBeUndefined();
    expect(lines.at(-1)?.value).toContain('Reused');
  });
});

describe('absoluteUrl', () => {
  it('makes local site links absolute and keeps full links', () => {
    expect(absoluteUrl('/sites/abc/', 'http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173/sites/abc/');
    expect(absoluteUrl('https://x.workers.dev/sites/abc/', 'http://127.0.0.1:5173')).toBe('https://x.workers.dev/sites/abc/');
  });
});
