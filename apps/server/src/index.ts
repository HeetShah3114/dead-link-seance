import Fastify from 'fastify';

export function buildApp() {
  const app = Fastify({ logger: true });
  app.get('/health', async () => ({ ok: true }));
  return app;
}

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

if (process.env.VITEST === undefined) {
  buildApp()
    .listen({ port, host })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
