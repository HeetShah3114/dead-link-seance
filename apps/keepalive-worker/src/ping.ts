// One wake-up call to the Render app. Pure, so it can be tested in Node.

export interface PingResult {
  ok: boolean;
  status: number;
  ms: number;
  error?: string;
}

/** Only https URLs are pinged, so a bad config can never point this at something odd. */
export function checkTarget(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password ? u : null;
  } catch {
    return null;
  }
}

export async function ping(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = 20_000, now: () => number = Date.now): Promise<PingResult> {
  const target = checkTarget(url);
  if (!target) return { ok: false, status: 0, ms: 0, error: 'TARGET_URL must be an https URL' };
  const start = now();
  try {
    const res = await fetchImpl(target.href, {
      headers: { 'user-agent': 'dead-link-seance-keepalive/1' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    });
    // Read and drop the body so the connection is released.
    await res.arrayBuffer().catch(() => undefined);
    return { ok: res.ok, status: res.status, ms: now() - start };
  } catch (e) {
    return { ok: false, status: 0, ms: now() - start, error: e instanceof Error ? e.name : 'fetch failed' };
  }
}
