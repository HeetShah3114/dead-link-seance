// Pipeline limits. Config values, not magic numbers (tech.md). Override with env vars.

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export interface Limits {
  /** Pages per site, start page included. (R3.2) */
  maxPages: number;
  /** Link hops from the start page. (R3.2) */
  maxDepth: number;
  /** Assets downloaded per site; the rest point at archived copies. */
  maxAssets: number;
  maxPageBytes: number;
  maxAssetBytes: number;
  maxSiteBytes: number;
  /** Summons per client per hour. (R11.1) */
  summonsPerHour: number;
  /** Reuse an earlier build of the same url + snapshot if younger than this. (R8.3) */
  reuseMaxAgeMs: number;
}

export function loadLimits(): Limits {
  return {
    maxPages: num('MAX_PAGES', 15),
    maxDepth: num('MAX_DEPTH', 2),
    maxAssets: num('MAX_ASSETS', 60),
    maxPageBytes: num('MAX_PAGE_BYTES', 1024 * 1024),
    maxAssetBytes: num('MAX_ASSET_BYTES', 2 * 1024 * 1024),
    maxSiteBytes: num('MAX_SITE_BYTES', 25 * 1024 * 1024),
    summonsPerHour: num('SUMMONS_PER_HOUR', 3),
    // R2 deletes sites/ after 30 days; stop reusing a day before that.
    reuseMaxAgeMs: num('REUSE_MAX_AGE_MS', 29 * 24 * 3600 * 1000),
  };
}

export const DEFAULT_LIMITS: Limits = {
  maxPages: 15,
  maxDepth: 2,
  maxAssets: 60,
  maxPageBytes: 1024 * 1024,
  maxAssetBytes: 2 * 1024 * 1024,
  maxSiteBytes: 25 * 1024 * 1024,
  summonsPerHour: 3,
  reuseMaxAgeMs: 29 * 24 * 3600 * 1000,
};
