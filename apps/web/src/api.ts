import type { ApiError, JobView, SummonResponse } from '@seance/shared';

/** Thrown for any failed API call. Always carries a safe, themed error. */
export class ApiCallError extends Error {
  constructor(public readonly apiError: ApiError) {
    super(apiError.message);
  }
}

const NETWORK: ApiError = {
  code: 'INTERNAL',
  message: 'Could not reach the server. Check your connection and try again.',
  spooky: 'The line to the other side went dead.',
};

async function readError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: ApiError };
    if (body.error?.code && body.error.message) return body.error;
  } catch {
    /* fall through */
  }
  return { ...NETWORK, message: 'Something went wrong on our side.', spooky: 'The ritual faltered.' };
}

export async function startSummons(url: string): Promise<SummonResponse> {
  let res: Response;
  try {
    res = await fetch('/api/summons', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  } catch {
    throw new ApiCallError(NETWORK);
  }
  if (!res.ok) throw new ApiCallError(await readError(res));
  return (await res.json()) as SummonResponse;
}

export async function getJob(jobId: string): Promise<JobView> {
  let res: Response;
  try {
    res = await fetch(`/api/summons/${encodeURIComponent(jobId)}`);
  } catch {
    throw new ApiCallError(NETWORK);
  }
  if (!res.ok) throw new ApiCallError(await readError(res));
  return (await res.json()) as JobView;
}
