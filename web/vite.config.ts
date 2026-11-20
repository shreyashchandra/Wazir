import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Cross-origin isolation unlocks SharedArrayBuffer, which the multi-threaded
// Stockfish build needs. "credentialless" (rather than "require-corp") keeps
// chess.com avatar images loading without CORP headers.
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

export default defineConfig({
  plugins: [react()],
  server: { headers: isolation },
  preview: { headers: isolation },
  build: { chunkSizeWarningLimit: 1200 },
});
