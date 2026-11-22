import type { ErrorCode } from '@seance/shared';

export interface Hint {
  /** Short themed heading shown above the server's plain message. */
  title: string;
  /** What to try next, in plain words. Never blames the user. (tone.md) */
  next: string;
  /** Whether "Try again" makes sense right away. */
  retry: boolean;
  /** Whether the address box should get focus, so the user can fix it. */
  editUrl: boolean;
}

/** One entry per error code. The Record type makes a missing code a compile error. (R10) */
export const HINTS: Record<ErrorCode, Hint> = {
  INVALID_URL: {
    title: 'The spirits cannot read that address',
    next: 'Check it starts with http:// or https:// and names a public website, like http://www.geocities.com/Area51/1234/.',
    retry: false,
    editUrl: true,
  },
  UNSUPPORTED_TARGET: {
    title: 'This one resists the summoning',
    next: 'The saved copy is not a plain web page. Try the address of a single HTML page on the site instead.',
    retry: false,
    editUrl: true,
  },
  NO_SNAPSHOT: {
    title: 'The spirits are silent',
    next: 'Check the spelling, or try the site\u2019s home page or a page one level up.',
    retry: false,
    editUrl: true,
  },
  ARCHIVE_TIMEOUT: {
    title: 'The archive did not answer',
    next: 'The Internet Archive is slow right now. Try again in a minute.',
    retry: true,
    editUrl: false,
  },
  ARCHIVE_RATE_LIMITED: {
    title: 'Too many voices at once',
    next: 'The Internet Archive asked us to slow down. Wait a few minutes, then try again.',
    retry: true,
    editUrl: false,
  },
  RATE_LIMITED: {
    title: 'The circle needs to rest',
    next: 'You have summoned the limit for this hour. Come back a little later.',
    retry: false,
    editUrl: false,
  },
  JOB_ACTIVE: {
    title: 'One spirit at a time',
    next: 'A summoning from you is still running. Wait for it to finish, then try again.',
    retry: true,
    editUrl: false,
  },
  DEPLOY_FAILED: {
    title: 'The spirit could not cross over',
    next: 'The site was rebuilt but could not be published. Try again in a minute.',
    retry: true,
    editUrl: false,
  },
  REMOVED: {
    title: 'This spirit has been laid to rest',
    next: 'This resurrection was taken down on request, so its link no longer works.',
    retry: false,
    editUrl: false,
  },
  INTERNAL: {
    title: 'The ritual faltered',
    next: 'Something broke on our side. Try again; if it keeps happening, report it.',
    retry: true,
    editUrl: false,
  },
};

export function hintFor(code: string): Hint {
  return HINTS[code as ErrorCode] ?? HINTS.INTERNAL;
}
