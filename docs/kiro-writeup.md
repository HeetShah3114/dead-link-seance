# How we used Kiro

Draft for the Devpost write-up (task 5.5). Lines marked **TODO** need our own words before submitting.

## In numbers

| | |
|---|---|
| Build time so far | 5 days (2026-11-18 to 2026-11-22) |
| Commits | 64, one per task step |
| Spec tasks done | 37 of 43 |
| Tests | 160 (unit, property-based, golden end-to-end) |
| Requirements changed by what we learned | 5 (R2.5, R3.2, R5.7, R6.1, R11.2) |

## Kiro products

- **Kiro Crew** ran the whole build as one long agent session: spec, code, tests, real runs against the
  Wayback Machine, Cloudflare deploys and the AI eval. Crew's memory and lessons kept rules alive across
  days (for example "always run the build to verify, even when memory is low").
- **TODO:** Kiro IDE / CLI, if we used them, and how they differed.

## Spec-driven development

The spec lives in `.kiro/specs/resurrection-mvp/`:

1. `requirements.md`: 12 user stories with EARS acceptance criteria (WHEN / IF / THE SYSTEM SHALL).
2. `design.md`: stack, API contract, data model, safety, and two decision logs.
3. `tasks.md`: ordered so one site was resurrected end to end on day 1 (milestone 1, task 1.5) and
   shareable from a browser soon after (milestone 2, task 1.9).

Every commit names its task or requirement. When reality disagreed with the spec, we changed the spec
first, then the code:

| What we found | Spec change |
|---|---|
| The newest snapshot of xoom.com was a "site closed" page | R2.5: prefer the fullest copy, not the newest |
| Archived forms look alive but their servers are gone | R5.7: switch forms off, say so |
| On GeoCities, "same host" pulled in strangers' pages | R3.2: a site is the start page's folder |
| DNS checks would block real dead sites | R11.2: guard by archive allow-list instead |
| Real AI runs: captions on 1999 pages add little | R6.1: AI never writes page text |

Two infrastructure decisions were logged in `design.md` instead of silently swapped:
section 11 (AWS CloudFront blocked by account verification, moved to Cloudflare R2 + a Worker) and
section 12 (AI on Cloudflare Workers AI, with its limits and guards).

Compared to vibe coding: **TODO** one or two sentences in our own words.

## Steering

- `product.md`: hard rules every change had to keep: credit banner, AI always marked, polite to the
  archive, no login or payment pages, in-theme errors.
- `tech.md`: the stack and one-module-per-concern (one Wayback door, one LLM door). Updated each time
  a decision changed.
- `tone.md`: "theme the words, not the meaning". Every spooky line carries one plain fact. This is why
  each error screen has a themed heading, a plain reason and a next step.

## Hooks

`.kiro/hooks/`:
- `lint-and-test-on-save`: lint and run neighbouring tests when a source file is saved.
- `spec-change-sync-tasks`: when requirements or design change, check `tasks.md` still matches.
- `guard-kiro-not-ignored`: when `.gitignore` changes, make sure `.kiro` is never ignored (a
  disqualification risk in the rules).

**TODO:** a real moment where a hook caught something, if it happened while we worked in the IDE.

## Property-based testing (fast-check)

| Property | What it caught |
|---|---|
| Sanitizer: no script, handler or `javascript:` survives any mix of hostile fragments | A new random seed found `<img href="data:text/html,...">` slipping through. Fixed, regression test added. |
| Link rewriter: never leaves a live off-site or archive-rewritten link; rewriting twice changes nothing | Held from the start; guards the repair code against later edits |
| URL guard: every private IPv4, in dotted, integer or hex form, is refused | Held; covers `2130706433`, `0x7f.1`, `[::ffff:127.0.0.1]` |
| AI fact check: a kept caption never has a number or capitalized word missing from the source | Held; then the real eval found invented lower-case details, so we tightened it further |
| Snapshot choice: the pick is always a 200 HTML copy, and no newer one qualifies | Held |

The golden test (a made-up GeoCities fixture through the whole pipeline) caught the "strangers' pages"
bug on its first run.

## AI, honestly

The app uses Workers AI (`llama-3.3-70b-instruct-fp8-fast`) only to caption lost images and to reword a
"what was lost" note built from facts. A fact checker drops anything with a name, place or number not on
the page. We ran it on 5 real GeoCities sites (`docs/ai-eval.md`): two rounds found 6 problems, including
an invented "heart shaped" button. After fixes, the final run had no invented facts. Captions rarely
survive on 1999 pages (no alt text); the fact-checked note is the useful part.

## MCP, skills and tools

- **AWS Agent Toolkit** skills guided the first deploy attempt (CloudFormation, S3, CloudFront). The
  template validated; CloudFront was blocked by account verification, and the skills' rules on free-plan
  limits made the reason clear fast.
- **Cloudflare skills** (`cf-cli`, Workers best practices) drove the switch: R2 bucket and lifecycle via
  `cf r2`, the Worker via `cf deploy`, Workers AI limits from the docs.
- **TODO:** any Kiro powers we used.

## Safety we built in

SSRF guard with an archive-only allow-list checked on every redirect hop; allow-list HTML sanitizer;
`script-src 'none'` on every resurrected page; sandboxed iframes; per-client limits; hashed IPs; secrets
only in a git-ignored `.env`; constant-time admin token for takedown.
