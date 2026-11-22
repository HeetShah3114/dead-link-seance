import { describe, it, expect } from 'vitest';
import { HINTS, hintFor } from './hints';

describe('silence hints', () => {
  it('give every error code a plain next step', () => {
    for (const [code, h] of Object.entries(HINTS)) {
      expect(h.next.length, code).toBeGreaterThan(20);
      expect(h.title.length, code).toBeGreaterThan(5);
      // never blame the user (tone.md)
      expect(h.next.toLowerCase(), code).not.toMatch(/\byou (did|made|entered) .*wrong|your fault|invalid input/);
    }
  });

  it('offer a retry only where waiting can help', () => {
    expect(HINTS.ARCHIVE_TIMEOUT.retry).toBe(true);
    expect(HINTS.NO_SNAPSHOT.retry).toBe(false);
    expect(HINTS.NO_SNAPSHOT.editUrl).toBe(true);
  });

  it('falls back to INTERNAL for an unknown code', () => {
    expect(hintFor('SOMETHING_NEW')).toBe(HINTS.INTERNAL);
  });
});
