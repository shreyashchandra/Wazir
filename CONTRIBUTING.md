# Contributing to Wazir

Thanks for contributing! This document explains how to set up the project, propose
changes, and submit pull requests.

## Ways to Contribute

- Bug fixes (UI, analysis correctness, PGN parsing, board rendering)
- Performance improvements (engine orchestration, fewer re-renders, timeouts)
- UX improvements (keyboard nav, better charts, accessibility)
- Documentation (README, screenshots, troubleshooting)
- Backend improvements (faster matching, caching, rate limiting)

## Development Setup

### Extension (Chrome MV3)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the folder containing `manifest.json`

To test:

- Open a finished Chess.com game page
- Open the extension popup → Get PGN → Analyze

### Backend (Cloudflare Worker)

In the worker project:

```bash
npm install
npm run dev
```
