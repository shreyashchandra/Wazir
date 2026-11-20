// Builds src/data/openings.json from the lichess-org/chess-openings TSVs (CC0).
// Usage: node scripts/build-openings.mjs [dir-with-a..e.tsv]
// Without a directory argument the TSVs are downloaded from GitHub.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import { positionKey } from "../src/lib/positionKey.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.argv[2];

async function load(letter) {
  if (dir) return readFileSync(join(dir, `${letter}.tsv`), "utf8");
  const res = await fetch(`https://raw.githubusercontent.com/lichess-org/chess-openings/master/${letter}.tsv`);
  if (!res.ok) throw new Error(`download failed: ${letter}.tsv (${res.status})`);
  return res.text();
}

const named = {}; // key -> "ECO|Name"
const book = new Set();
const families = {}; // ECO -> { familyName: count }

for (const letter of ["a", "b", "c", "d", "e"]) {
  const rows = (await load(letter)).trim().split("\n").slice(1);
  for (const row of rows) {
    const [eco, name, pgn] = row.split("\t");
    const chess = new Chess();
    const sans = pgn.replace(/\d+\.(\.\.)?/g, " ").trim().split(/\s+/);
    for (const san of sans) {
      chess.move(san);
      book.add(positionKey(chess.fen()));
    }
    const key = positionKey(chess.fen());
    // Prefer the shortest (most general) name when two lines reach the same position.
    if (!named[key] || named[key].length > eco.length + 1 + name.length) named[key] = `${eco}|${name}`;
    const fam = name.split(":")[0].trim();
    families[eco] ??= {};
    families[eco][fam] = (families[eco][fam] || 0) + 1;
  }
}

const ecoFamily = {};
for (const [eco, counts] of Object.entries(families)) {
  ecoFamily[eco] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

const unnamed = [...book].filter((k) => !named[k]);
const out = { named, book: unnamed, ecoFamily };
writeFileSync(join(root, "src", "data", "openings.json"), JSON.stringify(out));
console.log(`named=${Object.keys(named).length} extraBook=${unnamed.length} eco=${Object.keys(ecoFamily).length}`);
