// Cron-only Worker: every 10 minutes, call the Render app's /health so its free plan never sleeps
// (Render sleeps free services after 15 idle minutes). No public URL, no fetch handler.
import { env } from 'cloudflare:workers';
import { ping } from './ping';

interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

export default {
  async scheduled(_controller: unknown, _env: unknown, ctx: Ctx): Promise<void> {
    const url = (env as unknown as { TARGET_URL: string }).TARGET_URL;
    ctx.waitUntil(
      ping(url).then((r) => {
        // Structured log line, visible in Workers Logs.
        console.log(JSON.stringify({ msg: 'keepalive', url, ...r }));
      }),
    );
  },
};
