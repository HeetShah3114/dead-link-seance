# Design: Resurrection MVP

Covers requirements R1 to R12 in `requirements.md`.

## 1. Stack recommendation

| Part | Choice | Reason |
|---|---|---|
| Language | TypeScript everywhere | One language, shared API types, 2 people. |
| Backend | Node 20 + Fastify | Small, fast, good schema support. |
| Frontend | Vite + React | Quick to build. Static files, served by the backend. |
| HTML work | `parse5` + `cheerio`, `sanitize-html` | Mature parsing and allow-list sanitizing. |
| Job queue | In-process queue (`p-queue`) | No Redis. One worker is enough for a demo. |
| State + cache | SQLite (`better-sqlite3`) on a disk volume | No separate database. Survives restarts. |
| Wayback client | Own module over `fetch` | Owns User-Agent, rate limit, retry, cache (R4). |
| LLM | Cloudflare Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, JSON mode), via one `llm` module | Hosted, same Cloudflare account as R2, free daily allowance. Swappable. See section 12. |
| Output storage + deploy | Cloudflare R2 bucket + one Worker (`apps/sites-worker`), one folder per site | "Deploy" is an upload over R2's S3 API. No build step per site. Free egress. See section 11. |
| App hosting | One container on Fly.io or AWS App Runner | One deploy for API and UI. |
| Tests | Vitest + `fast-check` (property tests) | Meets R12.8. |

Rejected:
- Serverless per step: more parts, harder to debug.
- Netlify/Vercel API per site: rate limits and account setup per site.
- Next.js: fine, but a separate API server keeps the pipeline clearer.

Fallback if AWS is a hassle: Cloudflare R2 + Pages for storage, and any hosted LLM API behind the same `llm` module.

## 2. Architecture

```
Browser (React) --POST /api/summons--> Fastify API --> job row (SQLite)
        ^                                   |
        | poll GET /api/summons/:id         v
        |                            Worker (in-process)
        |                      1 lookup -> 2 fetch -> 3 repair
        |                      -> 4 ai-fill -> 5 build -> 6 deploy
        |                          |                       |
        |                    Wayback queue          R2 bucket <- sites Worker
        |                  (cache, 1 req/s)         <worker>.workers.dev/sites/<id>/
        +---- reveal: iframe(archive snapshot) | iframe(resurrected URL)
```

Each pipeline step is a pure function over a job context where possible, so it can be tested without network.

## 3. Pipeline modules

| Module | Job | Req |
|---|---|---|
| `url-guard` | Validate URL, block private/loopback IPs, re-check on redirects | R1, R11 |
| `wayback` | Availability + CDX lookup, `id_` fetch, queue, cache, backoff | R2, R3, R4 |
| `crawler` | Breadth-first same-host crawl to MAX_PAGES/MAX_DEPTH; skip login/payment | R3 |
| `repair` | Rewrite links and assets, placeholders, strip scripts, report | R5 |
| `sanitize` | Allow-list HTML sanitizer | R11.3 |
| `ai-fill` | Prompt LLM, validate output, wrap in marked elements | R6 |
| `build` | Inject banner, write static files, report page | R7 |
| `deploy` | Upload folder to S3, return URL | R8 |
| `jobs` | State machine, progress events, persistence | R9 |

### Snapshot choice
CDX query: `filter=statuscode:200`, `filter=mimetype:text/html`, `collapse=digest`, `limit` small. Pick the newest. Fall back to availability API, then to redirects.

### Repair rules
- Link to page we recovered: rewrite to relative path `/<slug>.html`.
- Link to page we did not recover: `href="#lost"` plus a `data-lost` marker and a styled "lost page" tag.
- Asset: try `web.archive.org/web/<ts>id_/<url>`. Download if under 2 MB. If missing, insert a labeled placeholder box.
- Remove `<script>`, event handlers, `javascript:` URLs, iframes, trackers.
- Original CSS is kept but scoped so it cannot hide the banner (banner lives in a shadow-DOM-free fixed element with `!important` styles and an inline `<style>` loaded last).

### AI fill
- Input: one page's repaired HTML plus a list of gaps (broken tags, empty regions, placeholder images). Size capped.
- The LLM returns JSON patches, not full HTML: `{ selector, kind, text, reason }`.
- Server validates each patch: selector exists, text length limit, no new URLs, no new names or numbers not found in the page (cheap check, flags suspicious patches and drops them).
- Applied patches are wrapped in `<span class="ai-restored" data-reason="...">`, styled with a visible dotted outline and a legend.
- "What was lost" note: separate LLM call on the report counts and gap list. Shown in report and on a page `/_lost.html`.
- If the LLM fails: skip, set `aiSkipped: true` in the report.

### Banner (R7)
Fixed top bar on every page: "Reconstruction of the Wayback Machine snapshot of `<url>` from `<date>`. [View original snapshot] [About this resurrection]". Original-page link is per page.

## 4. Data model (SQLite)

```
jobs(id, status, step, input_url, snapshot_ts, snapshot_url,
     site_id, site_url, report_json, error_code, created_at, updated_at, client_hash)
wayback_cache(key, body_path, status, content_type, fetched_at)   -- key = url + ts
sites(site_id, input_url, snapshot_ts, deploy_url, expires_at, pinned)
```
`site_id` = random 12-char id (R8.5). Reuse check: lookup by `input_url + snapshot_ts` (R8.3).

## 5. API contract

Base path `/api`. JSON. Errors use one shape:
```json
{ "error": { "code": "NO_SNAPSHOT", "message": "plain text", "spooky": "The spirits are silent." } }
```

### POST /api/summons
Request: `{ "url": "http://example.com/old" }`
- 202: `{ "jobId": "j_abc123" }`
- 400 `INVALID_URL`, 422 `UNSUPPORTED_TARGET`, 429 `RATE_LIMITED`, 409 `JOB_ACTIVE`

### GET /api/summons/:jobId
```json
{
  "jobId": "j_abc123",
  "status": "queued | running | done | failed",
  "step": "lookup | fetch | repair | aifill | build | deploy",
  "steps": [{ "name": "lookup", "state": "done|active|pending|failed", "detail": "Snapshot 2003-04-12" }],
  "snapshot": { "timestamp": "20030412101500", "date": "2003-04-12", "archiveUrl": "https://web.archive.org/web/20030412101500/http://example.com/old" },
  "result": {
    "siteUrl": "https://sites.example.app/k3x9f2m1q0ab/",
    "beforeUrl": "https://web.archive.org/web/20030412101500/http://example.com/old",
    "downloadUrl": "/api/summons/j_abc123/download",
    "lostNote": "Short plain text.",
    "report": {
      "pagesFound": 12, "pagesRecovered": 9,
      "assetsFound": 40, "assetsRecovered": 31,
      "aiRestoredItems": 6, "aiSkipped": false,
      "lostPages": ["/guestbook.html"], "lostAssets": ["/img/bg.gif"]
    }
  },
  "error": null
}
```
`result` is null until `done`. `error` is the error shape above when `failed`.

### GET /api/summons/:jobId/events (optional)
Server-sent events with the same body as above on each change. The UI polls every 1.5 s if SSE is not available.

### GET /api/summons/:jobId/download
Zip of the built site. Works even if deploy failed (R10.4).

### GET /api/examples
`[{ "url": "...", "title": "...", "siteUrl": "...", "snapshotDate": "..." }]`. Pre-cached demo sites (R2 decision).

### DELETE /api/sites/:siteId
Takedown. Needs an admin token header. Also reachable by the contact email flow (manual for MVP).

### Error codes
`INVALID_URL`, `UNSUPPORTED_TARGET`, `NO_SNAPSHOT`, `ARCHIVE_TIMEOUT`, `ARCHIVE_RATE_LIMITED`, `RATE_LIMITED`, `JOB_ACTIVE`, `DEPLOY_FAILED`, `INTERNAL`.

## 6. Frontend

Screens: Summon (input + examples), Séance (progress), Reveal (before/after), Silence (error).
- Reveal: two iframes side by side (phone: tabs). Left is the raw archive snapshot with its toolbar. Right is the resurrected URL. A slider or toggle is a stretch goal.
- Progress lines use the names in `tone.md`.
- Reduced motion: no animation, same text.

## 7. Safety and limits
- SSRF: resolve DNS and check IP before every fetch, and on every redirect hop.
- Per-IP limit: 3 summons per hour, 1 active job. Hash IP, do not store raw.
- Size limits: page 1 MB, asset 2 MB, site 25 MB, LLM input 20k tokens per page.
- Secrets in env: `AWS_*`, `ADMIN_TOKEN`. Never logged.
- Resurrected sites are on a separate domain from the app (no cookie sharing).

## 8. Testing
- Unit: each module with fixture HTML.
- Property tests (`fast-check`): link rewriter (never leaves an off-site or archive-rewritten link; idempotent), sanitizer (output contains no script, no `on*`, no `javascript:` for any input), URL guard (never allows private IPs for generated hostnames and IPs).
- Golden test: one saved snapshot goes through the pipeline offline and matches a stored output.
- Wayback is mocked in tests. One manual smoke test hits the real archive.

## 9. Kiro usage plan (for the write-up)
- Steering: `product.md`, `tech.md`, `tone.md`.
- Specs: this spec, then one small spec per large feature (ai-fill, reveal UI).
- Hooks (in `.kiro/hooks/`): on save of `src/**/*.ts` run lint + related tests; on change of `requirements.md` remind to update tasks; before commit check `.kiro` is not ignored.
- PBT: as in section 8.
- MCP/powers: decide after checking what is available for GitHub and AWS.
- Keep `docs/kiro-writeup.md` updated at the end of each work day.

## 10. Risks
| Risk | Answer |
|---|---|
| Wayback slow or down in demo | Pre-cached example sites (R2 decision). |
| LLM invents facts | JSON patches, validation, visible marks, drop suspicious ones. |
| Cost | Per-page and per-job caps, per-IP limit. |
| Abuse (phishing copies) | Banner, takedown, no login/payment pages, per-IP limit. |
| Scope creep | MVP = one site end to end first (see tasks). |

## 11. Decision log: S3 + CloudFront replaced by R2 + Worker (2026-11-21)

Why: creating the CloudFront distribution failed with "Your account must be verified before you can add new CloudFront resources" (AWS Support case needed, unknown wait). R2 + a Worker gives the same result with no block.

| Concern | S3 + CloudFront (planned) | R2 + Worker (built) |
|---|---|---|
| Storage | Private S3 bucket | R2 bucket `dead-link-seance-sites` (APAC) |
| Serving | CloudFront + OAC | Worker `dead-link-seance-sites` with an R2 binding |
| Folder URL to index.html | CloudFront Function | Worker `keyFor()` |
| No-scripts headers | Response headers policy | Worker `SECURITY_HEADERS` (same CSP) |
| 30-day expiry | S3 lifecycle on `sites/` | R2 lifecycle on `sites/` (`infra/r2-lifecycle.json`) |
| Upload from app | AWS SDK S3 client | Same `S3Deployer`, `DEPLOY_S3_ENDPOINT` set to the R2 S3 endpoint |
| Public URL | `https://<dist>.cloudfront.net/sites/<id>/` | `https://dead-link-seance-sites.<subdomain>.workers.dev/sites/<id>/` |

Free tier limits checked 2026-11-21 ([R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)): 10 GB storage, 1M writes and 10M reads per month, free egress; Workers 100k requests per day, 10 ms CPU per request. Risk: past 100k requests a day the Worker returns error 1027 until midnight UTC.

Config:
- Worker: `apps/sites-worker` (`cloudflare.config.ts`, deployed with `cf deploy`; cf 1.0.0-rc.2, Node 26).
- App env (`apps/server/.env`, git-ignored; see `.env.example`): `DEPLOY_BUCKET`, `DEPLOY_S3_ENDPOINT`, `DEPLOY_BASE_URL`, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` = an R2 token scoped to this bucket.
- `infra/sites.yaml` (CloudFormation) is kept only as a fallback; it is not deployed.

Still open: app hosting (task 5.2) and the runtime LLM (task 3.1) still name AWS. Re-decide both before those tasks.

## 12. Decision log: AI on Cloudflare Workers AI (2026-11-21)

Why: same account as R2, no new vendor, and Bedrock sits on the AWS account that already blocked CloudFront.
Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, which supports JSON mode and is available on the Workers Free plan.
Limits checked 2026-11-21 ([pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)): 10,000 free Neurons per day, reset 00:00 UTC; this model costs about 26,668 Neurons per M input tokens and 204,805 per M output tokens. One caption call (about 2k tokens in, 300 out) is roughly 115 Neurons, so the free allowance covers roughly 80 calls a day.

What AI does, and what it may not do:
| Part | AI role | Guard |
|---|---|---|
| Lost image boxes | Short "AI guess" caption from alt text, file name, nearby words | `validatePatch`: no new numbers, no capitalized word (name/place) missing from the source, no links/markup, 3 to 160 chars. Dropped patches are counted and reported. |
| "What was lost" note | Rewords a plain note built from facts | Same check per sentence, no new numbers, every "X of Y" must be one of ours. Else the plain note is used. |
| Cut-off pages | None | A plain notice "The archived copy of this page ends here." |
| Missing text | None (not in MVP) | The model never writes page content. |

Marking: AI text sits in `span.ai-restored[data-seance-ai]`, dotted outline, prefixed "AI guess:", with a title tooltip. Any page with AI text gets a legend line in its banner. `_lost.html` labels an AI-worded note.

Cost controls: `MAX_AI_PAGES` (5) pages per site, `MAX_GAPS_PER_PAGE` (8), `AI_CALLS_PER_DAY` (30) in-process budget, and a disk cache of answers so rebuilds and demo reruns are free.
Failure: any AI error stops further AI calls for that job; the site is still built, with `aiSkipped` and a plain reason in the report.
Config (env or `apps/server/.env`): `CF_ACCOUNT_ID`, `CF_AI_TOKEN` (a Workers AI token, not the R2 key), optional `CF_AI_MODEL`. Without them AI is off.
