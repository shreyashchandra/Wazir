// Normalizes chess.com archive games into per-player records and aggregates them.
import type { ChessComGame, TimeClass } from "./chesscom";
import { extractSanMoves, gameDurationSec, openingFromEcoUrl, parseHeaders } from "./pgn";
import { familyForEco } from "./openings";

export type Outcome = "win" | "loss" | "draw";

export interface GameRecord {
  id: string;
  url: string;
  uuid: string;
  end: number; // ms
  timeClass: TimeClass;
  timeControl: string;
  rated: boolean;
  color: "white" | "black";
  myRating: number;
  oppRating: number;
  opponent: string;
  outcome: Outcome;
  myResult: string;
  oppResult: string;
  myAccuracy?: number;
  oppAccuracy?: number;
  eco?: string;
  opening: string;
  family: string;
  plies: number;
  durationSec: number | null;
  pgn: string;
}

const DRAW_CODES = new Set(["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"]);

export function toRecord(g: ChessComGame, username: string): GameRecord | null {
  if (g.rules !== "chess" || !g.pgn) return null;
  const me = username.toLowerCase();
  const isWhite = g.white.username.toLowerCase() === me;
  if (!isWhite && g.black.username.toLowerCase() !== me) return null;
  const mine = isWhite ? g.white : g.black;
  const opp = isWhite ? g.black : g.white;
  const headers = parseHeaders(g.pgn);
  const outcome: Outcome = mine.result === "win" ? "win" : DRAW_CODES.has(mine.result) ? "draw" : "loss";
  const opening = openingFromEcoUrl(g.eco || headers.ECOUrl) || "Unknown opening";
  return {
    id: g.url.split("/").pop() || g.uuid,
    url: g.url,
    uuid: g.uuid,
    end: g.end_time * 1000,
    timeClass: g.time_class,
    timeControl: g.time_control,
    rated: g.rated,
    color: isWhite ? "white" : "black",
    myRating: mine.rating,
    oppRating: opp.rating,
    opponent: opp.username,
    outcome,
    myResult: mine.result,
    oppResult: opp.result,
    myAccuracy: g.accuracies ? (isWhite ? g.accuracies.white : g.accuracies.black) : undefined,
    oppAccuracy: g.accuracies ? (isWhite ? g.accuracies.black : g.accuracies.white) : undefined,
    eco: headers.ECO,
    opening,
    family: familyForEco(headers.ECO) || opening.split(" ").slice(0, 3).join(" "),
    plies: extractSanMoves(g.pgn).length,
    durationSec: g.time_class === "daily" ? null : gameDurationSec(headers),
    pgn: g.pgn,
  };
}

export function toRecords(games: ChessComGame[], username: string): GameRecord[] {
  return games.map((g) => toRecord(g, username)).filter((r): r is GameRecord => !!r);
}

export interface WDL {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Points scored / games, 0..100 (draw = half). */
  score: number;
  winRate: number;
}

export function wdl(rs: GameRecord[]): WDL {
  const wins = rs.filter((r) => r.outcome === "win").length;
  const losses = rs.filter((r) => r.outcome === "loss").length;
  const draws = rs.length - wins - losses;
  const games = rs.length;
  return {
    games,
    wins,
    losses,
    draws,
    score: games ? ((wins + draws / 2) / games) * 100 : 0,
    winRate: games ? (wins / games) * 100 : 0,
  };
}

export function groupBy<T, K extends string | number>(xs: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

export const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function accuracyStats(rs: GameRecord[]) {
  const withAcc = rs.filter((r) => r.myAccuracy !== undefined);
  const best = withAcc.reduce<GameRecord | null>((b, r) => (!b || r.myAccuracy! > b.myAccuracy! ? r : b), null);
  return { avg: avg(withAcc.map((r) => r.myAccuracy!)), count: withAcc.length, best };
}

/** Rating after each rated game, one point per day (last game of the day). */
export function ratingSeries(rs: GameRecord[], tc: TimeClass) {
  const byDay = new Map<string, { t: number; rating: number }>();
  for (const r of rs) {
    if (r.timeClass !== tc || !r.rated) continue;
    const d = new Date(r.end);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    byDay.set(key, { t: r.end, rating: r.myRating });
  }
  return [...byDay.values()].sort((a, b) => a.t - b.t);
}

export function streaks(rs: GameRecord[]) {
  let bestWin = 0;
  let bestLoss = 0;
  let curW = 0;
  let curL = 0;
  for (const r of rs) {
    if (r.outcome === "win") {
      curW++;
      curL = 0;
    } else if (r.outcome === "loss") {
      curL++;
      curW = 0;
    } else {
      curW = 0;
      curL = 0;
    }
    bestWin = Math.max(bestWin, curW);
    bestLoss = Math.max(bestLoss, curL);
  }
  return { longestWin: bestWin, longestLoss: bestLoss };
}

export interface OpeningRow extends WDL {
  name: string;
  color: "white" | "black";
  avgAccuracy: number | null;
}

export function openingTable(rs: GameRecord[], color: "white" | "black", by: "family" | "opening" = "family"): OpeningRow[] {
  const mine = rs.filter((r) => r.color === color);
  return [...groupBy(mine, (r) => r[by]).entries()]
    .map(([name, games]) => ({
      name,
      color,
      ...wdl(games),
      avgAccuracy: avg(games.filter((g) => g.myAccuracy !== undefined).map((g) => g.myAccuracy!)),
    }))
    .sort((a, b) => b.games - a.games);
}

export function endings(rs: GameRecord[]) {
  const won = rs.filter((r) => r.outcome === "win");
  const lost = rs.filter((r) => r.outcome === "loss");
  const count = (xs: GameRecord[], code: string) => xs.filter((r) => r.oppResult === code || r.myResult === code).length;
  return {
    checkmatesDelivered: won.filter((r) => r.oppResult === "checkmated").length,
    resignationsForced: won.filter((r) => r.oppResult === "resigned").length,
    wonOnTime: won.filter((r) => r.oppResult === "timeout").length,
    wonByAbandon: won.filter((r) => r.oppResult === "abandoned").length,
    gotCheckmated: count(lost, "checkmated"),
    resigned: count(lost, "resigned"),
    lostOnTime: count(lost, "timeout"),
    abandoned: count(lost, "abandoned"),
    drawsAgreed: rs.filter((r) => r.myResult === "agreed").length,
    drawsRepetition: rs.filter((r) => r.myResult === "repetition").length,
    drawsStalemate: rs.filter((r) => r.myResult === "stalemate").length,
    drawsOther: rs.filter((r) => ["insufficient", "50move", "timevsinsufficient"].includes(r.myResult)).length,
  };
}

export function byHour(rs: GameRecord[]) {
  const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, games: [] as GameRecord[] }));
  for (const r of rs) buckets[new Date(r.end).getHours()].games.push(r);
  return buckets.map((b) => ({ hour: b.hour, ...wdl(b.games) }));
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function byWeekday(rs: GameRecord[]) {
  const buckets = Array.from({ length: 7 }, () => [] as GameRecord[]);
  for (const r of rs) buckets[new Date(r.end).getDay()].push(r);
  return buckets.map((g, i) => ({ day: WEEKDAYS[i], ...wdl(g) }));
}

export function vsRatingBands(rs: GameRecord[]) {
  const bands = [
    { label: "200+ lower", test: (d: number) => d <= -200 },
    { label: "50–200 lower", test: (d: number) => d > -200 && d <= -50 },
    { label: "Similar (±50)", test: (d: number) => d > -50 && d < 50 },
    { label: "50–200 higher", test: (d: number) => d >= 50 && d < 200 },
    { label: "200+ higher", test: (d: number) => d >= 200 },
  ];
  return bands.map((b) => ({ label: b.label, ...wdl(rs.filter((r) => b.test(r.oppRating - r.myRating))) }));
}

export function monthly(rs: GameRecord[]) {
  const groups = groupBy(rs, (r) => {
    const d = new Date(r.end);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, games]) => ({
      month,
      ...wdl(games),
      accuracy: accuracyStats(games).avg,
    }));
}

export function totalHours(rs: GameRecord[]) {
  return rs.reduce((a, r) => a + (r.durationSec ?? 0), 0) / 3600;
}

export function mainTimeClass(rs: GameRecord[]): TimeClass | null {
  const g = [...groupBy(rs, (r) => r.timeClass).entries()].sort((a, b) => b[1].length - a[1].length);
  return g[0]?.[0] ?? null;
}

export function formatTimeControl(tc: string): string {
  if (tc.includes("/")) {
    const days = Number(tc.split("/")[1]) / 86400;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  const [base, inc] = tc.split("+").map(Number);
  const mins = base / 60;
  const b = mins >= 1 ? `${Number.isInteger(mins) ? mins : mins.toFixed(1)}` : `${base}s`;
  return inc ? `${b}|${inc}` : `${b} min`;
}
