import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toPng } from "html-to-image";
import { currentMonth, monthKey, shiftMonth } from "../lib/chesscom";
import { loadWrapped, MONTH_NAMES, type WrappedData, type WrappedPeriod } from "../lib/wrapped";
import { formatTimeControl } from "../lib/stats";
import { Spinner } from "../components/Layout";
import { loadFileTracks, MusicPlayer, SYNTH_TRACKS, trackForPersona, type Track } from "../lib/music";
import { play as playSfx } from "../lib/sound";

/* ------------------------------------------------------------------ start */

export function WrappedStart() {
  const nav = useNavigate();
  const last = shiftMonth(currentMonth(), -1);
  const [user, setUser] = useState("");
  const [period, setPeriod] = useState(monthKey(last));
  const options = useMemo(() => {
    const out: { v: string; label: string }[] = [];
    const cur = currentMonth();
    out.push({ v: String(cur.year), label: `${cur.year} (so far)` });
    out.push({ v: String(cur.year - 1), label: `${cur.year - 1} — full year` });
    for (let i = 1; i <= 24; i++) {
      const m = shiftMonth(cur, -i);
      out.push({ v: monthKey(m), label: `${MONTH_NAMES[m.month - 1]} ${m.year}` });
    }
    return out;
  }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (user.trim()) nav(`/wrapped/${encodeURIComponent(user.trim())}/${period}`);
  };
  return (
    <div className="container" style={{ padding: "48px 0", maxWidth: 640 }}>
      <span className="eyebrow">Chess Wrapped</span>
      <h1>Your chess, wrapped.</h1>
      <p className="muted">
        A story-style recap of your month or year on chess.com: games, hours, rating swings, signature openings, your
        nemesis, your best win and your chess persona. A new monthly Wrapped is ready as soon as each month ends; the year
        Wrapped is final after December 31.
      </p>
      <form className="card stack" onSubmit={submit} style={{ marginTop: 20 }}>
        <input className="input" placeholder="chess.com username" value={user} onChange={(e) => setUser(e.target.value)} autoCapitalize="off" autoFocus />
        <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {options.map((o) => (
            <option key={o.v} value={o.v}>{o.label}</option>
          ))}
        </select>
        <button className="btn btn-primary">Unwrap</button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ story */

function parsePeriod(p: string): WrappedPeriod | null {
  const m = p.match(/^(\d{4})(?:-(\d{2}))?$/);
  if (!m) return null;
  return m[2] ? { kind: "month", year: Number(m[1]), month: Number(m[2]) } : { kind: "year", year: Number(m[1]) };
}

const BG = [
  "linear-gradient(160deg,#2b1055,#7597de)",
  "linear-gradient(160deg,#0f3d2e,#3fa36b)",
  "linear-gradient(160deg,#5f0f40,#fb8b24)",
  "linear-gradient(160deg,#03045e,#00b4d8)",
  "linear-gradient(160deg,#3c1642,#ff5d8f)",
  "linear-gradient(160deg,#1b263b,#e0a458)",
  "linear-gradient(160deg,#081c15,#74c69d)",
  "linear-gradient(160deg,#370617,#e85d04)",
  "linear-gradient(160deg,#240046,#c77dff)",
  "linear-gradient(160deg,#0b090a,#ba181b)",
];

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;

interface Slide {
  id: string;
  node: ReactNode;
}

function buildSlides(w: WrappedData): Slide[] {
  const s: Slide[] = [];
  const t = w.totals;
  const name = w.username;
  const scope = w.period.kind === "month" ? "this month" : "this year";

  s.push({
    id: "intro",
    node: (
      <>
        <div className="kicker">Chess Wrapped · {w.label}</div>
        <div className="big" style={{ fontSize: "2.6rem" }}>Hey {name},</div>
        <div className="line">{w.final ? `${w.label} is in the books.` : `Here's ${w.label} so far.`} Let's see how you played.</div>
        <div className="line" style={{ opacity: 0.7, marginTop: 20 }}>Tap to continue →</div>
      </>
    ),
  });

  if (t.games === 0) {
    s.push({ id: "empty", node: <><div className="big">No games {scope}.</div><div className="line">The board misses you. Come back after a few games.</div></> });
    return s;
  }

  const delta = w.previousGames ? Math.round(((t.games - w.previousGames) / w.previousGames) * 100) : null;
  s.push({
    id: "games",
    node: (
      <>
        <div className="kicker">You played</div>
        <div className="huge">{t.games.toLocaleString()}</div>
        <div className="big">games</div>
        {t.hours >= 1 && <div className="line">That's about <b>{Math.round(t.hours).toLocaleString()} hours</b> at the board and {t.moves.toLocaleString()} moves.</div>}
        {delta !== null && (
          <div className="line">{delta >= 0 ? `${delta}% more` : `${Math.abs(delta)}% fewer`} than {w.period.kind === "month" ? "last month" : "last year"} ({w.previousGames}).</div>
        )}
      </>
    ),
  });

  s.push({
    id: "results",
    node: (
      <>
        <div className="kicker">Your results</div>
        <div className="huge">{t.winRate.toFixed(0)}%</div>
        <div className="big">win rate</div>
        <div className="list">
          <div><span>Wins</span><span>{t.wins}</span></div>
          <div><span>Draws</span><span>{t.draws}</span></div>
          <div><span>Losses</span><span>{t.losses}</span></div>
        </div>
      </>
    ),
  });

  if (w.timeClasses.length) {
    const fav = w.timeClasses[0];
    s.push({
      id: "tc",
      node: (
        <>
          <div className="kicker">Your speed</div>
          <div className="big" style={{ textTransform: "capitalize" }}>{fav.timeClass} all the way.</div>
          <div className="line">{fav.pct.toFixed(0)}% of your games were {fav.timeClass}.</div>
          <div className="list">
            {w.timeClasses.map((x) => (
              <div key={x.timeClass}><span style={{ textTransform: "capitalize" }}>{x.timeClass}</span><span>{plural(x.games, "game")}</span></div>
            ))}
          </div>
        </>
      ),
    });
  }

  if (w.headlineRating) {
    const r = w.headlineRating;
    const max = Math.max(...r.points);
    const min = Math.min(...r.points);
    const pts = r.points.map((p, i) => `${(i / Math.max(1, r.points.length - 1)) * 100},${100 - ((p - min) / Math.max(1, max - min)) * 90 - 5}`).join(" ");
    s.push({
      id: "rating",
      node: (
        <>
          <div className="kicker" style={{ textTransform: "uppercase" }}>{r.timeClass} rating</div>
          <div className="huge">{r.delta >= 0 ? "+" : ""}{r.delta}</div>
          <div className="line">{r.start} → <b>{r.end}</b> · peak <b>{r.peak}</b></div>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: 130 }}>
            <polyline points={pts} fill="none" stroke="#fff" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
          {w.ratings.length > 1 && (
            <div className="list">
              {w.ratings.filter((x) => x.timeClass !== r.timeClass).map((x) => (
                <div key={x.timeClass}><span style={{ textTransform: "capitalize" }}>{x.timeClass}</span><span>{x.end} ({x.delta >= 0 ? "+" : ""}{x.delta})</span></div>
              ))}
            </div>
          )}
        </>
      ),
    });
  }

  if (w.topWhite || w.topBlack) {
    s.push({
      id: "openings",
      node: (
        <>
          <div className="kicker">Your signature openings</div>
          {w.topWhite && (<><div className="line" style={{ opacity: 0.8 }}>Most played with White</div><div className="big">{w.topWhite.name}</div><div className="line">{plural(w.topWhite.games, "game")} · {w.topWhite.score.toFixed(0)}% score</div></>)}
          {w.topBlack && (<><div className="line" style={{ opacity: 0.8, marginTop: 10 }}>Most played with Black</div><div className="big">{w.topBlack.name}</div><div className="line">{plural(w.topBlack.games, "game")} · {w.topBlack.score.toFixed(0)}% score</div></>)}
          {w.bestOpening && <div className="line" style={{ marginTop: 10 }}>Your best weapon: <b>{w.bestOpening.name}</b> ({w.bestOpening.score.toFixed(0)}% over {w.bestOpening.games} games)</div>}
        </>
      ),
    });
  }

  if (w.accuracy.count > 0) {
    s.push({
      id: "accuracy",
      node: (
        <>
          <div className="kicker">Precision</div>
          <div className="huge">{w.accuracy.avg!.toFixed(1)}</div>
          <div className="big">average accuracy</div>
          <div className="line">Across {plural(w.accuracy.count, "reviewed game")}.</div>
          {w.accuracy.best && (
            <div className="line">Your sharpest game: <b>{w.accuracy.best.myAccuracy!.toFixed(1)}%</b> vs {w.accuracy.best.opponent} ({formatTimeControl(w.accuracy.best.timeControl)}).</div>
          )}
        </>
      ),
    });
  }

  if (w.biggestWin) {
    const g = w.biggestWin;
    s.push({
      id: "bestwin",
      node: (
        <>
          <div className="kicker">Your biggest win</div>
          <div className="big">You beat {g.opponent}</div>
          <div className="huge" style={{ fontSize: "4rem" }}>{g.oppRating}</div>
          <div className="line">
            {g.oppRating > g.myRating ? `${g.oppRating - g.myRating} points above you. Giant slayer.` : "Your highest-rated victim."} Won by {g.oppResult === "checkmated" ? "checkmate" : g.oppResult === "timeout" ? "time" : g.oppResult === "resigned" ? "resignation" : g.oppResult}.
          </div>
          <Link to={`/review/${encodeURIComponent(w.username)}/${g.id}`} className="btn" style={{ background: "#fff", color: "#111", alignSelf: "flex-start", position: "relative", zIndex: 6 }}>Review this game</Link>
        </>
      ),
    });
  }

  if (w.nemesis || w.rival) {
    s.push({
      id: "rivals",
      node: (
        <>
          <div className="kicker">Friends &amp; foes</div>
          {w.nemesis && (<><div className="line" style={{ opacity: 0.8 }}>Your nemesis</div><div className="big">{w.nemesis.name}</div><div className="line">Beat you {w.nemesis.losses} time{w.nemesis.losses === 1 ? "" : "s"} in {plural(w.nemesis.games, "game")}.</div></>)}
          {w.rival && (<><div className="line" style={{ opacity: 0.8, marginTop: 14 }}>Your most-played opponent</div><div className="big">{w.rival.name}</div><div className="line">{plural(w.rival.games, "game")} · {w.rival.record.wins}W {w.rival.record.draws}D {w.rival.record.losses}L</div></>)}
        </>
      ),
    });
  }

  if (w.peakHour !== null) {
    const part = [...w.dayparts].sort((a, b) => b.games - a.games)[0];
    s.push({
      id: "when",
      node: (
        <>
          <div className="kicker">Prime time</div>
          <div className="big">You're a {part.label.toLowerCase()} player.</div>
          <div className="line">Most games ended around <b>{hourLabel(w.peakHour)}</b>; your favorite day was <b>{w.favoriteDay}</b>.</div>
          <div className="list">
            {w.dayparts.map((d) => (<div key={d.label}><span>{d.label}</span><span>{d.pct.toFixed(0)}%</span></div>))}
          </div>
          {w.busiestDay && <div className="line">Busiest day: {new Date(w.busiestDay.date).toLocaleDateString(undefined, { month: "long", day: "numeric" })} with {w.busiestDay.games} games.</div>}
        </>
      ),
    });
  }

  s.push({
    id: "endings",
    node: (
      <>
        <div className="kicker">How it ended</div>
        <div className="list">
          <div><span>Checkmates delivered</span><span>{w.endings.checkmatesDelivered}</span></div>
          <div><span>Resignations forced</span><span>{w.endings.resignationsForced}</span></div>
          <div><span>Wins on time</span><span>{w.endings.wonOnTime}</span></div>
          <div><span>Times flagged</span><span>{w.endings.lostOnTime}</span></div>
          <div><span>Longest win streak</span><span>{w.streaks.longestWin}</span></div>
        </div>
      </>
    ),
  });

  if (w.period.kind === "year" && w.months.some((m) => m.games)) {
    const max = Math.max(...w.months.map((m) => m.games), 1);
    s.push({
      id: "months",
      node: (
        <>
          <div className="kicker">Your year, month by month</div>
          {w.bestMonth && <div className="big">{MONTH_NAMES[w.bestMonth.month - 1]} was your busiest month.</div>}
          <div className="bars-v">
            {w.months.map((m) => (<div key={m.month} style={{ height: `${(m.games / max) * 100}%` }} title={`${MONTH_NAMES[m.month - 1]}: ${m.games}`} />))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, opacity: 0.8 }}>
            {w.months.map((m) => <span key={m.month}>{MONTH_NAMES[m.month - 1][0]}</span>)}
          </div>
        </>
      ),
    });
  }

  s.push({
    id: "persona",
    node: (
      <>
        <div className="kicker">Your chess persona</div>
        <div style={{ fontSize: "4.5rem" }}>{w.persona.emoji}</div>
        <div className="big" style={{ fontSize: "2.4rem" }}>{w.persona.title}</div>
        <div className="line">{w.persona.blurb}</div>
      </>
    ),
  });

  s.push({ id: "summary", node: <SummaryCard w={w} /> });
  return s;
}

function SummaryCard({ w }: { w: WrappedData }) {
  const t = w.totals;
  return (
    <div className="summary-card">
      <div className="kicker">Wazir · Chess Wrapped</div>
      <div className="big">{w.username}'s {w.label}</div>
      <div className="line">{w.persona.emoji} {w.persona.title}</div>
      <div className="grid2">
        <div><div className="k">Games</div><div className="v">{t.games.toLocaleString()}</div></div>
        <div><div className="k">Win rate</div><div className="v">{t.winRate.toFixed(0)}%</div></div>
        <div><div className="k">Hours</div><div className="v">{Math.round(t.hours)}</div></div>
        <div><div className="k">{w.headlineRating ? `${w.headlineRating.timeClass} Δ` : "Draws"}</div><div className="v">{w.headlineRating ? `${w.headlineRating.delta >= 0 ? "+" : ""}${w.headlineRating.delta}` : t.draws}</div></div>
        <div><div className="k">Accuracy</div><div className="v">{w.accuracy.avg ? w.accuracy.avg.toFixed(1) : "–"}</div></div>
        <div><div className="k">Best win</div><div className="v">{w.biggestWin ? w.biggestWin.oppRating : "–"}</div></div>
        <div style={{ gridColumn: "1 / -1" }}><div className="k">Top opening</div><div className="v" style={{ fontSize: "1rem" }}>{w.topWhite?.name ?? w.topBlack?.name ?? "–"}</div></div>
      </div>
    </div>
  );
}

const SLIDE_MS = 7000;

export function WrappedStory() {
  const { username = "", period: periodParam = "" } = useParams();
  const period = parsePeriod(periodParam);
  const [data, setData] = useState<WrappedData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [idx, setIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [started, setStarted] = useState(false);
  const [tracks, setTracks] = useState<Track[]>(SYNTH_TRACKS);
  const [track, setTrack] = useState<Track | null>(null);
  const [muted, setMuted] = useState(false);
  const storyRef = useRef<HTMLDivElement>(null);
  const player = useRef<MusicPlayer | null>(null);

  useEffect(() => {
    loadFileTracks().then((f) => f.length && setTracks([...f, ...SYNTH_TRACKS]));
    return () => {
      player.current?.dispose();
      player.current = null;
    };
  }, []);

  const playTrack = useCallback(async (t: Track) => {
    if (!player.current) player.current = new MusicPlayer();
    setTrack(t);
    await player.current.play(t);
  }, []);

  const start = () => {
    setStarted(true);
    if (!data) return;
    // Your own uploaded tracks win; otherwise the generated track that fits your persona.
    const preferred = tracks.find((t) => t.kind === "file") ?? tracks.find((t) => t.id === trackForPersona(data.persona.title)) ?? tracks[0];
    if (!muted) playTrack(preferred);
  };

  const cycleTrack = (dir: number) => {
    const i = Math.max(0, tracks.findIndex((t) => t.id === track?.id));
    const t = tracks[(i + dir + tracks.length) % tracks.length];
    setMuted(false);
    player.current?.setVolume(0.55);
    playTrack(t);
  };

  const toggleMute = () => {
    if (!player.current || !track) {
      setMuted(false);
      if (data) playTrack(tracks.find((t) => t.id === trackForPersona(data.persona.title)) ?? tracks[0]);
      return;
    }
    const m = !muted;
    setMuted(m);
    player.current.setVolume(m ? 0 : 0.55);
  };

  useEffect(() => {
    if (!period) return;
    setData(null);
    setErr(null);
    setIdx(0);
    setStarted(false);
    loadWrapped(username, period, (done, total) => setProgress({ done, total }))
      .then(setData)
      .catch((e) => setErr(e.message?.includes("Not found") ? `No chess.com player named "${username}".` : e.message));
  }, [username, periodParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const slides = useMemo(() => (data ? buildSlides(data) : []), [data]);
  const last = slides.length - 1;

  const next = useCallback(() => {
    setIdx((i) => Math.min(last, i + 1));
    setElapsed(0);
  }, [last]);
  const prev = useCallback(() => {
    setIdx((i) => Math.max(0, i - 1));
    setElapsed(0);
  }, []);

  useEffect(() => {
    if (!slides.length || paused || idx >= last || !started) return;
    const start = performance.now() - elapsed;
    let raf = 0;
    const tick = () => {
      const e = performance.now() - start;
      if (e >= SLIDE_MS) next();
      else {
        setElapsed(e);
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [idx, paused, slides.length, last, next, started]); // eslint-disable-line react-hooks/exhaustive-deps

  // A little sting when the persona is revealed.
  useEffect(() => {
    if (started && slides[idx]?.id === "persona") playSfx("notify");
  }, [idx, started, slides]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  const save = async () => {
    if (!storyRef.current) return;
    setSaving(true);
    try {
      const url = await toPng(storyRef.current, {
        pixelRatio: 3,
        filter: (n) => !(n instanceof HTMLElement && (n.classList.contains("bars") || n.classList.contains("tap") || n.classList.contains("start-overlay"))),
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = `wazir-wrapped-${username}-${periodParam}.png`;
      a.click();
    } finally {
      setSaving(false);
    }
  };

  const share = async () => {
    const url = location.href;
    const text = data ? `My ${data.label} Chess Wrapped: ${data.persona.title} ${data.persona.emoji}` : "My Chess Wrapped";
    try {
      if (navigator.share) await navigator.share({ title: "Chess Wrapped", text, url });
      else await navigator.clipboard.writeText(url);
    } catch {
      /* user cancelled */
    }
  };

  if (!period) return <div className="container center-msg">Invalid period. <Link to="/wrapped">Pick one here.</Link></div>;
  if (err) return <div className="container center-msg"><div className="error-box">{err}</div></div>;
  if (!data) return <Spinner label={progress ? `Unwrapping ${progress.done}/${progress.total} months of games…` : "Unwrapping…"} />;

  const shift = (d: number) => {
    if (period.kind === "year") return `${period.year + d}`;
    return monthKey(shiftMonth({ year: period.year, month: period.month }, d));
  };
  const nextKey = shift(1);
  const canNext = period.kind === "year" ? period.year < currentMonth().year : monthKey(shiftMonth({ year: period.year, month: period.month }, 1)) <= monthKey(currentMonth());

  return (
    <div className="wrapped-stage">
      <div className="wrapped-col">
        <div
          className="story"
          ref={storyRef}
          style={{ background: BG[idx % BG.length] }}
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerLeave={() => setPaused(false)}
        >
          <div className="bars">
            {slides.map((s, i) => (
              <span key={s.id}><i style={{ width: i < idx ? "100%" : i === idx ? `${idx === last ? 100 : (elapsed / SLIDE_MS) * 100}%` : "0%" }} /></span>
            ))}
          </div>
          <div className="tap l" onClick={prev} />
          <div className="tap r" onClick={next} />
          <div className="slide" key={slides[idx].id}>{slides[idx].node}</div>
          {!started && (
            <div className="start-overlay" onClick={start} role="button" aria-label="Start Wrapped">
              <div className="play">▶</div>
              <div style={{ fontWeight: 800, fontSize: "1.2rem" }}>Tap to play</div>
              <div style={{ opacity: 0.85, fontSize: ".9rem" }}>Sound on for the soundtrack 🎧</div>
            </div>
          )}
        </div>
        <div className={`music-bar${muted || !track ? " paused" : ""}`}>
          <span className="eq" aria-hidden="true"><i /><i /><i /></span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="title">{track ? track.title : "Soundtrack"}</div>
            <div className="mood">{track ? (track.kind === "synth" ? `${track.mood} · original Wazir track` : track.mood) : "Starts when you tap play"}</div>
          </div>
          <button className="icon-btn" onClick={() => cycleTrack(-1)} aria-label="Previous track" disabled={!started}>⏮</button>
          <button className="icon-btn" onClick={toggleMute} aria-label={muted || !track ? "Play music" : "Mute music"} disabled={!started}>
            {muted || !track ? "▶" : "❚❚"}
          </button>
          <button className="icon-btn" onClick={() => cycleTrack(1)} aria-label="Next track" disabled={!started}>⏭</button>
        </div>
        <div className="wrapped-controls">
          <Link className="btn btn-sm" to={`/wrapped/${encodeURIComponent(username)}/${shift(-1)}`}>← {period.kind === "year" ? period.year - 1 : "Previous month"}</Link>
          <button className="btn btn-sm" onClick={() => { setIdx(last); setElapsed(0); }}>Skip to summary</button>
          <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Download image"}</button>
          <button className="btn btn-sm" onClick={share}>Share</button>
          {canNext && <Link className="btn btn-sm" to={`/wrapped/${encodeURIComponent(username)}/${nextKey}`}>{period.kind === "year" ? period.year + 1 : "Next month"} →</Link>}
        </div>
        <div className="wrapped-controls">
          <Link className="small" to={`/player/${encodeURIComponent(username)}?tab=wrapped`}>All Wrapped for {username}</Link>
          <Link className="small" to={`/player/${encodeURIComponent(username)}`}>Full stats</Link>
        </div>
      </div>
    </div>
  );
}
