# Dead Link Séance

Paste the address of a dead website. A circle of pixel-art vampires summons it from the
Internet Archive's Wayback Machine, repairs what the archive lost, and returns a live,
shareable copy. Then you see the broken archive snapshot beside the resurrected site.

Kiroween 2026, **Resurrection** category: bringing the 1990s personal web back to life.

- Live app: [dead-link-seance.onrender.com](https://dead-link-seance.onrender.com/)
- Demo video: _TBD_
- Resurrected examples (live now):
  - [A Hollywood Hills home page](https://dead-link-seance-sites.whoisheet.workers.dev/pinned/demohills200/) from `http://www.geocities.com/Hollywood/Hills/2000/` (2001)
  - [Silicon Valley: Lakes](https://dead-link-seance-sites.whoisheet.workers.dev/pinned/demosvlakes0/) from `http://www.geocities.com/SiliconValley/Lakes/` (1999)
  - [Hollywood: Hills](https://dead-link-seance-sites.whoisheet.workers.dev/pinned/demohillshub/) from `http://www.geocities.com/Hollywood/Hills/` (1999)

## What it does

| Step | What happens |
|---|---|
| Lookup | Finds the fullest recent snapshot (not just the newest, which is often a "site closed" page). |
| Fetch | Downloads the raw pages (`id_` URLs) of one person's site, up to 15 pages, plus images. Polite: 1 request/second, cached, descriptive User-Agent. |
| Repair | Links between pages point at the rebuilt copies. Lost pages and images are marked, not hidden. Scripts are stripped, forms are switched off with a note. |
| AI fill | Workers AI captions lost images and words a "what was lost" note. A fact checker drops any AI text with a name, place or number not on the page. Every AI word is marked "AI guess". |
| Build | Every page is sanitized against an allow-list and gets a banner crediting the snapshot. |
| Publish | Uploaded to Cloudflare R2 and served by a Worker with `script-src 'none'`. Sites expire after 30 days. |

Honest limits: the archive saved pages, not servers, so guestbooks, counters and search boxes
cannot work. JavaScript-heavy and Flash sites are out of scope.

## Run locally

Requires Node 26.

```
npm install
npm run dev                       # API on http://127.0.0.1:3000
npm run dev -w @seance/web        # UI on http://127.0.0.1:5173
```

Without any configuration, sites are served by the API itself and AI is off.
To publish to R2 and turn AI on, copy `apps/server/.env.example` to `apps/server/.env` and fill it in.

Command line, one site to a local folder:

```
npm run resurrect -- http://www.geocities.com/Hollywood/Hills/2000/
```

Checks:

```
npm test          # unit, property and golden tests
npm run lint
npm run build
```

## Layout

| Path | What |
|---|---|
| `apps/server` | API, pipeline, Wayback client, repair, sanitizer, AI, deploy |
| `apps/web` | Séance UI (React + Vite), pixel art in `public/art` |
| `apps/sites-worker` | Cloudflare Worker that serves resurrected sites from R2 |
| `apps/keepalive-worker` | Cron Worker that pings the Render app every 10 minutes so the free plan never sleeps |
| `packages/shared` | API types shared by server and UI |
| `infra/` | R2 lifecycle rule; unused CloudFront fallback template |
| `.kiro/` | Specs, steering and hooks used to build this with Kiro |
| `docs/` | How Kiro was used, AI eval results |

## Credits and takedown

Every resurrected page links to its original Wayback Machine snapshot. Content belongs to its
original authors; this is a reconstruction. To request removal, [open an issue](https://github.com/HeetShah3114/dead-link-seance/issues).
Snapshots come from the [Internet Archive](https://archive.org/), which we cache and query at 1 request per second.

## License

MIT
