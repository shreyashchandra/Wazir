// Opening book built from lichess-org/chess-openings (CC0): ~3.9k named lines
// plus every intermediate position, keyed by a position hash. A move is "Book"
// when the position it reaches is a known theory position.
import data from "../data/openings.json";
import { positionKey } from "./positionKey.js";

const named = data.named as Record<string, string>;
const extra = new Set<string>(data.book as string[]);
const ecoFamily = data.ecoFamily as Record<string, string>;

export function isBookPosition(fen: string): boolean {
  const k = positionKey(fen);
  return k in named || extra.has(k);
}

export function openingAt(fen: string): { eco: string; name: string } | null {
  const v = named[positionKey(fen)];
  if (!v) return null;
  const [eco, name] = v.split("|");
  return { eco, name };
}

/** Broad opening family for an ECO code, e.g. "B90" -> "Sicilian Defense". */
export function familyForEco(eco?: string): string | null {
  return (eco && ecoFamily[eco]) || null;
}
