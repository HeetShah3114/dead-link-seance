# How we used Kiro

Running notes. Update at the end of each work day. Turned into the final write-up in task 5.5.

## Products used
- Kiro Crew: _what we did here, what differed_
- IDE / CLI / Web: _..._

## Spec-driven development
- Spec: `.kiro/specs/resurrection-mvp/` (requirements, design, tasks).
- Day 0: wrote requirements first, reviewed, then design, then tasks. _What this saved vs vibe coding: ..._

## Steering
- `product.md`, `tech.md`, `tone.md`. _What changed in the output because of them: ..._

## Hooks
- Lint + test on save. Spec change checks tasks. Guard so `.kiro` is never ignored.
- _Real examples of a hook catching something: ..._

## Property-based testing
- Link rewriter, HTML sanitizer, URL guard. _Bugs found: ..._

## MCP / powers / custom agents
- _..._

## Log
- Day 0: scaffold, hooks, steering, spec.
- Phase 2 (real pipeline): crawler, full repair, allow-list sanitizer, limits, reuse, golden test.
  - The golden test caught a real bug on first run: on GeoCities, "same host" pulled in other people's
    pages (`/~stacy/login.html`). Fixed by scoping a site to the start page's folder; spec R3.2 updated.
  - Property tests (fast-check): link rewriter never leaves a live off-site or archive-rewritten link and
    is idempotent; sanitizer never lets a script, handler or javascript: URL through; URL guard rejects every
    private IPv4 spelling.
  - Real run: geocities.com/Hollywood/Hills/2000/ (2001 snapshot) -> 2 of 4 pages, 8 of 17 images, 41 s.
- Phase 3 (AI gap-filling on Workers AI): the model never writes HTML or page text. It only captions lost
  images and rewords a fact-built "what was lost" note; a fact checker drops anything with a new name,
  place or number. Every AI word is marked "AI guess" with a dotted outline and a banner legend.
  - Property test win #2: after the AI work, a new random seed made the sanitizer property test fail on
    `<img href="data:text/html,...">`. Not exploitable (img ignores href), but looser than the allow-list
    intended. Fixed (data: only in img src) and pinned with a regression test.
  - Property test on the fact checker: a kept caption never holds a number or capitalized word missing
    from the source.
