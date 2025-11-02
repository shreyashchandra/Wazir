# Wazir — Chess.com Game Review (Local Stockfish)

Wazir is a privacy-first Chrome extension that analyzes your finished
Chess.com games locally with Stockfish 17.1 Lite. It fetches the PGN,
computes accuracy and ACPL, classifies each move, and includes a board
view with best-move arrows and MultiPV lines — all on your machine.

- Local engine: Stockfish 17.1 Lite (WASM, runs in the popup)
- PGN source: your local API or the open Chess.com game page
- No accounts. No cloud engine calls. Open source.

<p align="center">
  <img alt="Board view" src="docs/screenshot-board.png" width="720">
</p>

## Features

- One-click PGN fetch from the active Chess.com tab (or your local API)
- Strict PGN normalization (ordered tags, no clock comments, link with `?move=0`)
- Local Stockfish analysis (depth or movetime, MultiPV 1–3)
- Accuracy and ACPL per side, with move quality buckets:
  Best, Excellent, Great, Good, Book, Miss, Inaccuracy, Mistake, Blunder
- Board View
  - Canvas board with Chess.com-like colors and coordinates
  - Last-move highlight (green squares)
  - Best-move arrow (blue), MultiPV selector
  - Move list navigation and jump-to-ply
  - Flip orientation

## How it works

- The popup messages a content script in the active Chess.com tab to discover
  the game id, usernames, and month/year.
- Preferred: fetch PGNs via your local API (`http://localhost:3100/pgn`)
  that returns exact, normalized PGNs.
- The popup runs Stockfish (WASM) in a Web Worker and evaluates each position.
