// Full-game review pipeline: evaluate every position once with MultiPV, then
// derive win%, per-move accuracy, classification, game accuracy and phases.
import { Chess, type Move } from "chess.js";
import type { PvLine, Score, SearchOptions, SearchHandle } from "./engine";

/** The subset of StockfishEngine the analyzer needs (lets tests run it in Node). */
export interface EngineLike {
  info: { name: string };
  newGame(): Promise<void>;
  search(fen: string, opts: SearchOptions): SearchHandle;
}
import { gameAccuracy, moveAccuracyCp, scoreToCp, scoreToWin, toWhitePov } from "./accuracy";
import { classify, isSacrifice, type Classification } from "./classify";
import { isBookPosition, openingAt } from "./openings";
import { extractClocks, extractSanMoves, parseHeaders } from "./pgn";
import { cacheGet, cacheSet } from "./cache";

export type PresetId = "fast" | "standard" | "deep" | "max";

export const PRESETS: Record<PresetId, SearchOptions & { label: string; hint: string }> = {
  fast: { label: "Fast", hint: "Depth 14", depth: 14, multipv: 2, movetime: 1500 },
  standard: { label: "Standard", hint: "Depth 18", depth: 18, multipv: 3, movetime: 4000 },
  deep: { label: "Deep", hint: "Depth 22", depth: 22, multipv: 3, movetime: 10000 },
  max: { label: "Maximum", hint: "Depth 28", depth: 28, multipv: 3, movetime: 30000 },
};

export interface EngineLine {
  /** White POV. */
  score: Score;
  depth: number;
  uci: string[];
  san: string[];
}

export type Phase = "opening" | "middlegame" | "endgame";

export interface MoveReview {
  ply: number; // 1-based
  moveNumber: number;
  color: "w" | "b";
  san: string;
  uci: string;
  from: string;
  to: string;
  fenBefore: string;
  fenAfter: string;
  /** Eval of the position after the move, White POV. */
  evalAfter: Score;
  winBefore: number; // mover POV
  winAfter: number; // mover POV
  winLoss: number;
  accuracy: number;
  cpLoss: number;
  bestUci: string | null;
  bestSan: string | null;
  /** Engine lines for the position BEFORE the move (what should have been played). */
  lines: EngineLine[];
  classification: Classification;
  phase: Phase;
  clock?: number;
  opening?: string;
}

export interface SideSummary {
  accuracy: number | null;
  acpl: number;
  counts: Record<Classification, number>;
  phases: Record<Phase, number | null>;
}

export interface GameReview {
  key: string;
  headers: Record<string, string>;
  startFen: string;
  /** Eval of the starting position, White POV. */
  startEval: Score;
  moves: MoveReview[];
  white: SideSummary;
  black: SideSummary;
  opening: { eco: string; name: string } | null;
  preset: PresetId;
  engine: string;
  complete: boolean;
  analyzedAt: number;
}

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function uciOf(m: Move) {
  return m.from + m.to + (m.promotion ?? "");
}

export function uciLineToSan(fen: string, uci: string[], max = 12): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const u of uci.slice(0, max)) {
    try {
      const m = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
      out.push(m.san);
    } catch {
      break;
    }
  }
  return out;
}

function nonPawnMaterial(fen: string) {
  const v: Record<string, number> = { n: 3, b: 3, r: 5, q: 9 };
  let total = 0;
  for (const ch of fen.split(" ")[0]) total += v[ch.toLowerCase()] ?? 0;
  return total;
}

/** Terminal positions are scored without asking the engine. */
function terminalScore(chess: Chess): Score | null {
  if (chess.isCheckmate()) return { type: "mate", value: 0 };
  if (chess.isDraw() || chess.isStalemate()) return { type: "cp", value: 0 };
  return null;
}

export interface ParsedGame {
  headers: Record<string, string>;
  startFen: string;
  moves: Move[];
  fens: string[]; // length = moves + 1
  clocks: number[];
}

export function parseGame(pgn: string): ParsedGame {
  const headers = parseHeaders(pgn);
  const startFen = headers.SetUp === "1" && headers.FEN ? headers.FEN : START_FEN;
  const chess = new Chess(startFen);
  const moves: Move[] = [];
  const fens = [chess.fen()];
  for (const san of extractSanMoves(pgn)) {
    let m: Move;
    try {
      m = chess.move(san);
    } catch {
      break;
    }
    moves.push(m);
    fens.push(chess.fen());
  }
  if (!moves.length) throw new Error("No legal moves found in this PGN.");
  return { headers, startFen, moves, fens, clocks: extractClocks(pgn) };
}

export function reviewCacheKey(gameKey: string, preset: PresetId, engine: string) {
  return `review:v2:${gameKey}:${preset}:${engine}`;
}

export async function loadCachedReview(gameKey: string, preset: PresetId, engine: string) {
  const r = await cacheGet<GameReview>(reviewCacheKey(gameKey, preset, engine));
  return r?.complete ? r : undefined;
}

const emptyCounts = (): Record<Classification, number> => ({
  brilliant: 0,
  great: 0,
  best: 0,
  excellent: 0,
  good: 0,
  book: 0,
  forced: 0,
  inaccuracy: 0,
  mistake: 0,
  miss: 0,
  blunder: 0,
});

export interface AnalyzeCallbacks {
  onProgress?: (review: GameReview, done: number, total: number) => void;
  signal?: { cancelled: boolean };
}

export async function analyzeGame(
  pgn: string,
  gameKey: string,
  engine: EngineLike,
  preset: PresetId,
  cb: AnalyzeCallbacks = {},
): Promise<GameReview> {
  const parsed = parseGame(pgn);
  const { moves, fens, headers, startFen, clocks } = parsed;
  const opts = PRESETS[preset];
  const N = moves.length;

  await engine.newGame();

  // Eval of each position from side-to-move POV, plus its MultiPV lines.
  const posScore: (Score | null)[] = new Array(N + 1).fill(null);
  const posLines: PvLine[][] = new Array(N + 1).fill(null).map(() => []);

  // Book detection is contiguous from the start.
  const book: boolean[] = [];
  let inBook = startFen === START_FEN;
  for (let k = 0; k < N; k++) {
    inBook = inBook && isBookPosition(fens[k + 1]);
    book.push(inBook);
  }
  const lastBook = book.lastIndexOf(true);
  let opening: { eco: string; name: string } | null = null;
  for (let k = 0; k <= lastBook; k++) opening = openingAt(fens[k + 1]) ?? opening;

  const review: GameReview = {
    key: gameKey,
    headers,
    startFen,
    startEval: { type: "cp", value: 0 },
    moves: [],
    white: { accuracy: null, acpl: 0, counts: emptyCounts(), phases: { opening: null, middlegame: null, endgame: null } },
    black: { accuracy: null, acpl: 0, counts: emptyCounts(), phases: { opening: null, middlegame: null, endgame: null } },
    opening,
    preset,
    engine: engine.info.name,
    complete: false,
    analyzedAt: Date.now(),
  };

  const stm = (k: number) => fens[k].split(" ")[1] as "w" | "b";

  const buildMove = (k: number): MoveReview => {
    const m = moves[k];
    const mover = stm(k);
    const before = posScore[k]!;
    const after = posScore[k + 1]!;
    const lines = posLines[k];
    const uci = uciOf(m);
    const bestUci = lines[0]?.pv[0] ?? null;
    const isTop = bestUci === uci;

    const bestWin = scoreToWin(before);
    const secondWin = lines[1] ? scoreToWin(lines[1].score) : null;
    // `after` is from the opponent's POV; flip to the mover.
    let playedWin = 100 - scoreToWin(after);
    if (isTop) playedWin = Math.max(playedWin, bestWin); // same move, remove search noise
    const winLoss = Math.max(0, bestWin - playedWin);
    const cpBefore = Math.max(-1000, Math.min(1000, scoreToCp(before)));
    const cpAfter = Math.max(-1000, Math.min(1000, -scoreToCp(after)));
    const accuracy = isTop ? 100 : moveAccuracyCp(cpBefore, cpAfter);
    const cpLoss = isTop ? 0 : Math.max(0, cpBefore - cpAfter);

    const prev = review.moves[k - 1];
    const legal = new Chess(fens[k]).moves().length;
    const classification = classify({
      legalMoves: legal,
      isBook: book[k],
      isTopMove: isTop,
      bestWin,
      secondWin,
      playedWin,
      winLoss,
      sacrifice: (isTop || winLoss <= 2) && isSacrifice(fens[k], uci),
      isRecapture: !!(m.captured && prev && prev.to === m.to && moves[k - 1]?.captured),
      opponentErred: !!prev && ["mistake", "blunder", "miss"].includes(prev.classification),
    });

    const npm = nonPawnMaterial(fens[k]);
    const phase: Phase = npm <= 14 ? "endgame" : k <= Math.max(19, lastBook) ? "opening" : "middlegame";

    return {
      ply: k + 1,
      moveNumber: Number(fens[k].split(" ")[5]) || Math.floor(k / 2) + 1,
      color: mover,
      san: m.san,
      uci,
      from: m.from,
      to: m.to,
      fenBefore: fens[k],
      fenAfter: fens[k + 1],
      evalAfter: toWhitePov(after, stm(k + 1)),
      winBefore: bestWin,
      winAfter: playedWin,
      winLoss,
      accuracy,
      cpLoss,
      bestUci,
      bestSan: bestUci ? uciLineToSan(fens[k], [bestUci], 1)[0] ?? null : null,
      lines: lines.map((l) => ({
        score: toWhitePov(l.score, mover),
        depth: l.depth,
        uci: l.pv,
        san: uciLineToSan(fens[k], l.pv),
      })),
      classification,
      phase,
      clock: clocks[k],
      opening: book[k] ? openingAt(fens[k + 1])?.name : undefined,
    };
  };

  const summarize = () => {
    const done = review.moves;
    const whiteCp = (k: number) => scoreToCp(toWhitePov(posScore[k]!, stm(k)));
    const whiteCps = [whiteCp(0), ...done.map((_m, i) => whiteCp(i + 1))];
    const acc = gameAccuracy(whiteCps, done.map((m) => m.accuracy), stm(0));
    for (const color of ["w", "b"] as const) {
      const mine = done.filter((m) => m.color === color);
      const s = color === "w" ? review.white : review.black;
      s.accuracy = color === "w" ? acc.white : acc.black;
      s.acpl = mine.length ? Math.round(mine.reduce((a, m) => a + m.cpLoss, 0) / mine.length) : 0;
      s.counts = emptyCounts();
      for (const m of mine) s.counts[m.classification]++;
      for (const ph of ["opening", "middlegame", "endgame"] as const) {
        const pm = mine.filter((m) => m.phase === ph);
        s.phases[ph] = pm.length ? pm.reduce((a, m) => a + m.accuracy, 0) / pm.length : null;
      }
    }
  };

  for (let k = 0; k <= N; k++) {
    if (cb.signal?.cancelled) break;
    const chess = new Chess(fens[k]);
    const terminal = terminalScore(chess);
    if (terminal) {
      posScore[k] = terminal;
    } else {
      const lines = await engine.search(fens[k], opts).promise;
      if (cb.signal?.cancelled) break;
      posLines[k] = lines;
      posScore[k] = lines[0]?.score ?? { type: "cp", value: 0 };
    }
    if (k === 0) review.startEval = toWhitePov(posScore[0]!, stm(0));
    if (k >= 1) {
      review.moves.push(buildMove(k - 1));
      summarize();
    }
    cb.onProgress?.(review, k, N);
  }

  review.complete = review.moves.length === N;
  review.analyzedAt = Date.now();
  if (review.complete) await cacheSet(reviewCacheKey(gameKey, preset, engine.info.name), review, null);
  return review;
}

/** Formats a White-POV score like "+1.4", "-0.3", "#3", "#-2". */
export function formatScore(s: Score | undefined | null): string {
  if (!s) return "";
  if (s.type === "mate") return s.value === 0 ? "#" : `#${s.value > 0 ? "" : "-"}${Math.abs(s.value)}`;
  if (Math.abs(s.value) >= 10000) return "#";
  const p = s.value / 100;
  return `${p > 0 ? "+" : ""}${p.toFixed(Math.abs(p) >= 10 ? 0 : 1)}`;
}

/** White's win% for a White-POV score (for eval bars and graphs). */
export function whiteWinFromWhiteScore(s: Score): number {
  return scoreToWin(s);
}
