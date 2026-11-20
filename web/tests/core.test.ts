import { describe, expect, it } from "vitest";
import { cpToWin, gameAccuracy, moveAccuracy, toWhitePov, whiteWin } from "../src/lib/accuracy";
import { classify, isSacrifice } from "../src/lib/classify";
import { extractSanMoves, extractClocks, openingFromEcoUrl, parseHeaders } from "../src/lib/pgn";
import { isBookPosition, openingAt } from "../src/lib/openings";
import { formatScore, parseGame } from "../src/lib/analyze";
import { Chess } from "chess.js";

describe("accuracy model", () => {
  it("win% is symmetric and bounded", () => {
    expect(cpToWin(0)).toBeCloseTo(50);
    expect(cpToWin(300) + cpToWin(-300)).toBeCloseTo(100);
    expect(cpToWin(5000)).toBeLessThan(100);
  });
  it("move accuracy is 100 for no loss and drops with loss", () => {
    expect(moveAccuracy(60, 60)).toBe(100);
    expect(moveAccuracy(60, 55)).toBeGreaterThan(moveAccuracy(60, 40));
  });
  it("mated positions convert correctly", () => {
    expect(whiteWin({ type: "mate", value: 0 }, "b")).toBe(100);
    expect(whiteWin({ type: "mate", value: 0 }, "w")).toBe(0);
    expect(toWhitePov({ type: "mate", value: 3 }, "b")).toEqual({ type: "mate", value: -3 });
  });
  it("game accuracy punishes a blunder more than the plain mean suggests", () => {
    const wins = [50, 50, 50, 50, 50, 50, 50, 50, 50, 20, 20];
    const accs = [100, 100, 100, 100, 100, 100, 100, 100, 30, 100];
    const g = gameAccuracy(wins, accs, "w");
    expect(g.white!).toBeLessThan(86);
    expect(g.black!).toBeCloseTo(100);
  });
});

describe("classification", () => {
  const base = { legalMoves: 30, isBook: false, isTopMove: false, bestWin: 50, secondWin: 48, playedWin: 50, winLoss: 0, sacrifice: false, isRecapture: false, opponentErred: false };
  it("uses chess.com expected-points thresholds", () => {
    expect(classify({ ...base, isTopMove: true })).toBe("best");
    expect(classify({ ...base, winLoss: 1.5 })).toBe("excellent");
    expect(classify({ ...base, winLoss: 4 })).toBe("good");
    expect(classify({ ...base, winLoss: 8 })).toBe("inaccuracy");
    expect(classify({ ...base, winLoss: 15 })).toBe("mistake");
    expect(classify({ ...base, winLoss: 30 })).toBe("blunder");
  });
  it("detects great, brilliant, miss, forced, book", () => {
    expect(classify({ ...base, isTopMove: true, secondWin: 20 })).toBe("great");
    expect(classify({ ...base, isTopMove: true, sacrifice: true })).toBe("brilliant");
    expect(classify({ ...base, opponentErred: true, bestWin: 80, winLoss: 25 })).toBe("miss");
    expect(classify({ ...base, legalMoves: 1 })).toBe("forced");
    expect(classify({ ...base, isBook: true })).toBe("book");
  });
  it("spots a real piece sacrifice and ignores a fair trade", () => {
    // Greek gift: Bxh7+ gives up the bishop.
    expect(isSacrifice("r1bq1rk1/pppn1ppp/4pn2/3p4/1bPP4/2NBPN2/PP3PPP/R1BQK2R w KQ - 0 1", "d3h7")).toBe(true);
    // Simple equal capture is not a sacrifice.
    expect(isSacrifice("rnbqkb1r/pppp1ppp/5n2/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 2 3", "b1c3")).toBe(false);
  });
});

describe("pgn + openings", () => {
  const pgn = `[Event "Live Chess"]\n[White "a"]\n[Black "b"]\n[ECO "C50"]\n\n1. e4 {[%clk 0:03:00]} 1... e5 {[%clk 0:02:59.5]} 2. Nf3 (2. Nc3 Nf6) 2... Nc6 $1 3. Bc4 Bc5 1-0`;
  it("parses headers, moves, clocks", () => {
    expect(parseHeaders(pgn).ECO).toBe("C50");
    expect(extractSanMoves(pgn)).toEqual(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]);
    expect(extractClocks(pgn)).toEqual([180, 179.5]);
  });
  it("knows the Italian Game from the book", () => {
    const g = parseGame(pgn);
    expect(isBookPosition(g.fens[6])).toBe(true);
    expect(openingAt(g.fens[5])?.name).toMatch(/Italian/);
  });
  it("cleans chess.com opening slugs", () => {
    expect(openingFromEcoUrl("https://www.chess.com/openings/Kings-Indian-Defense-Fianchetto-Variation-8.d5-Nb8")).toBe("Kings Indian Defense Fianchetto Variation");
  });
  it("formats scores", () => {
    expect(formatScore({ type: "cp", value: 134 })).toBe("+1.3");
    expect(formatScore({ type: "mate", value: -2 })).toBe("#-2");
  });
  it("chess.js attackers API exists", () => {
    expect(new Chess().attackers("f3", "w").length).toBeGreaterThan(0);
  });
});
