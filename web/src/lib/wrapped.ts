// "Chess Wrapped": a Spotify-Wrapped-style recap of one month or one year.
import {
  getArchives,
  getGamesForMonths,
  isMonthComplete,
  monthKey,
  shiftMonth,
  type MonthRef,
  type TimeClass,
} from "./chesscom";
import {
  accuracyStats,
  byHour,
  byWeekday,
  endings,
  groupBy,
  openingTable,
  streaks,
  toRecords,
  totalHours,
  wdl,
  type GameRecord,
  type WDL,
} from "./stats";

export type WrappedPeriod = { kind: "month"; year: number; month: number } | { kind: "year"; year: number };

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function periodLabel(p: WrappedPeriod) {
  return p.kind === "month" ? `${MONTH_NAMES[p.month - 1]} ${p.year}` : `${p.year}`;
}

export function periodMonths(p: WrappedPeriod): MonthRef[] {
  if (p.kind === "month") return [{ year: p.year, month: p.month }];
  return Array.from({ length: 12 }, (_, i) => ({ year: p.year, month: i + 1 }));
}

export function previousPeriod(p: WrappedPeriod): WrappedPeriod {
  if (p.kind === "year") return { kind: "year", year: p.year - 1 };
  const m = shiftMonth({ year: p.year, month: p.month }, -1);
  return { kind: "month", ...m };
}

/** A month wrap is final once the month ends; a year wrap once December ends. */
export function isPeriodFinal(p: WrappedPeriod) {
  return isMonthComplete(p.kind === "month" ? { year: p.year, month: p.month } : { year: p.year, month: 12 });
}

export interface RatingJourney {
  timeClass: TimeClass;
  start: number;
  end: number;
  peak: number;
  low: number;
  delta: number;
  games: number;
  points: number[];
}

export interface Persona {
  title: string;
  blurb: string;
  emoji: string;
}

export interface WrappedData {
  username: string;
  period: WrappedPeriod;
  label: string;
  final: boolean;
  totals: WDL & { hours: number; moves: number };
  previousGames: number | null;
  timeClasses: { timeClass: TimeClass; games: number; pct: number }[];
  ratings: RatingJourney[];
  headlineRating: RatingJourney | null;
  topWhite: { name: string; games: number; score: number } | null;
  topBlack: { name: string; games: number; score: number } | null;
  bestOpening: { name: string; games: number; score: number } | null;
  biggestWin: GameRecord | null;
  accuracy: { avg: number | null; count: number; best: GameRecord | null };
  nemesis: { name: string; losses: number; games: number } | null;
  rival: { name: string; games: number; record: WDL } | null;
  peakHour: number | null;
  dayparts: { label: string; games: number; pct: number }[];
  favoriteDay: string | null;
  busiestDay: { date: number; games: number } | null;
  streaks: { longestWin: number; longestLoss: number };
  endings: ReturnType<typeof endings>;
  months: { month: number; games: number; score: number }[];
  bestMonth: { month: number; games: number; score: number } | null;
  persona: Persona;
}

function journey(rs: GameRecord[], tc: TimeClass): RatingJourney | null {
  const games = rs.filter((r) => r.timeClass === tc && r.rated);
  if (games.length < 3) return null;
  const pts = games.map((g) => g.myRating);
  return {
    timeClass: tc,
    start: pts[0],
    end: pts[pts.length - 1],
    peak: Math.max(...pts),
    low: Math.min(...pts),
    delta: pts[pts.length - 1] - pts[0],
    games: games.length,
    points: pts,
  };
}

function pickPersona(w: Omit<WrappedData, "persona">, rs: GameRecord[]): Persona {
  const n = w.totals.games;
  const share = (tc: TimeClass) => w.timeClasses.find((t) => t.timeClass === tc)?.pct ?? 0;
  const night = rs.filter((r) => new Date(r.end).getHours() < 5).length / Math.max(1, n);
  const wins = Math.max(1, w.totals.wins);
  const heavy = w.period.kind === "month" ? 300 : 2500;
  if (n >= heavy)
    return { title: "The Machine", emoji: "⚙️", blurb: `${n.toLocaleString()} games. You don't play chess, you run on it.` };
  if (w.accuracy.count >= 5 && (w.accuracy.avg ?? 0) >= 85)
    return { title: "The Surgeon", emoji: "🩺", blurb: "Precise, clinical, and hard to trick. Your accuracy did the talking." };
  if ((w.headlineRating?.delta ?? 0) >= 100)
    return { title: "The Climber", emoji: "🧗", blurb: `+${w.headlineRating!.delta} in ${w.headlineRating!.timeClass}. Up and to the right.` };
  if (w.streaks.longestWin >= 8)
    return { title: "The Unstoppable", emoji: "🔥", blurb: `${w.streaks.longestWin} wins in a row. Opponents queued up and left disappointed.` };
  if (night >= 0.3)
    return { title: "The Night Owl", emoji: "🦉", blurb: `${Math.round(night * 100)}% of your games ended between midnight and 5am.` };
  if (share("bullet") >= 50)
    return { title: "The Speed Demon", emoji: "⚡", blurb: "Bullet is your native language. Pre-moves are a lifestyle." };
  if (share("daily") >= 50)
    return { title: "The Correspondent", emoji: "✉️", blurb: "You take your time. Every move gets the thought it deserves." };
  if (w.endings.checkmatesDelivered / wins >= 0.35)
    return { title: "The Executioner", emoji: "🗡️", blurb: `${w.endings.checkmatesDelivered} checkmates delivered. You finish what you start.` };
  if (w.endings.wonOnTime / wins >= 0.3)
    return { title: "The Clock Assassin", emoji: "⏱️", blurb: `${w.endings.wonOnTime} wins on time. The clock is your second queen.` };
  if (w.totals.draws / Math.max(1, n) >= 0.15)
    return { title: "The Diplomat", emoji: "🤝", blurb: "Solid, hard to beat, happy to split the point." };
  if ((w.headlineRating?.delta ?? 0) <= -75)
    return { title: "The Resilient", emoji: "🛡️", blurb: "A tough stretch, and you kept showing up. That's how comebacks start." };
  return { title: "The Strategist", emoji: "♟️", blurb: "Balanced, patient and always calculating your next plan." };
}

export function computeWrapped(username: string, period: WrappedPeriod, rs: GameRecord[], prev: GameRecord[] | null): WrappedData {
  const totals = { ...wdl(rs), hours: totalHours(rs), moves: Math.round(rs.reduce((a, r) => a + r.plies / 2, 0)) };
  const tcGroups = groupBy(rs, (r) => r.timeClass);
  const timeClasses = [...tcGroups.entries()]
    .map(([timeClass, g]) => ({ timeClass, games: g.length, pct: (g.length / Math.max(1, rs.length)) * 100 }))
    .sort((a, b) => b.games - a.games);
  const ratings = timeClasses.map((t) => journey(rs, t.timeClass)).filter((j): j is RatingJourney => !!j);

  const top = (color: "white" | "black") => {
    const row = openingTable(rs, color)[0];
    return row ? { name: row.name, games: row.games, score: row.score } : null;
  };
  const allOpenings = [...openingTable(rs, "white"), ...openingTable(rs, "black")].filter((o) => o.games >= 3);
  const best = allOpenings.sort((a, b) => b.score - a.score || b.games - a.games)[0];

  const wins = rs.filter((r) => r.outcome === "win" && r.rated);
  const biggestWin = wins.reduce<GameRecord | null>((b, r) => (!b || r.oppRating > b.oppRating ? r : b), null);

  const byOpp = [...groupBy(rs, (r) => r.opponent.toLowerCase()).values()];
  const nemesisGroup = byOpp
    .map((g) => ({ name: g[0].opponent, losses: g.filter((r) => r.outcome === "loss").length, games: g.length }))
    .filter((x) => x.losses >= 2)
    .sort((a, b) => b.losses - a.losses || a.games - b.games)[0];
  const rivalGroup = byOpp.filter((g) => g.length >= 3).sort((a, b) => b.length - a.length)[0];

  const hours = byHour(rs);
  const peak = hours.reduce((b, h) => (h.games > b.games ? h : b), hours[0]);
  const daypart = (h: number) => (h >= 5 && h < 12 ? 0 : h >= 12 && h < 17 ? 1 : h >= 17 && h < 22 ? 2 : 3);
  const parts = ["Morning", "Afternoon", "Evening", "Late night"].map((label, i) => {
    const games = hours.filter((h) => daypart(h.hour) === i).reduce((a, h) => a + h.games, 0);
    return { label, games, pct: (games / Math.max(1, rs.length)) * 100 };
  });
  const days = byWeekday(rs);
  const favDay = days.reduce((b, d) => (d.games > b.games ? d : b), days[0]);

  const byDate = groupBy(rs, (r) => new Date(r.end).toDateString());
  const busiest = [...byDate.values()].sort((a, b) => b.length - a.length)[0];

  const months =
    period.kind === "year"
      ? Array.from({ length: 12 }, (_, i) => {
          const g = rs.filter((r) => new Date(r.end).getMonth() === i && new Date(r.end).getFullYear() === period.year);
          return { month: i + 1, games: g.length, score: wdl(g).score };
        })
      : [];
  const bestMonth = months.filter((m) => m.games > 0).sort((a, b) => b.games - a.games)[0] ?? null;

  const base: Omit<WrappedData, "persona"> = {
    username,
    period,
    label: periodLabel(period),
    final: isPeriodFinal(period),
    totals,
    previousGames: prev ? prev.length : null,
    timeClasses,
    ratings,
    headlineRating: ratings.find((r) => r.timeClass === timeClasses[0]?.timeClass) ?? ratings[0] ?? null,
    topWhite: top("white"),
    topBlack: top("black"),
    bestOpening: best ? { name: best.name, games: best.games, score: best.score } : null,
    biggestWin,
    accuracy: accuracyStats(rs),
    nemesis: nemesisGroup ?? null,
    rival: rivalGroup ? { name: rivalGroup[0].opponent, games: rivalGroup.length, record: wdl(rivalGroup) } : null,
    peakHour: rs.length ? peak.hour : null,
    dayparts: parts,
    favoriteDay: rs.length ? favDay.day : null,
    busiestDay: busiest ? { date: busiest[0].end, games: busiest.length } : null,
    streaks: streaks(rs),
    endings: endings(rs),
    months,
    bestMonth,
  };
  return { ...base, persona: pickPersona(base, rs) };
}

/** Loads the games for a period (and the previous one for comparison) and computes the wrap. */
export async function loadWrapped(
  username: string,
  period: WrappedPeriod,
  onProgress?: (done: number, total: number) => void,
): Promise<WrappedData> {
  const archives = new Set((await getArchives(username)).map(monthKey));
  const months = periodMonths(period).filter((m) => archives.has(monthKey(m)));
  const prevMonths = periodMonths(previousPeriod(period)).filter((m) => archives.has(monthKey(m)));
  const all = [...months, ...prevMonths];
  const games = await getGamesForMonths(username, all, onProgress);
  const inPeriod = new Set(months.map(monthKey));
  const records = toRecords(games, username);
  const keyOf = (r: GameRecord) => {
    const d = new Date(r.end);
    return monthKey({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  };
  const cur = records.filter((r) => inPeriod.has(keyOf(r)));
  const prev = prevMonths.length ? records.filter((r) => !inPeriod.has(keyOf(r))) : null;
  return computeWrapped(username, period, cur, prev);
}
