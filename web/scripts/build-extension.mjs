// Bundles the website's analysis core (src/lib) into the Chrome extension and
// copies the Stockfish 19 Lite engine next to it.
//   npm run build:extension
// Output: extention/lib/wazir-core.js and extention/stockfish/stockfish-19-lite*.{js,wasm}
import { build } from "vite";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ext = join(root, "..", "extention");

await build({
  configFile: false,
  publicDir: false, // don't copy the website's public/ (engine, pieces…) into the extension
  logLevel: "warn",
  define: { "import.meta.env.VITE_ENGINE_WASM_BASE": '""' },
  build: {
    outDir: join(ext, "lib"),
    emptyOutDir: false,
    minify: true,
    sourcemap: false,
    lib: { entry: join(root, "src/lib/extension-entry.ts"), formats: ["es"], fileName: () => "wazir-core.js" },
  },
});

// The extension ships the Lite engine (~1.7 MB): Chrome Web Store extensions must
// bundle their code, and the full NNUE build is ~99 MB.
mkdirSync(join(ext, "stockfish"), { recursive: true });
for (const f of ["stockfish-19-lite", "stockfish-19-lite-single"]) {
  for (const e of [".js", ".wasm"]) copyFileSync(join(root, "node_modules/stockfish/bin", f + e), join(ext, "stockfish", f + e));
}
console.log("Built extention/lib/wazir-core.js and copied Stockfish 19 Lite into extention/stockfish/");
