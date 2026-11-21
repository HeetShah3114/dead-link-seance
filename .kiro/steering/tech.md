---
inclusion: always
---
# Tech choices (design approved)

Stack: TypeScript, Node 20+, Fastify, React + Vite, SQLite (better-sqlite3), p-queue,
parse5/cheerio, sanitize-html, Amazon Bedrock (Claude) behind one `llm` module,
Cloudflare R2 + a Worker (`apps/sites-worker`) for output sites, one container for the app. Tests: Vitest + fast-check.
Runtime: Node 26. Cloudflare CLI: `cf` (not Wrangler) for R2 and the Worker.
Layout: `apps/server`, `apps/web`, `apps/sites-worker`, `packages/shared`. Full reasoning: `specs/resurrection-mvp/design.md`.

Principles, fixed now:
- Simple and fast to deploy. Fewest moving parts that work for 2 people in 2.5 weeks.
- Output of a resurrection is a plain static site (HTML/CSS/assets), no runtime needed to view it.
- One language across frontend and backend if possible (TypeScript).
- Secrets (LLM key, deploy token) live in env vars. Never in the repo or in logs.
- Wayback access goes through one client module that owns: User-Agent, queue, cache, retry.
- LLM access goes through one module. Its output is always tagged as AI-restored.
- Page limit and depth limit are config values, not magic numbers.
- Every spec task ends with something runnable.

Stack (frontend, backend, hosting, LLM provider, deploy target): decided in `design.md`.
