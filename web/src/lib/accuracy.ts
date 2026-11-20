// Win-probability and accuracy model.
//
// Chess.com's CAPS2 is proprietary. The closest public model is the one lichess
// documents and open-sources (lila: AccuracyPercent.scala, WinPercent.scala),
// which is fitted to real game outcomes and tracks chess.com's numbers closely.
// Two details matter much more than the formula constants:
//   1. Game accuracy is NOT a plain average of per-move accuracy. It averages a
//      volatility-weighted mean and a harmonic mean, so one blunder in a sharp
//      position costs what it should.
//   2. Evals are converted to win% before comparing, so +8 -> +5 barely matters
//      while +1 -> -2 is a big deal.
import type { Score } from "./engine";

/** Mate scores become large centipawn values, as lichess does. */
export function scoreToCp(score: Score): number {
  if (score.type === "cp") return score.value;
  if (score.value === 0) return -10000; // side to move is mated
  const sign = Math.sign(score.value);
  return sign * (21 - Math.min(10, Math.abs(score.value))) * 100;
}

export function cpToWin(cp: number): number {
  const c = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

/** Win% (0..100) for the side whose POV the score is in. */
export function scoreToWin(score: Score): number {
  if (score.type === "mate" && score.value === 0) return 0;
  return cpToWin(scoreToCp(score));
}

export function negate(score: Score): Score {
  return { type: score.type, value: score.value === 0 && score.type === "mate" ? 0 : -score.value };
}

/**
 * Converts a side-to-move score to White's POV. A checkmated position ("mate 0")
 * has no sign, so it becomes a ±10000 cp sentinel that formats as "#".
 */
export function toWhitePov(score: Score, sideToMove: "w" | "b"): Score {
  if (score.type === "mate" && score.value === 0) return { type: "cp", value: sideToMove === "w" ? -10000 : 10000 };
  return sideToMove === "w" ? score : negate(score);
}

/** White's win% from a side-to-move score. */
export function whiteWin(score: Score, sideToMove: "w" | "b"): number {
  const w = scoreToWin(score);
  return sideToMove === "w" ? w : 100 - w;
}

/** Per-move accuracy from the mover's win% before and after (lichess constants + 1pt uncertainty bonus). */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100;
  const diff = winBefore - winAfter;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * diff) - 3.166924740191411 + 1;
  return Math.max(0, Math.min(100, raw));
}

function stdDev(xs: number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
}

/**
 * Game accuracy per side.
 * @param whiteWins White's win% for every position, starting position first (length = plies + 1).
 * @param moveAccs  Accuracy of each ply (length = plies), mover POV.
 * @param firstMover Who made ply 0.
 */
export function gameAccuracy(
  whiteWins: number[],
  moveAccs: number[],
  firstMover: "w" | "b" = "w",
): { white: number | null; black: number | null } {
  const n = moveAccs.length;
  if (n === 0) return { white: null, black: null };
  const windowSize = Math.max(2, Math.min(8, Math.floor(n / 10)));
  const windows: number[][] = [];
  const head = whiteWins.slice(0, windowSize);
  for (let i = 0; i < Math.min(windowSize - 2, n); i++) windows.push(head);
  for (let i = 0; i + windowSize <= whiteWins.length && windows.length < n; i++) {
    windows.push(whiteWins.slice(i, i + windowSize));
  }
  while (windows.length < n) windows.push(windows[windows.length - 1] ?? head);
  const weights = windows.map((w) => Math.max(0.5, Math.min(12, stdDev(w))));

  const side = (color: "w" | "b") => {
    let wSum = 0;
    let wAcc = 0;
    let invSum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const mover = (i % 2 === 0) === (firstMover === "w") ? "w" : "b";
      if (mover !== color) continue;
      const a = moveAccs[i];
      wSum += weights[i];
      wAcc += a * weights[i];
      invSum += 1 / Math.max(a, 1);
      count++;
    }
    if (!count) return null;
    const weighted = wAcc / wSum;
    const harmonic = count / invSum;
    return (weighted + harmonic) / 2;
  };
  return { white: side("w"), black: side("b") };
}
