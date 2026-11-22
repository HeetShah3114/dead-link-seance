import { bindings, defineConfig, triggers } from 'cf/config';

// Wakes the Render app every 10 minutes (Render free sleeps after 15 idle minutes).
// Deploy with the real address: KEEPALIVE_URL=https://<your-app>.onrender.com/health cf deploy
const target = process.env.KEEPALIVE_URL;
if (!target) throw new Error('Set KEEPALIVE_URL to the Render app health URL before deploying.');

export default defineConfig({
  worker: {
    name: 'dead-link-seance-keepalive',
    entrypoint: './src/index.ts',
    compatibilityDate: '2026-11-22',
    // Cron only: no public address.
    workersDev: false,
    previewUrls: false,
    env: {
      TARGET_URL: bindings.text(target),
    },
    triggers: [triggers.scheduled({ schedule: '*/10 * * * *' })],
    observability: {
      enabled: true,
      logs: { enabled: true },
    },
  },
});
