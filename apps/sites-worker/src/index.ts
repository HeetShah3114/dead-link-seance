import { env } from 'cloudflare:workers';
import { handle, type SiteBucket } from './handler';

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      return await handle(request, (env as unknown as { SITES: SiteBucket }).SITES);
    } catch (e) {
      console.error(JSON.stringify({ msg: 'sites worker error', error: e instanceof Error ? e.message : String(e) }));
      return new Response('The spirit could not be reached. Please try again.', { status: 500 });
    }
  },
};
