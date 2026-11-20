// Client for the chess.com Published-Data API (https://www.chess.com/news/view/published-data-api).
// The API sends `Access-Control-Allow-Origin: *`, so the browser calls it directly.
import { cacheGet, cacheSet } from "./cache";

const BASE = "https://api.chess.com/pub";

export type TimeClass = "bullet" | "blitz" | "rapid" | "daily";
export const TIME_CLASSES: TimeClass[] = ["bullet", "blitz", "rapid", "daily"];

export interface ChessComSide {
  rating: number;
  result: string;
  "@id": string;
  username: string;
  uuid?: string;
}

export interface ChessComGame {
  url: string;
  pgn?: string;
  time_control: string;
  end_time: number;
  rated: boolean;
  accuracies?: { white: number; black: number };
  uuid: string;
  initial_setup?: string;
  fen?: string;
  time_class: TimeClass;
  rules: string;
  white: ChessComSide;
  black: ChessComSide;
  eco?: string;
  tournament?: string;
  match?: string;
}

export interface ChessComProfile {
  username: string;
  player_id: number;
  name?: string;
  title?: string;
  avatar?: string;
  country?: string;
  followers?: number;
  joined?: number;
  last_online?: number;
  status?: string;
  league?: string;
  url: string;
  is_streamer?: boolean;
}

export interface RatingRecord {
  last?: { rating: number; date: number; rd?: number };
  best?: { rating: number; date: number; game?: string };
  record?: { win: number; loss: number; draw: number };
}

export interface ChessComStats {
  chess_bullet?: RatingRecord;
  chess_blitz?: RatingRecord;
  chess_rapid?: RatingRecord;
  chess_daily?: RatingRecord;
  chess960_daily?: RatingRecord;
  tactics?: { highest?: { rating: number; date: number }; lowest?: { rating: number; date: number } };
  puzzle_rush?: { best?: { total_attempts: number; score: number } };
  fide?: number;
}

export interface MonthRef {
  year: number;
  month: number; // 1-12
}

export class NotFoundError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string, attempt = 0): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    if (attempt < 2) {
      await sleep(600 * (attempt + 1));
      return getJson(url, attempt + 1);
    }
    throw new Error("Couldn't reach chess.com. Check your connection and try again.", { cause: err });
  }
  if (res.status === 404 || res.status === 410) throw new NotFoundError("Not found on chess.com");
  if (res.status === 429 && attempt < 5) {
    await sleep(1000 * 2 ** attempt);
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`chess.com returned ${res.status}`);
  return res.json() as Promise<T>;
}

const norm = (u: string) => u.trim().toLowerCase();
const MIN = 60_000;

export function currentMonth(): MonthRef {
  const d = new Date();
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export function monthKey(m: MonthRef) {
  return `${m.year}-${String(m.month).padStart(2, "0")}`;
}

export function isMonthComplete(m: MonthRef) {
  const c = currentMonth();
  return m.year < c.year || (m.year === c.year && m.month < c.month);
}

export function shiftMonth(m: MonthRef, delta: number): MonthRef {
  const idx = m.year * 12 + (m.month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export async function getProfile(username: string): Promise<ChessComProfile> {
  const key = `profile:${norm(username)}`;
  const hit = await cacheGet<ChessComProfile>(key);
  if (hit) return hit;
  const data = await getJson<ChessComProfile>(`${BASE}/player/${encodeURIComponent(norm(username))}`);
  await cacheSet(key, data, 10 * MIN);
  return data;
}

export async function getStats(username: string): Promise<ChessComStats> {
  const key = `stats:${norm(username)}`;
  const hit = await cacheGet<ChessComStats>(key);
  if (hit) return hit;
  const data = await getJson<ChessComStats>(`${BASE}/player/${encodeURIComponent(norm(username))}/stats`);
  await cacheSet(key, data, 10 * MIN);
  return data;
}

export async function getArchives(username: string): Promise<MonthRef[]> {
  const key = `archives:${norm(username)}`;
  const hit = await cacheGet<MonthRef[]>(key);
  if (hit) return hit;
  const data = await getJson<{ archives: string[] }>(
    `${BASE}/player/${encodeURIComponent(norm(username))}/games/archives`,
  );
  const months = data.archives
    .map((u) => u.match(/\/(\d{4})\/(\d{2})$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ year: Number(m[1]), month: Number(m[2]) }));
  await cacheSet(key, months, 10 * MIN);
  return months;
}

/** Games for one archive month. Completed months are cached forever (they never change). */
export async function getMonthGames(username: string, m: MonthRef): Promise<ChessComGame[]> {
  const key = `games:${norm(username)}:${monthKey(m)}`;
  const hit = await cacheGet<ChessComGame[]>(key);
  if (hit) return hit;
  const mm = String(m.month).padStart(2, "0");
  let games: ChessComGame[];
  try {
    const data = await getJson<{ games: ChessComGame[] }>(
      `${BASE}/player/${encodeURIComponent(norm(username))}/games/${m.year}/${mm}`,
    );
    games = data.games || [];
  } catch (err) {
    if (err instanceof NotFoundError) games = [];
    else throw err;
  }
  await cacheSet(key, games, isMonthComplete(m) ? null : 3 * MIN);
  return games;
}

/** Fetch several months with limited concurrency (chess.com rate-limits parallel bursts). */
export async function getGamesForMonths(
  username: string,
  months: MonthRef[],
  onProgress?: (done: number, total: number) => void,
): Promise<ChessComGame[]> {
  const results: ChessComGame[][] = new Array(months.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < months.length) {
      const i = next++;
      results[i] = await getMonthGames(username, months[i]);
      onProgress?.(++done, months.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, months.length) }, worker));
  return results.flat().sort((a, b) => a.end_time - b.end_time);
}

/** Extracts the numeric game id from a chess.com game URL (live or daily). */
export function gameIdFromUrl(url: string): { kind: "live" | "daily"; id: string } | null {
  const m = url.match(/chess\.com\/(?:game|analysis\/game)\/(live|daily)\/(\d+)/i);
  if (m) return { kind: m[1].toLowerCase() as "live" | "daily", id: m[2] };
  const bare = url.match(/chess\.com\/(?:live|daily)\/game\/(\d+)/i);
  if (bare) return { kind: url.includes("daily") ? "daily" : "live", id: bare[1] };
  return null;
}

/** Look for a game id in a player's recent archives (newest first). */
export async function findGameById(username: string, id: string, maxMonths = 24): Promise<ChessComGame | null> {
  const archives = (await getArchives(username)).slice(-maxMonths).reverse();
  for (const m of archives) {
    const games = await getMonthGames(username, m);
    const g = games.find((x) => x.url.endsWith(`/${id}`));
    if (g) return g;
  }
  return null;
}

export function countryCode(countryUrl?: string): string | null {
  const m = countryUrl?.match(/\/country\/([A-Z]{2})$/i);
  return m ? m[1].toUpperCase() : null;
}

export function flagEmoji(code: string | null): string {
  if (!code || code.length !== 2 || code.startsWith("X")) return "";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
