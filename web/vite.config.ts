import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Cross-origin isolation unlocks SharedArrayBuffer, which the multi-threaded
// Stockfish build needs. "require-corp" works in every major browser including
// Safari; everything we load cross-origin (chess.com avatars, Google Fonts)
// sends Cross-Origin-Resource-Policy: cross-origin. Keep vercel.json and
// public/_headers in sync with this.
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [react()],
  server: { headers: isolation },
  preview: { headers: isolation },
  build: { chunkSizeWarningLimit: 1200 },
});
