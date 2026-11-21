# AI eval (task 3.7), 2026-11-21

Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` on Workers AI. Limits: 5 pages and 25 assets per site.
Script: `apps/server/scripts/ai-eval.ts` prints every AI text beside the alt text and file name it came from.
Checked by eye against the reports below.

## Result: no invented facts in the final run

| Site (snapshot) | Pages | Images | AI captions kept | Lost note | Facts in note correct? |
|---|---|---|---|---|---|
| geocities.com/Hollywood/Hills/2000/ (2001-05-21) | 2/4 | 8/17 | 1 of 8 | AI-worded | Yes |
| geocities.com/Hollywood/Hills/ (1999-02-20) | 1/1 | 17/18 | 0 of 1 | AI-worded | Yes |
| geocities.com/SiliconValley/Lakes/ (1999-02-08) | 1/1 | 18/18 | none needed | AI-worded | Yes |
| geocities.com/Hollywood/Hills/2112/ (2002-06-06) | 1/6 | 0/7 | 0 of 6 | AI-worded | Yes |
| geocities.com/Area51/ (1999-02-23) | 5/122 | 25/45 | none needed | Plain (AI rewording rejected) | Yes |

## Found and fixed during the eval

| Run | Problem | Fix |
|---|---|---|
| 1 | Caption "heart shaped button" from alt "Lovers Lane" + `ll_buttonm.gif`. "heart shaped" was invented; the check only caught capitalized words and numbers. | `validateCaption`: every word must come from the source or a short list of generic image words. Prompt bans colors, shapes and details. |
| 1 | Plain note listed `"[image lost]"` as a lost page name (a lost link that wrapped a lost image). | Placeholder text is stripped before reading link text. |
| 1 | "2 forms no longer work, because the server behind it is gone." | Plural pronoun. |
| 2 | Captions became "image", "icon", "button": honest but empty. | A caption must hold at least one word from the source. |
| 2 | The "X of Y" swap check missed "2 of its 4 pages". | Up to two words allowed between "of" and the number. |
| 2 | A tracking pixel with alt="1" was named as a lost image. | Lost image names need 3 or more letters. |

## Takeaways

- Most 1999 to 2002 personal pages had no alt text, so the model has almost nothing to caption from. After the stricter checks, 1 of 15 captions survived ("city image" from `cityair.jpg`). The value is in the honest "[image lost]" box, not the caption.
- The AI-worded lost note is the part worth keeping. It passed the fact check in 4 of 5 sites and every fact in it was correct.
- The site check rejects rather than repairs: any doubtful AI text falls back to plain text. That trade is deliberate (R6.3).
- Neighborhood index pages (Area51) find 100+ member sites in scope; users should paste a personal page address. Noted for the UI hint (task 4.1).
- Cost: about 30 calls for the three runs, well inside the free 10,000 Neurons per day. Reruns hit the cache.
