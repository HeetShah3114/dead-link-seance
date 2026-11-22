# Tasks: Resurrection MVP

Order: a thin end-to-end slice first (Phase 1), then harden, then polish.
Each task ends with something runnable. `[A]` / `[B]` = suggested owner (2 people). Req refs in brackets.
Days assume ~2.5 weeks.

## Phase 0: Setup (Day 1)
- [x] 0.1 [A] Create GitHub repo, MIT license, README stub, `.gitignore` that does NOT list `.kiro`. [R12.1, R12.3]
- [x] 0.2 [A] Scaffold TypeScript monorepo: `apps/server`, `apps/web`, `packages/shared` (API types). Add lint, Vitest, `fast-check`. [design 1]
- [x] 0.3 [B] Write hooks in `.kiro/hooks/`: on save run lint + related tests; on `requirements.md` change remind to update tasks; pre-commit check `.kiro` not ignored. [R12.4]
- [x] 0.4 [B] Update `tech.md` with the approved stack. Start `docs/kiro-writeup.md`. [R12.7]
- [x] 0.5 [A] Add a `/health` route and a one-command local run (`npm run dev`). Verify.

## Phase 1: One site, end to end, ugly is fine (Days 2 to 5)
- [x] 1.1 [A] `wayback` client: availability + CDX lookup, pick newest 200 HTML snapshot. Hard-code User-Agent and 1 req/s queue. Test against saved fixtures. [R2, R4.1, R4.2]
- [x] 1.2 [A] `id_` fetch of one page, with disk cache keyed by url+timestamp. [R3.1, R4.3]
- [x] 1.3 [B] `repair` v0: strip scripts, rewrite asset URLs to archived `id_` URLs (no download yet). [R5.3, R5.5]
- [x] 1.4 [B] `build` v0: inject the banner, write `index.html` to a local folder. [R7]
- [x] 1.5 [A] CLI: `npm run resurrect -- <url>` writes a folder. Check by hand on one GeoCities-style page. **Milestone 1: one page resurrected locally.**
- [x] 1.6 [A] Jobs table + `POST /api/summons` and `GET /api/summons/:id` (steps and result, no AI yet). Serve the output folder locally. [R1, API]
- [x] 1.7 [B] Web v0: input box, progress list from polling, link to result. Plain styling. [R9.1, R9.2]
- [x] 1.8 [A] `deploy` v0: upload folder to R2, served by a Cloudflare Worker, return URL. [R8.1, R8.2] (Switched from S3 + CloudFront: CloudFront needs AWS account verification.)
- [x] 1.9 [A+B] Run the full flow on the live URL for one site. **Milestone 2: shareable link from the browser.**

## Phase 2: Real pipeline (Days 6 to 9)
- [x] 2.1 [A] `crawler`: same-site crawl to MAX_PAGES/MAX_DEPTH, skip login/payment pages, record skipped. [R3.2 to R3.5] (Site = start page's folder, so shared hosts stay one site.)
- [x] 2.2 [B] `repair` full: rewrite internal links, lost-page markers, download assets under size limit, placeholders, report counts. [R5]
- [x] 2.3 [B] Property tests: link rewriter never leaves off-site or archive-rewritten links, and is idempotent. [R12.8]
- [x] 2.4 [A] `sanitize` module (allow-list) plus property test: no script, no `on*`, no `javascript:` for any input. [R11.3, R12.8]
- [x] 2.5 [A] `url-guard` (SSRF, DNS check, redirect re-check) plus property test. [R1.2, R11.2]
- [x] 2.6 [A] Backoff on 429/5xx, timeouts, error codes mapped to the API error shape. [R4.4, R10] (Done in 1.1 and 1.6; asset step now degrades to archived links on rate limit instead of failing.)
- [x] 2.7 [B] Per-IP limit, one active job, size caps. [R1.4, R11.1, design 7]
- [x] 2.8 [B] Reuse existing deployment for same url+snapshot. [R8.3]
- [x] 2.9 Golden test: one saved snapshot through the whole pipeline offline. [design 8]

## Phase 3: AI gap-filling (Days 9 to 12)
- [x] 3.1 [A] `llm` module over Cloudflare Workers AI (swappable), size caps, timeout, disk cache, daily budget. [R6.6] (Switched from Bedrock; see design section 12.)
- [x] 3.2 [A] Gap detector: lost images with alt/file/nearby words; cut-off pages get a plain non-AI notice. [R6.1]
- [x] 3.3 [A] Patch prompt returns JSON patches; validator drops patches with new URLs, names or numbers not in the page. Property/unit tests. [R6.3]
- [x] 3.4 [B] Apply patches wrapped in `.ai-restored` with visible style and legend. [R6.2]
- [x] 3.5 [B] "What was lost" note and `/_lost.html` page. Note is always built from facts; AI may only reword it, and the rewording is fact-checked. [R6.4]
- [x] 3.6 [A] LLM failure path: finish without AI, report `aiSkipped` and the reason. [R6.5]
- [x] 3.7 Eval on 5 real sites: check by eye that no fact was invented. Log results in the write-up. (Done 2026-11-21, `apps/server/scripts/ai-eval.ts`; 3 fixes made, see `docs/ai-eval.md`.)

## Phase 4: Séance experience (Days 11 to 15, runs in parallel with Phase 3)
- [x] 4.1 [B] Spooky theme, readable (contrast AA, reduced motion), mobile layout. Follow `tone.md`. [R9.5, R9.6]
- [x] 4.2 [B] Themed progress lines mapped to the steps. [R9.1]
- [x] 4.3 [B] Reveal screen: before/after iframes, share link with copy button, report, lost note. [R9.3, R9.4]
- [x] 4.4 [B] Silence screen for each error code, in-theme plus a plain line. [R10]
- [x] 4.5 [A] `GET /api/examples` and an examples row on the home page. [API]
- [x] 4.6 [A] Download zip and takedown route (admin token) with contact line on each page. [R10.4, R11.4]

## Phase 5: Ship (Days 15 to 18)
- [x] 5.1 Pick and pre-cache 3 to 5 example sites that resurrect well. Pin them (no expiry). [Decision 2] (3 GeoCities sites under R2 pinned/, `apps/server/scripts/pin-examples.ts`.)
- [ ] 5.2 [A] Deploy the app container to the host. Set secrets in env. Retention job for 30-day expiry. [R8.4]
- [ ] 5.3 Full pass on the live URL: all error paths (no snapshot, timeout, bad URL). [R10]
- [ ] 5.4 README: live URL, setup, 3 example URLs. Confirm license shows in GitHub About. [R12.5, R12.1] PARTLY DONE: README written; live app URL and video link still TBD.
- [ ] 5.5 Finish `docs/kiro-writeup.md`: IDE/CLI/Crew use, hooks, specs vs vibe coding, steering, PBT, MCP/powers. [R12.7]
- [ ] 5.6 Record the demo (3 min max): bad snapshot, séance, reveal, share link, then `.kiro` tour. Upload public to YouTube. [R12.6]
- [ ] 5.7 Submit on Devpost: category Resurrection, repo URL, live URL, video, write-up. Check `.kiro` is committed.

## Cut list if time runs short (drop in this order)
1. Slider on the reveal screen.
2. SSE events (polling is enough).
3. Zip download.
4. Takedown route UI (keep the admin token route).
5. Pages beyond the start page (MAX_PAGES = 1 still meets the demo).
Never cut: banner, AI marks, SSRF guard, sanitizer, `.kiro` folder, license.
