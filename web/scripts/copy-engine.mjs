// Copies the Stockfish 19 WASM builds from node_modules into public/engine.
// The full NNUE builds are ~99 MB each, so public/engine is git-ignored.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "stockfish", "bin");
const out = join(root, "public", "engine");

if (!existsSync(src)) {
  console.warn("[copy-engine] stockfish package not installed yet; skipping");
  process.exit(0);
}
mkdirSync(out, { recursive: true });

const flavors = ["stockfish-19", "stockfish-19-single", "stockfish-19-lite", "stockfish-19-lite-single"];
for (const f of flavors) {
  for (const ext of [".js", ".wasm"]) {
    const from = join(src, f + ext);
    const to = join(out, f + ext);
    if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
    copyFileSync(from, to);
    console.log(`[copy-engine] ${f + ext}`);
  }
}
