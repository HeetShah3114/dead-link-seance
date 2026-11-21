# Requirements: Resurrection MVP

Format: user story, then acceptance criteria in EARS style (WHEN / IF / THE SYSTEM SHALL).

## R1. Summon a site
As a visitor, I paste a dead URL so the app can resurrect it.
1. WHEN the user submits a URL, THE SYSTEM SHALL validate it as http(s) with a public host.
2. IF the URL is invalid or points to a private/loopback address, THEN THE SYSTEM SHALL reject it with an in-theme message and not call any external service.
3. WHEN a valid URL is accepted, THE SYSTEM SHALL create a job and return a job id.
4. THE SYSTEM SHALL accept one active job per client at a time.

## R2. Find the best snapshot
As a visitor, I want the best available archived copy used.
1. WHEN a job starts, THE SYSTEM SHALL query the Wayback availability API and the CDX API for the URL.
2. THE SYSTEM SHALL prefer the newest snapshot with HTTP 200 and an HTML mime type.
3. IF no 200 snapshot exists, THEN THE SYSTEM SHALL fall back to the newest redirect-resolved snapshot, else fail with "no snapshot found".
4. THE SYSTEM SHALL record the chosen snapshot timestamp and its archive URL on the job.
5. THE SYSTEM SHALL prefer a full copy of the site over a newer, much smaller one (such as a "site closed" or parked-domain page): among 200 HTML snapshots, keep those at least 60% as large as the largest, then take the newest.

## R3. Fetch the remains
As a visitor, I want the original pages, not the archive's rewritten ones.
1. THE SYSTEM SHALL fetch HTML using the `id_` URL form so no toolbar or rewritten links are returned.
2. THE SYSTEM SHALL also fetch same-site pages linked from the start page, up to configured MAX_PAGES and MAX_DEPTH (defaults: 15 pages, depth 2). "Same site" means the same host AND under the start page's folder, because on shared hosts (GeoCities, Angelfire, Tripod) other folders are other people's sites; links there are treated as off-site.
3. THE SYSTEM SHALL fetch each page at the snapshot closest to the chosen timestamp.
4. THE SYSTEM SHALL skip off-site links, and skip pages that look like login or payment flows (form with password field, URL paths like login, checkout, cart, pay).
5. THE SYSTEM SHALL record every skipped or failed page and the reason.

## R4. Respect the archive
As the maintainer, I want to be a good citizen of archive.org.
1. THE SYSTEM SHALL send a descriptive User-Agent with project name and contact URL on every Wayback request.
2. THE SYSTEM SHALL send Wayback requests through one queue with a configurable rate (default: at most 1 request per second).
3. THE SYSTEM SHALL cache snapshot lookups and fetched bodies, keyed by URL and timestamp, so a repeat summon makes no new archive requests.
4. WHEN Wayback returns 429 or 5xx, THE SYSTEM SHALL retry with exponential backoff up to a fixed limit, then fail the job with a rate-limit message.

## R5. Repair what the archive lost
As a visitor, I want the site to work as a site.
1. THE SYSTEM SHALL rewrite internal links to point at the resurrected copies of those pages.
2. WHERE a linked page was not recovered, THE SYSTEM SHALL replace the link with a marked "lost page" target and list it in the report.
3. THE SYSTEM SHALL point images, CSS and other assets at archived copies (id_ form for the same timestamp) where they exist, and download them into the output where the file size is within a limit.
4. WHERE an asset is missing, THE SYSTEM SHALL insert a visible placeholder and list the asset in the report.
5. THE SYSTEM SHALL strip scripts, trackers, ad embeds and third-party iframes from the output.
6. THE SYSTEM SHALL produce a report with counts: pages found, pages recovered, assets found, assets recovered, items AI-restored, forms disabled.
7. THE SYSTEM SHALL switch off every form (no action, all fields disabled) and show a visible note that the form no longer works, because the archive saves pages, not the servers behind them.

## R6. AI gap-filling, never silent
As a visitor, I want holes filled honestly.
1. WHERE a page has missing text, broken layout, or missing-image placeholders, THE SYSTEM SHALL ask an LLM to propose a repair.
2. THE SYSTEM SHALL wrap every AI-written or AI-altered element in markup that is visibly styled and labeled "AI-restored", with a tooltip or note explaining what was done.
3. THE SYSTEM SHALL NOT let the LLM add facts, names, dates or quotes that have no basis in recovered content. Where there is no basis, it SHALL leave a marked gap instead.
4. THE SYSTEM SHALL generate one short "what was lost" note per site, shown in the report and on the site.
5. IF the LLM call fails or times out, THEN THE SYSTEM SHALL finish the job without AI repairs and say so in the report.
6. THE SYSTEM SHALL cap LLM input and output size per page and per job.

## R7. Credit the archive
As the archive and the original author, I want to be credited.
1. THE SYSTEM SHALL insert a visible banner on every resurrected page.
2. THE banner SHALL contain: a link to the Wayback snapshot, the snapshot date, and the words "this is a reconstruction".
3. THE banner SHALL not be removable by page CSS from the original site.
4. THE SYSTEM SHALL add a link to the original page's snapshot on each page, not only on the home page.

## R8. Build and deploy
As a visitor, I want a link I can share.
1. THE SYSTEM SHALL output a self-contained static site (HTML, CSS, assets).
2. THE SYSTEM SHALL deploy the site automatically and return a public HTTPS URL.
3. WHEN the same URL and snapshot are summoned again, THE SYSTEM SHALL reuse the existing deployment.
4. THE SYSTEM SHALL keep the deployed site reachable for at least the length of the hackathon judging period.
5. THE deployed URL SHALL be unique per snapshot and not guessable from other users' URLs.

## R9. The séance experience
As a visitor, I want a spooky but readable experience.
1. THE SYSTEM SHALL show live progress, one status line per pipeline step (lookup, fetch, repair, AI fill, deploy).
2. THE SYSTEM SHALL show progress by polling or streaming the job status, with no page reload.
3. WHEN a job finishes, THE SYSTEM SHALL show a before/after reveal: the raw archive snapshot beside the resurrected page.
4. THE reveal SHALL include the share link, a copy button, the report, and the "what was lost" note.
5. THE UI SHALL meet WCAG AA text contrast, work by keyboard, and respect `prefers-reduced-motion`.
6. THE UI SHALL work on a phone-width screen.

## R10. Fail with grace
As a visitor, I want a clear message when it breaks.
1. IF no snapshot exists, THEN THE SYSTEM SHALL show an in-theme message ("the spirits are silent") plus a plain line saying no archived copy was found.
2. IF the archive times out or rate-limits, THEN THE SYSTEM SHALL show an in-theme message plus a plain line saying to retry later.
3. IF the target looks unsupported (JS app, Flash, login wall), THEN THE SYSTEM SHALL say so and, where possible, resurrect what is recoverable.
4. IF deploy fails, THEN THE SYSTEM SHALL still offer the built site as a download.
5. THE SYSTEM SHALL never show stack traces or raw upstream errors to the user.
6. THE SYSTEM SHALL log each failure with the job id and step.

## R11. Abuse and safety
As the maintainer, I want to avoid harm.
1. THE SYSTEM SHALL rate-limit summons per client.
2. THE SYSTEM SHALL refuse user URLs that name private, loopback, link-local or local-only targets (in any IP spelling), and SHALL send outbound requests only to allow-listed archive hosts over https, checking every redirect hop (SSRF). The user's own host is never fetched or DNS-resolved, because dead sites usually no longer resolve.
3. THE SYSTEM SHALL sanitize archived HTML before output (no scripts, no inline event handlers, no `javascript:` URLs).
4. THE SYSTEM SHALL provide a takedown contact on every page and a way to remove a deployed site.

## R12. Hackathon deliverables (from the official Requirements tab)
1. THE REPO SHALL be public on GitHub, with an open source license file that GitHub detects and shows in the About section.
2. THE REPO SHALL hold all source, assets and setup instructions needed to run the project.
3. THE REPO SHALL contain `/.kiro` at the root, with specs, hooks and steering. `.gitignore` SHALL NOT list `.kiro` or any folder in it (this can disqualify the entry).
4. THE REPO SHALL include at least one hook (for example: on save, run lint/tests; on spec change, check tasks).
5. THE README SHALL list the live URL, setup steps and three example URLs that resurrect well.
6. THE PROJECT SHALL have a public YouTube demo video of 3 minutes or less, shown on the device it was built for, with no copyrighted music or third-party trademarks.
7. THE PROJECT SHALL include a "how Kiro was used" write-up covering: Kiro product used (IDE, CLI, Web, Crew), custom agents, hooks, spec-driven vs vibe coding, steering, MCP, property-based testing, and powers. Notes for it are kept in `docs/kiro-writeup.md` as we build.
8. THE PROJECT SHALL use property-based tests for at least the link rewriter and the HTML sanitizer.
9. THE PROJECT SHALL use at least one MCP server or Kiro power, if it helps the build (decided in design).

## Out of scope (MVP)
JS-heavy apps, Flash, login and payment flows, accounts, editing a resurrected site, custom domains.

## Decisions so far
1. Retention: default 30 days. Demo sites are kept for good. (Assumed, change if you disagree.)
2. Demo sites are cached ahead of time, so the demo never depends on live Wayback.
3. Runtime LLM: Kiro is used to BUILD the project. Which LLM runs inside the deployed app is decided in design.md (a deployed app cannot call a local Kiro Crew).
4. Public service with no login. Per-IP rate limit only.
