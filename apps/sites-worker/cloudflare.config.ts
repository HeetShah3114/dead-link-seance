import { bindings, defineConfig } from 'cf/config';

// Serves resurrected sites from R2. The app uploads to sites/<siteId>/...; this Worker reads them.
export default defineConfig({
  worker: {
    name: 'dead-link-seance-sites',
    entrypoint: './src/index.ts',
    compatibilityDate: '2026-11-21',
    workersDev: true,
    previewUrls: false,
    env: {
      SITES: bindings.r2({ name: 'dead-link-seance-sites' }),
    },
    observability: {
      enabled: true,
      logs: { enabled: true },
      traces: { enabled: true },
    },
  },
});
