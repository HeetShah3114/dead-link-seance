import { describe, it, expect } from 'vitest';
import { describeStep, STEP_LABEL } from './labels';

describe('describeStep', () => {
  it('pairs a themed title with a plain description and a state word', () => {
    const d = describeStep({ name: 'lookup', state: 'active' });
    expect(d).toEqual({ title: 'Calling the archive', plain: 'Looking for the best saved copy', state: 'In progress' });
  });

  it('keeps the detail when present', () => {
    expect(describeStep({ name: 'fetch', state: 'done', detail: 'Snapshot 1999-02-20' }).detail).toBe('Snapshot 1999-02-20');
  });

  it('has a label for every step', () => {
    expect(Object.keys(STEP_LABEL).sort()).toEqual(['aifill', 'build', 'deploy', 'fetch', 'lookup', 'repair']);
  });
});
