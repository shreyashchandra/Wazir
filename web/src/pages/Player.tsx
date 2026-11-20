import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  countryCode,
  currentMonth,
  flagEmoji,
  getArchives,
  getGamesForMonths,
  getProfile,
  getStats,
  monthKey,
  shiftMonth,
  TIME_CLASSES,
  type ChessComProfile,
  type ChessComStats,
  type MonthRef,
  type TimeClass,
} from "../lib/chesscom";
import {
  accuracyStats,
  byHour,
  byWeekday,
  endings,
  formatTimeControl,
  monthly,
  openingTable,
  ratingSeries,
  streaks,
  toRecords,
  totalHours,
  vsRatingBands,
  wdl,
  type GameRecord,
  type OpeningRow,
} from "../lib/stats";
import { MONTH_NAMES } from "../lib/wrapped";
import { Spinner } from "../components/Layout";

export const TC_COLOR: Record<TimeClass, string> = {
  bullet: "var(--series-1)",
  blitz: "var(--series-2)",
  rapid: "var(--series-3)",
  daily: "var(--series-4)",
};
const TC_ICON: Record<TimeClass, string> = { bullet: "➹", blitz: "⚡", rapid: "⏱", daily: "☀" };

type Range = "3" | "6" | "12" | "all";
const RANGES: { id: Range; label: string }[] = [
  { id: "3", label: "3 months" },
  { id: "6", label: "6 months" },
  { id: "12", label: "12 months" },
  { id: "all", label: "All time" },
];

const axis = { stroke: "#8f8c86", fontSize: 12 };
const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
const fmtDay = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function WdlBar({ w, d, l }: { w: number; d: number; l: number }) {
  const t = Math.max(1, w + d + l);
  return (
    <div className="wdl-bar" title={`${w}W ${d}D ${l}L`}>
      {w > 0 && <span className="w" style={{ width: `${(w / t) * 100}%` }} />}
      {d > 0 && <span className="d" style={{ width: `${(d / t) * 100}%` }} />}
      {l > 0 && <span className="l" style={{ width: `${(l / t) * 100}%` }} />}
    </div>
  );
}

function Tip({ active, payload, label, fmt }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string | number; fmt?: (l: string | number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="muted small">{fmt && label !== undefined ? fmt(label) : label}</div>
      {payload.map((p) => (
        <div key={p.name}>
          <span style={{ display: "inline-block", width: 10, height: 3, background: p.color, marginRight: 6, verticalAlign: "middle" }} />
          {p.name}: <b className="num">{typeof p.value === "number" ? Math.round(p.value * 10) / 10 : p.value}</b>
        </div>
      ))}
    </div>
  );
}

export function PlayerPage() {
  const { username = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as "overview" | "openings" | "games" | "wrapped") || "overview";
  const range = (params.get("range") as Range) || "12";
  const tc = (params.get("tc") as TimeClass | "all") || "all";
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    p.set(k, v);
    setParams(p, { replace: true });
  };

  const [profile, setProfile] = useState<ChessComProfile | null>(null);
  const [stats, setStats] = useState<ChessComStats | null>(null);
  const [archives, setArchives] = useState<MonthRef[] | null>(null);
  const [records, setRecords] = useState<GameRecord[] | null>(null);
  const [loading, setLoading] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setProfile(null);
    setStats(null);
    setArchives(null);
    setRecords(null);
    setErr(null);
    Promise.all([getProfile(username), getStats(username), getArchives(username)])
      .then(([p, s, a]) => {
        setProfile(p);
        setStats(s);
        setArchives(a);
      })
      .catch((e) => setErr(e.message?.includes("Not found") ? `No chess.com player named "${username}".` : e.message));
  }, [username]);

  useEffect(() => {
    if (!archives) return;
    let cancelled = false;
    const months = range === "all" ? archives : archives.slice(-Number(range));
    setLoading({ done: 0, total: months.length });
    getGamesForMonths(username, months, (done, total) => !cancelled && setLoading({ done, total }))
      .then((g) => {
        if (cancelled) return;
        setRecords(toRecords(g, profile?.username || username));
        setLoading(null);
      })
      .catch((e) => !cancelled && setErr(e.message));
    return () => {
      cancelled = true;
    };
  }, [archives, range, username, profile?.username]);

  const filtered = useMemo(() => (records ?? []).filter((r) => tc === "all" || r.timeClass === tc), [records, tc]);

  if (err) return <div className="container center-msg"><div className="error-box">{err}</div><Link to="/">Try another username</Link></div>;
  if (!profile || !stats) return <Spinner label="Loading player…" />;

  const name = profile.username || username;
  const cc = countryCode(profile.country);

  return (
    <div className="container" style={{ padding: "28px 0" }}>
      <div className="player-head">
        {profile.avatar ? <img className="avatar" src={profile.avatar} alt="" /> : <div className="avatar">{name[0]?.toUpperCase()}</div>}
        <div>
          <h1 style={{ marginBottom: 4 }}>
            {profile.title && <span className="title-badge">{profile.title}</span>}
            {name} <span style={{ fontSize: "1.4rem" }}>{flagEmoji(cc)}</span>
          </h1>
          <div className="muted small">
            {profile.name && <>{profile.name} · </>}
            {profile.joined && <>Joined {new Date(profile.joined * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" })} · </>}
            {profile.followers !== undefined && <>{profile.followers.toLocaleString()} followers · </>}
            {profile.league && <>{profile.league} league · </>}
            <a href={profile.url} target="_blank" rel="noreferrer">chess.com profile ↗</a>
          </div>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginTop: 20 }}>
        {TIME_CLASSES.map((t) => {
          const r = stats[`chess_${t}` as const];
          if (!r?.last) return null;
          return (
            <div className="tile rating-card" key={t}>
              <span className="tc"><span className="dot" style={{ background: TC_COLOR[t] }} />{t}</span>
              <span className="value">{r.last.rating}</span>
              <span className="sub">
                Best {r.best?.rating ?? "–"}
                {r.record && <> · {r.record.win}W {r.record.draw}D {r.record.loss}L</>}
              </span>
            </div>
          );
        })}
        {stats.tactics?.highest && (
          <div className="tile rating-card">
            <span className="tc">🧩 Puzzles</span>
            <span className="value">{stats.tactics.highest.rating}</span>
            <span className="sub">Peak puzzle rating{stats.puzzle_rush?.best && <> · Rush best {stats.puzzle_rush.best.score}</>}</span>
          </div>
        )}
      </div>

      <WrapBanner username={name} archives={archives ?? []} />

      <div className="tabs">
        {(["overview", "openings", "games", "wrapped"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setParam("tab", t)} style={{ textTransform: "capitalize" }}>
            {t}
          </button>
        ))}
      </div>

      {tab !== "wrapped" && (
        <div className="row" style={{ marginBottom: 18 }}>
          <div className="seg">
            {RANGES.map((r) => (
              <button key={r.id} className={range === r.id ? "on" : ""} onClick={() => setParam("range", r.id)}>{r.label}</button>
            ))}
          </div>
          <div className="seg">
            {(["all", ...TIME_CLASSES] as const).map((t) => (
              <button key={t} className={tc === t ? "on" : ""} onClick={() => setParam("tc", t)} style={{ textTransform: "capitalize" }}>{t}</button>
            ))}
          </div>
          {loading && (
            <span className="row small muted" style={{ gap: 8 }}>
              <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Loading games {loading.done}/{loading.total} months
            </span>
          )}
        </div>
      )}

      {tab === "wrapped" ? (
        <WrapList username={name} archives={archives ?? []} />
      ) : !records ? (
        <Spinner label="Fetching game archives from chess.com…" />
      ) : filtered.length === 0 ? (
        <div className="center-msg muted">No standard chess games in this range.</div>
      ) : tab === "overview" ? (
        <Overview rs={filtered} all={records} tc={tc} />
      ) : tab === "openings" ? (
        <Openings rs={filtered} />
      ) : (
        <Games rs={filtered} username={name} />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- overview */

function Overview({ rs, all, tc }: { rs: GameRecord[]; all: GameRecord[]; tc: TimeClass | "all" }) {
  const s = wdl(rs);
  const acc = accuracyStats(rs);
  const st = streaks(rs);
  const hours = totalHours(rs);
  const months = monthly(rs);
  const shown = (tc === "all" ? TIME_CLASSES : [tc]).filter((t) => all.some((r) => r.timeClass === t && r.rated));

  // Merge per-class rating series onto one time axis for the line chart.
  const ratingData = useMemo(() => {
    const pts: Record<string, number | undefined>[] = [];
    for (const t of shown) for (const p of ratingSeries(rs.length ? all.filter((r) => r.end >= rs[0].end) : all, t)) pts.push({ t: p.t, [t]: p.rating });
    return pts.sort((a, b) => (a.t as number) - (b.t as number));
  }, [rs, all, shown.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const colorRows = (["white", "black"] as const).map((c) => ({ c, ...wdl(rs.filter((r) => r.color === c)) }));
  const e = endings(rs);
  const bands = vsRatingBands(rs);
  const hourData = byHour(rs).map((h) => ({ hour: `${h.hour}:00`, games: h.games, score: h.games ? h.score : null }));
  const dayData = byWeekday(rs);
  const bestWins = rs.filter((r) => r.outcome === "win" && r.rated).sort((a, b) => b.oppRating - a.oppRating).slice(0, 6);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="grid grid-4">
        <div className="tile"><div className="label">Games</div><div className="value">{s.games.toLocaleString()}</div><div className="sub">{hours >= 1 ? `${Math.round(hours).toLocaleString()} hours played` : "live games"}</div></div>
        <div className="tile"><div className="label">Score</div><div className="value">{s.score.toFixed(1)}%</div><div className="sub"><span className="result-win">{s.wins}W</span> · <span className="result-draw">{s.draws}D</span> · <span className="result-loss">{s.losses}L</span></div></div>
        <div className="tile"><div className="label">Avg accuracy</div><div className="value">{acc.avg ? acc.avg.toFixed(1) : "–"}</div><div className="sub">{acc.count} reviewed game{acc.count === 1 ? "" : "s"} (chess.com data)</div></div>
        <div className="tile"><div className="label">Best streak</div><div className="value">{st.longestWin}</div><div className="sub">wins in a row · worst run {st.longestLoss} losses</div></div>
      </div>

      <div className="card">
        <div className="card-title">
          <h3>Rating progress</h3>
          <div className="legend">{shown.map((t) => <span key={t}><i style={{ background: TC_COLOR[t] }} />{t}</span>)}</div>
        </div>
        <div className="chart-box">
          <ResponsiveContainer>
            <LineChart data={ratingData} margin={{ top: 6, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={ratingData.length && (ratingData[ratingData.length - 1].t as number) - (ratingData[0].t as number) < 200 * 864e5 ? fmtDay : fmtDate} minTickGap={48} {...axis} />
              <YAxis domain={["auto", "auto"]} {...axis} width={50} />
              <Tooltip content={<Tip fmt={(l) => new Date(Number(l)).toLocaleDateString()} />} />
              {shown.map((t) => (
                <Line key={t} dataKey={t} name={t} stroke={TC_COLOR[t]} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title"><h3>Games per month</h3><span className="muted small">bar height = games</span></div>
          <div className="chart-box sm">
            <ResponsiveContainer>
              <BarChart data={months} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="month" {...axis} tickFormatter={(m: string) => MONTH_NAMES[Number(m.slice(5)) - 1].slice(0, 3)} />
                <YAxis {...axis} />
                <Tooltip content={<Tip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Bar dataKey="games" name="Games" fill="var(--series-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="card-title"><h3>Score % and accuracy by month</h3></div>
          <div className="legend" style={{ marginBottom: 6 }}>
            <span><i style={{ background: "var(--series-3)" }} />Score %</span>
            <span><i style={{ background: "var(--series-4)" }} />Avg accuracy</span>
          </div>
          <div className="chart-box sm">
            <ResponsiveContainer>
              <LineChart data={months} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="month" {...axis} tickFormatter={(m: string) => MONTH_NAMES[Number(m.slice(5)) - 1].slice(0, 3)} />
                <YAxis domain={[0, 100]} {...axis} />
                <Tooltip content={<Tip />} />
                <Line dataKey="score" name="Score %" stroke="var(--series-3)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                <Line dataKey="accuracy" name="Avg accuracy" stroke="var(--series-4)" strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-3">
        <div className="card">
          <h3>By color</h3>
          <table className="table"><tbody>
            {colorRows.map((r) => (
              <tr key={r.c}><td style={{ textTransform: "capitalize" }}>{r.c}</td><td className="num">{r.games}</td><td><WdlBar w={r.wins} d={r.draws} l={r.losses} /></td><td className="num">{r.score.toFixed(0)}%</td></tr>
            ))}
          </tbody></table>
        </div>
        <div className="card">
          <h3>Against opponents rated…</h3>
          <table className="table"><tbody>
            {bands.map((b) => (
              <tr key={b.label}><td>{b.label}</td><td className="num">{b.games}</td><td><WdlBar w={b.wins} d={b.draws} l={b.losses} /></td><td className="num">{b.games ? `${b.score.toFixed(0)}%` : "–"}</td></tr>
            ))}
          </tbody></table>
        </div>
        <div className="card">
          <h3>How games ended</h3>
          <table className="table"><tbody>
            <tr><td>Wins by checkmate</td><td className="num">{e.checkmatesDelivered}</td></tr>
            <tr><td>Wins by resignation</td><td className="num">{e.resignationsForced}</td></tr>
            <tr><td>Wins on time</td><td className="num">{e.wonOnTime}</td></tr>
            <tr><td>Losses by checkmate</td><td className="num">{e.gotCheckmated}</td></tr>
            <tr><td>Losses by resignation</td><td className="num">{e.resigned}</td></tr>
            <tr><td>Losses on time</td><td className="num">{e.lostOnTime}</td></tr>
            <tr><td>Draws</td><td className="num">{e.drawsAgreed + e.drawsRepetition + e.drawsStalemate + e.drawsOther}</td></tr>
          </tbody></table>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title"><h3>When you play</h3><span className="muted small">your local time</span></div>
          <div className="chart-box sm">
            <ResponsiveContainer>
              <BarChart data={hourData} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="hour" {...axis} interval={3} />
                <YAxis {...axis} />
                <Tooltip content={<Tip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Bar dataKey="games" name="Games" fill="var(--series-1)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <h3>By day of week</h3>
          <table className="table"><tbody>
            {dayData.map((d) => (
              <tr key={d.day}><td>{d.day}</td><td className="num">{d.games}</td><td><WdlBar w={d.wins} d={d.draws} l={d.losses} /></td><td className="num">{d.games ? `${d.score.toFixed(0)}%` : "–"}</td></tr>
            ))}
          </tbody></table>
        </div>
      </div>

      {bestWins.length > 0 && (
        <div className="card">
          <h3>Best wins</h3>
          <div className="table-wrap"><table className="table"><tbody>
            {bestWins.map((r) => (
              <tr key={r.id}>
                <td><b>{r.opponent}</b> <span className="muted">({r.oppRating})</span></td>
                <td className="muted" style={{ textTransform: "capitalize" }}>{r.timeClass}</td>
                <td className="muted">{new Date(r.end).toLocaleDateString()}</td>
                <td style={{ textAlign: "right" }}><ReviewLink r={r} /></td>
              </tr>
            ))}
          </tbody></table></div>
        </div>
      )}
    </div>
  );
}

function ReviewLink({ r, username }: { r: GameRecord; username?: string }) {
  const { username: u = "" } = useParams();
  return (
    <Link className="btn btn-sm" to={`/review/${encodeURIComponent(username || u)}/${r.id}`}>
      Review
    </Link>
  );
}

/* --------------------------------------------------------------- openings */

function OpeningTable({ rows, title }: { rows: OpeningRow[]; title: string }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Opening</th><th>Games</th><th>W / D / L</th><th>Score</th><th>Accuracy</th></tr></thead>
          <tbody>
            {rows.slice(0, 15).map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className="num">{r.games}</td>
                <td><WdlBar w={r.wins} d={r.draws} l={r.losses} /></td>
                <td className="num">{r.score.toFixed(0)}%</td>
                <td className="num">{r.avgAccuracy ? r.avgAccuracy.toFixed(1) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Openings({ rs }: { rs: GameRecord[] }) {
  const [by, setBy] = useState<"family" | "opening">("family");
  return (
    <div className="stack">
      <div className="seg" style={{ alignSelf: "flex-start" }}>
        <button className={by === "family" ? "on" : ""} onClick={() => setBy("family")}>Opening families</button>
        <button className={by === "opening" ? "on" : ""} onClick={() => setBy("opening")}>Exact variations</button>
      </div>
      <div className="grid grid-2">
        <OpeningTable title="As White" rows={openingTable(rs, "white", by)} />
        <OpeningTable title="As Black" rows={openingTable(rs, "black", by)} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ games */

function Games({ rs, username }: { rs: GameRecord[]; username: string }) {
  const [limit, setLimit] = useState(50);
  const sorted = [...rs].reverse();
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th></th><th>Opponent</th><th>Type</th><th>Opening</th><th>Accuracy</th><th>Moves</th><th>Date</th><th></th></tr></thead>
          <tbody>
            {sorted.slice(0, limit).map((r) => (
              <tr key={r.id}>
                <td><span className={`pill-${r.outcome}`}>{r.outcome === "win" ? "W" : r.outcome === "loss" ? "L" : "D"}</span></td>
                <td>
                  <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, marginRight: 6, background: r.color === "white" ? "#f3f3f3" : "#111", border: "1px solid #666" }} />
                  <b>{r.opponent}</b> <span className="muted">({r.oppRating})</span>
                </td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{TC_ICON[r.timeClass]} {formatTimeControl(r.timeControl)}</td>
                <td className="small" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.opening}>{r.opening}</td>
                <td className="num">{r.myAccuracy !== undefined ? <><b>{r.myAccuracy.toFixed(1)}</b> <span className="muted">/ {r.oppAccuracy?.toFixed(1)}</span></> : <span className="muted">–</span>}</td>
                <td className="num muted">{Math.ceil(r.plies / 2)}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{new Date(r.end).toLocaleDateString()}</td>
                <td style={{ textAlign: "right" }}><ReviewLink r={r} username={username} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > limit && (
        <div style={{ padding: 14, textAlign: "center" }}>
          <button className="btn" onClick={() => setLimit((l) => l + 100)}>Show more ({sorted.length - limit} left)</button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- wrapped */

export const WRAP_GRADIENTS = [
  "linear-gradient(135deg,#5b2a86,#1f8a70)",
  "linear-gradient(135deg,#b23a48,#f2a541)",
  "linear-gradient(135deg,#1d3557,#457b9d)",
  "linear-gradient(135deg,#2d6a4f,#95d5b2)",
  "linear-gradient(135deg,#6a040f,#e85d04)",
  "linear-gradient(135deg,#3a0ca3,#f72585)",
];

function lastCompleteMonth(): MonthRef {
  return shiftMonth(currentMonth(), -1);
}

function WrapBanner({ username, archives }: { username: string; archives: MonthRef[] }) {
  const m = lastCompleteMonth();
  if (!archives.some((a) => monthKey(a) === monthKey(m))) return null;
  return (
    <Link className="wrap-banner" to={`/wrapped/${encodeURIComponent(username)}/${monthKey(m)}`} style={{ marginTop: 18 }}>
      <span style={{ fontSize: "2rem" }}>🎁</span>
      <div>
        <div className="big">Your {MONTH_NAMES[m.month - 1]} Chess Wrapped is ready</div>
        <div style={{ opacity: 0.85 }}>Your month in chess: games, rating swings, openings, rivals and your chess persona.</div>
      </div>
      <span className="spacer" />
      <span className="btn" style={{ background: "#fff", color: "#222" }}>Open Wrapped →</span>
    </Link>
  );
}

function WrapList({ username, archives }: { username: string; archives: MonthRef[] }) {
  const done = archives.filter((a) => monthKey(a) !== monthKey(currentMonth())).reverse();
  const years = [...new Set(archives.map((a) => a.year))].reverse();
  const cur = currentMonth();
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div>
        <h3>Year Wrapped</h3>
        <div className="wrap-list">
          {years.map((y, i) => (
            <Link key={y} className="wrap-chip" style={{ background: WRAP_GRADIENTS[i % WRAP_GRADIENTS.length] }} to={`/wrapped/${encodeURIComponent(username)}/${y}`}>
              {y} <small>{y === cur.year ? "So far this year" : "Full year"}</small>
            </Link>
          ))}
        </div>
      </div>
      <div>
        <h3>Monthly Wrapped</h3>
        <p className="muted small" style={{ marginTop: -6 }}>A new one drops when each month ends.</p>
        <div className="wrap-list">
          {archives.some((a) => monthKey(a) === monthKey(cur)) && (
            <Link className="wrap-chip" style={{ background: "var(--surface-3)" }} to={`/wrapped/${encodeURIComponent(username)}/${monthKey(cur)}`}>
              {MONTH_NAMES[cur.month - 1]} {cur.year} <small>In progress</small>
            </Link>
          )}
          {done.map((m, i) => (
            <Link key={monthKey(m)} className="wrap-chip" style={{ background: WRAP_GRADIENTS[(i + 2) % WRAP_GRADIENTS.length] }} to={`/wrapped/${encodeURIComponent(username)}/${monthKey(m)}`}>
              {MONTH_NAMES[m.month - 1]} <small>{m.year}</small>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
