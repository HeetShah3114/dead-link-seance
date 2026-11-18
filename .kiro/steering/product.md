---
inclusion: always
---
# Product: Dead Link Séance (working title)

Kiroween 2026, Resurrection category. New project. 2 people, ~2.5 weeks.
Deliverables: public GitHub repo with `.kiro/`, live URL, short demo video.

## What it does
User pastes the URL of a dead site. The app finds the best Wayback Machine snapshot,
fetches the raw HTML (`id_` flag) and same-site pages, repairs links and assets,
uses an LLM to fill gaps (clearly marked), builds a static site, deploys it,
and returns a share link. The reveal is a before/after comparison.

## Scope
- In: static, text-heavy pages (GeoCities-era personal pages, old TV recap sites).
- Out: JS-heavy apps, Flash, login flows, payment flows.

## Hard rules
- Every resurrected page shows a banner: link to the Wayback snapshot, snapshot date,
  and the words "this is a reconstruction".
- AI-written content is always marked visibly. Never silently invent content.
- Respect Wayback: descriptive User-Agent, cache snapshots, queue requests, back off on 429/5xx.
- Never resurrect login or payment pages.
- Failures (no snapshot, timeout, rate limit) show an in-theme message, never a raw error.
