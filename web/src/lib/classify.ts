// Move classification modeled on chess.com's published definitions
// (support.chess.com "How are moves classified?"), which bucket moves by
// expected-points loss: Best = engine's top move, Excellent <= 0.02,
// Good <= 0.05, Inaccuracy <= 0.10, Mistake <= 0.20, Blunder > 0.20.
// Win% / 100 is our expected-points proxy. Brilliant, Great, Miss, Book and
// Forced use the extra signals chess.com describes for them.
import { Chess, type Square, type PieceSymbol, type Color } from "chess.js";

export type Classification =
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "book"
  | "forced"
  | "inaccuracy"
  | "mistake"
  | "miss"
  | "blunder";

export const CLASS_ORDER: Classification[] = [
  "brilliant",
  "great",
  "best",
  "excellent",
  "good",
  "book",
  "forced",
  "inaccuracy",
  "mistake",
  "miss",
  "blunder",
];

export const CLASS_META: Record<Classification, { label: string; glyph: string; color: string }> = {
  brilliant: { label: "Brilliant", glyph: "!!", color: "#26c2a3" },
  great: { label: "Great", glyph: "!", color: "#5b8bd6" },
  best: { label: "Best", glyph: "★", color: "#81b64c" },
  excellent: { label: "Excellent", glyph: "✓", color: "#81b64c" },
  good: { label: "Good", glyph: "✓", color: "#95af8a" },
  book: { label: "Book", glyph: "≡", color: "#a88865" },
  forced: { label: "Forced", glyph: "→", color: "#8f8f8f" },
  inaccuracy: { label: "Inaccuracy", glyph: "?!", color: "#f7c631" },
  mistake: { label: "Mistake", glyph: "?", color: "#e58f2a" },
  miss: { label: "Miss", glyph: "✕", color: "#ee6b55" },
  blunder: { label: "Blunder", glyph: "??", color: "#ca3431" },
};

const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Pieces (minor or bigger) of `color` that can be won: attacked by something cheaper, or attacked and undefended. */
export function hangingPieces(chess: Chess, color: Color): Map<Square, number> {
  const opp: Color = color === "w" ? "b" : "w";
  const out = new Map<Square, number>();
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p || p.color !== color || p.type === "k" || p.type === "p") continue;
      const attackers = chess.attackers(p.square, opp);
      if (!attackers.length) continue;
      const cheapest = Math.min(...attackers.map((s) => VALUE[chess.get(s)!.type] || 0));
      const defended = chess.attackers(p.square, color).length > 0;
      if (cheapest < VALUE[p.type] || !defended) out.set(p.square, VALUE[p.type]);
    }
  }
  return out;
}

/**
 * True when the move leaves material en prise on purpose: a minor piece or
 * bigger becomes capturable for profit and the move itself didn't win back
 * at least that much.
 */
export function isSacrifice(fenBefore: string, uci: string): boolean {
  const before = new Chess(fenBefore);
  const mover = before.turn();
  const hangingBefore = hangingPieces(before, mover);
  const after = new Chess(fenBefore);
  let move;
  try {
    move = after.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
  } catch {
    return false;
  }
  if (after.isCheckmate()) return false;
  const captured = move.captured ? VALUE[move.captured] : 0;
  const hangingAfter = hangingPieces(after, mover);
  let worst = 0;
  for (const [sq, val] of hangingAfter) {
    const isNew = !hangingBefore.has(sq) || sq === move.to;
    if (isNew) worst = Math.max(worst, val);
  }
  return worst >= 3 && worst > captured;
}

export interface ClassifyInput {
  legalMoves: number;
  isBook: boolean;
  isTopMove: boolean;
  /** Mover's win% with best play (before the move). */
  bestWin: number;
  /** Mover's win% after the second-best move, if MultiPV >= 2 gave one. */
  secondWin: number | null;
  /** Mover's win% after the played move. */
  playedWin: number;
  winLoss: number;
  sacrifice: boolean;
  isRecapture: boolean;
  /** Opponent's previous move gave something away (mistake/blunder/miss). */
  opponentErred: boolean;
}

export function classify(i: ClassifyInput): Classification {
  if (i.isBook) return "book";
  if (i.legalMoves === 1) return "forced";

  const nearBest = i.isTopMove || i.winLoss <= 2;

  if (nearBest && i.sacrifice && i.playedWin >= 45 && i.bestWin < 97) return "brilliant";

  if (
    i.isTopMove &&
    !i.isRecapture &&
    i.secondWin !== null &&
    i.bestWin - i.secondWin >= 15 &&
    i.playedWin >= 35
  ) {
    return "great";
  }

  if (i.isTopMove) return "best";

  if (i.opponentErred && i.winLoss >= 10 && i.bestWin >= 65) return "miss";

  if (i.winLoss <= 2) return "excellent";
  if (i.winLoss <= 5) return "good";
  if (i.winLoss <= 10) return "inaccuracy";
  if (i.winLoss <= 20) return "mistake";
  return "blunder";
}
