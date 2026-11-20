# Wazir website

One-stop site for chess.com players: engine game review, stats & progress, and a monthly / yearly Chess Wrapped.
Everything runs in the browser. There is no backend: the site calls the chess.com Published-Data API directly
(it sends `Access-Control-Allow-Origin: *`) and runs Stockfish 19 as WebAssembly on the visitor's machine.

## Features

| Route | What it does |
| --- | --- |
| `/review` | Load a game by chess.com link + username, or paste a PGN |
| `/review/:username/:gameId` | Full review: accuracy, move classifications, eval graph, best lines, explorable board |
| `/player/:username` | Ratings, rating history, monthly trends, openings, color / opponent / time-of-day splits, all games |
| `/wrapped/:username/:YYYY-MM` | Monthly Wrapped (story slides, downloadable share image) |
| `/wrapped/:username/:YYYY` | Yearly Wrapped |
| `/privacy` | Privacy policy (also at `/#privacy`, which the Chrome Web Store listing uses) |

## Engine and accuracy

- **Engine:** Stockfish 19 full NNUE (`stockfish` npm package), multi-threaded when the page is cross-origin isolated,
  single-threaded otherwise. A Lite build is offered for slow connections and is the default on phones.
- **Depth presets:** Fast 14 · Standard 18 · Deep 22 (default on desktop) · Maximum 28, MultiPV 3.
- **Accuracy:** evals → win% → per-move accuracy, combined per game with a volatility-weighted mean and a harmonic mean
  (`src/lib/accuracy.ts`). Parameters are fitted against chess.com's own published accuracies, see
  `tests/collect.test.ts`.
- **Classifications:** chess.com's published expected-points thresholds, plus Brilliant (sound piece sacrifice), Great
  (only good move), Miss (failed to punish), Book (lichess CC0 opening DB, `npm run openings`), Forced.
- Finished reviews and completed months of games are cached in IndexedDB.

## Develop

```bash
npm install          # also copies the engine into public/engine (git-ignored, ~200 MB)
npm run dev          # http://localhost:5173 (sends the COOP/COEP headers)
npm test             # unit tests
npm run build        # dist/
```

## Deploy

The site is static (`dist/`), but it needs two things from the host:

1. **Headers for multi-threading** (already in `public/_headers` for Cloudflare Pages / Netlify):
   `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`.
   Without them the engine still works, just single-threaded (several times slower). Safari doesn't support
   `credentialless` yet, so Safari users get the single-threaded engine.
2. **SPA fallback** to `index.html` (`public/_redirects`).

**Large engine files:** `stockfish-19.wasm` and `stockfish-19-single.wasm` are ~99 MB each. Cloudflare Pages rejects
files over 25 MiB, so on Pages upload `public/engine/*.wasm` to an R2 bucket (or any CDN) that serves them with
`Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin`, then build with
`VITE_ENGINE_WASM_BASE=https://your-bucket.example.com/engine/`. Hosts without that limit (Netlify, Vercel, your own
server) can serve everything from `dist/`.

## Credits

Stockfish (GPL-3.0) via stockfish.js · cburnett pieces (CC BY-SA 3.0) · lichess-org/chess-openings (CC0) · chess.js ·
Recharts. Not affiliated with Chess.com.
