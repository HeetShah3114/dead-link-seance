import type { ApiError, ErrorCode } from '@seance/shared';
import { WaybackError } from '../wayback/client.js';
import { PipelineError } from '../pipeline/resurrect.js';
import { DeployError } from '../deploy/s3.js';

const TEXT: Record<ErrorCode, { message: string; spooky: string }> = {
  INVALID_URL: { message: 'That is not a valid http or https address.', spooky: 'The spirits cannot read that address.' },
  UNSUPPORTED_TARGET: {
    message: 'The archived copy is not a plain web page, so it cannot be rebuilt.',
    spooky: 'This one resists the summoning.',
  },
  NO_SNAPSHOT: { message: 'The Internet Archive has no saved copy of this address.', spooky: 'The spirits are silent.' },
  ARCHIVE_TIMEOUT: {
    message: 'The Internet Archive did not answer in time. Please try again later.',
    spooky: 'The spirits are slow to wake. Try again soon.',
  },
  ARCHIVE_RATE_LIMITED: {
    message: 'The Internet Archive asked us to slow down. Please try again in a few minutes.',
    spooky: 'Too many voices at once. Wait a moment.',
  },
  RATE_LIMITED: { message: 'Too many requests. Please wait before summoning again.', spooky: 'The circle needs time to rest.' },
  JOB_ACTIVE: { message: 'You already have a summoning in progress.', spooky: 'One spirit at a time.' },
  DEPLOY_FAILED: { message: 'The site was rebuilt but could not be published.', spooky: 'The spirit could not cross over.' },
  INTERNAL: { message: 'Something went wrong on our side.', spooky: 'The ritual faltered.' },
};

export function apiError(code: ErrorCode): ApiError {
  return { code, ...TEXT[code] };
}

/** Map any thrown error to a safe API error. Never leaks stack traces or raw upstream text. (R10.5) */
export function toApiError(e: unknown): ApiError {
  if (e instanceof PipelineError) return apiError(e.code);
  if (e instanceof WaybackError) return apiError(e.code);
  if (e instanceof DeployError) return apiError('DEPLOY_FAILED');
  return apiError('INTERNAL');
}
