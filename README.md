# Dead Link Séance (working title)

Paste the URL of a dead website. The app summons it from the Internet Archive's Wayback Machine
and returns a live, shareable, static copy. Every page carries a banner crediting the snapshot.
Anything written by AI is visibly marked.

Kiroween 2026, Resurrection category.

- Live URL: _TBD_
- Demo video: _TBD_
- Examples that resurrect well: _TBD_

## Run locally
```
npm install
npm run dev
```
Then open the server's `/health` route.

## Layout
- `apps/server`: API and pipeline
- `apps/web`: séance UI
- `packages/shared`: API types
- `.kiro/`: specs, steering, hooks
- `docs/kiro-writeup.md`: how Kiro was used

## License
MIT
