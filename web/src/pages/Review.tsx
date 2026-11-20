import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Chess } from "chess.js";
import { Board, type Arrow } from "../components/Board";
import { EvalBar } from "../components/EvalBar";
import { EvalGraph } from "../components/EvalGraph";
import { ClassIcon } from "../components/ClassIcon";
import { Spinner } from "../components/Layout";
import {
  analyzeGame,
  formatScore,
  loadCachedReview,
  parseGame,
  PRESETS,
  uciLineToSan,
  type GameReview,
  type MoveReview,
  type PresetId,
} from "../lib/analyze";
import { CLASS_META, CLASS_ORDER, type Classification } from "../lib/classify";
import {
  defaultFlavor,
  getEngine,
  onEngineDownload,
  saveFlavor,
  type EngineFlavor,
  type PvLine,
  type StockfishEngine,
} from "../lib/engine";
import { toWhitePov } from "../lib/accuracy";
import { findGameById, gameIdFromUrl, type ChessComGame } from "../lib/chesscom";
import { hashString } from "../lib/positionKey.js";
import { play, playForSan } from "../lib/sound";

/* ------------------------------------------------------------------ start */

export function ReviewStart() {
  const nav = useNavigate();
  const [pgn, setPgn] = useState("");
  const [url, setUrl] = useState("");
  const [user, setUser] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fromPgn = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      parseGame(pgn);
    } catch (x) {
      setErr((x as Error).message);
      return;
    }
    try {
      sessionStorage.setItem("wazir:pgn", pgn);
    } catch {
      /* ignore */
    }
    nav("/review/pgn", { state: { pgn } });
  };

  const fromUrl = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const id = gameIdFromUrl(url);
    if (!id) return setErr("That doesn't look like a chess.com game link (…/game/live/123456789).");
    if (!user.trim()) return setErr("Enter the username of either player so we can find the game in their archive.");
    setBusy(true);
    try {
      const g = await findGameById(user.trim(), id.id);
      if (!g) throw new Error("Couldn't find that game in this player's last 24 months of games.");
      nav(`/review/${encodeURIComponent(user.trim())}/${id.id}`, { state: { game: g } });
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container" style={{ padding: "32px 0" }}>
      <h1>Game Review</h1>
      <p className="muted" style={{ maxWidth: "62ch" }}>
        Full Stockfish 19 NNUE analysis in your browser: accuracy, move classifications, best lines, and an interactive
        board. Pick a game from your <Link to="/stats">games list</Link>, or load one here.
      </p>
      {err && <div className="error-box" style={{ margin: "16px 0" }}>{err}</div>}
      <div className="grid grid-2" style={{ marginTop: 20 }}>
        <form className="card stack" onSubmit={fromUrl}>
          <h3>From a chess.com link</h3>
          <input className="input" placeholder="https://www.chess.com/game/live/…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input className="input" placeholder="Username of either player" value={user} onChange={(e) => setUser(e.target.value)} autoCapitalize="off" />
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Finding game…" : "Review game"}
          </button>
        </form>
        <form className="card stack" onSubmit={fromPgn}>
          <h3>Paste a PGN</h3>
          <textarea className="input" placeholder={'[Event "Live Chess"]\n…\n1. e4 e5 2. Nf3 …'} value={pgn} onChange={(e) => setPgn(e.target.value)} />
          <button className="btn btn-primary">Review PGN</button>
        </form>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- loaders */

export function ReviewFromArchive() {
  const { username = "", gameId = "" } = useParams();
  const loc = useLocation();
  const [game, setGame] = useState<ChessComGame | null>((loc.state as { game?: ChessComGame } | null)?.game ?? null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (game?.url.endsWith(`/${gameId}`)) return;
    setGame(null);
    findGameById(username, gameId)
      .then((g) => (g ? setGame(g) : setErr("Game not found in this player's recent archive.")))
      .catch((e) => setErr(e.message));
  }, [username, gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <div className="container center-msg"><div className="error-box">{err}</div></div>;
  if (!game?.pgn) return <Spinner label="Loading game from chess.com…" />;
  return <ReviewGame pgn={game.pgn} gameKey={`cc:${gameId}`} username={username} chessComAcc={game.accuracies} />;
}

export function ReviewFromPgn() {
  const loc = useLocation();
  const pgn = useMemo(() => {
    const s = (loc.state as { pgn?: string } | null)?.pgn;
    if (s) return s;
    try {
      return sessionStorage.getItem("wazir:pgn") || "";
    } catch {
      return "";
    }
  }, [loc.state]);
  if (!pgn) return <div className="container center-msg">No PGN loaded. <Link to="/review">Paste one here.</Link></div>;
  return <ReviewGame pgn={pgn} gameKey={`pgn:${hashString(pgn)}`} />;
}

/* ------------------------------------------------------------------ main */

function defaultPreset(): PresetId {
  try {
    const p = localStorage.getItem("wazir:preset") as PresetId | null;
    if (p && p in PRESETS) return p;
  } catch {
    /* ignore */
  }
  return self.crossOriginIsolated ? "deep" : "standard";
}

interface Variation {
  basePly: number;
  fens: string[];
  sans: string[];
  last: { from: string; to: string } | null;
}

function ReviewGame({
  pgn,
  gameKey,
  username,
  chessComAcc,
}: {
  pgn: string;
  gameKey: string;
  username?: string;
  chessComAcc?: { white: number; black: number };
}) {
  const parsed = useMemo(() => {
    try {
      return parseGame(pgn);
    } catch (e) {
      return e as Error;
    }
  }, [pgn]);
  const [preset, setPreset] = useState<PresetId>(defaultPreset);
  const [flavor, setFlavor] = useState<EngineFlavor>(defaultFlavor);
  const [review, setReview] = useState<GameReview | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [download, setDownload] = useState<number | null>(null);
  const [engineErr, setEngineErr] = useState<string | null>(null);
  const [engine, setEngine] = useState<StockfishEngine | null>(null);
  const [ply, setPly] = useState(0);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [tab, setTab] = useState<"review" | "moves" | "engine">("review");
  const [variation, setVariation] = useState<Variation | null>(null);
  const [liveLines, setLiveLines] = useState<PvLine[]>([]);
  const [, force] = useState(0);
  const signal = useRef({ cancelled: false });

  // Orient the board toward the searched player.
  useEffect(() => {
    if (parsed instanceof Error || !username) return;
    if (parsed.headers.Black?.toLowerCase() === username.toLowerCase()) setOrientation("black");
  }, [parsed, username]);

  // Engine + analysis lifecycle.
  useEffect(() => {
    if (parsed instanceof Error) return;
    signal.current.cancelled = true;
    const sig = { cancelled: false };
    signal.current = sig;
    setReview(null);
    setProgress(null);
    setEngineErr(null);
    const off = onEngineDownload((f) => setDownload(f < 1 ? f : null));
    (async () => {
      try {
        const eng = await getEngine(flavor);
        if (sig.cancelled) return;
        setEngine(eng);
        setDownload(null);
        const cached = await loadCachedReview(gameKey, preset, eng.info.name);
        if (cached) {
          setReview(cached);
          return;
        }
        await analyzeGame(pgn, gameKey, eng, preset, {
          signal: sig,
          onProgress: (r, done, total) => {
            if (sig.cancelled) return;
            setReview(r);
            setProgress({ done, total });
            force((x) => x + 1);
          },
        });
        if (!sig.cancelled) setProgress(null);
      } catch (e) {
        if (!sig.cancelled) setEngineErr((e as Error).message);
      }
    })();
    return () => {
      sig.cancelled = true;
      off();
      getEngine(flavor).then((e) => e.stopAll()).catch(() => {});
    };
  }, [pgn, gameKey, preset, flavor, parsed]);

  const total = parsed instanceof Error ? 0 : parsed.moves.length;

  // Board sounds when stepping through the game (not on first render).
  const prevPly = useRef<number | null>(null);
  useEffect(() => {
    if (parsed instanceof Error) return;
    const prev = prevPly.current;
    prevPly.current = ply;
    if (prev === null || prev === ply) return;
    const idx = Math.max(ply, prev) - 1;
    const m = parsed.moves[idx];
    if (m) playForSan(m.san, ply === total && ply > prev && new Chess(parsed.fens[total]).isGameOver());
  }, [ply, parsed, total]);
  const go = useCallback(
    (p: number) => {
      setVariation(null);
      setPly(Math.max(0, Math.min(total, p)));
    },
    [total],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (variation) {
          if (variation.fens.length > 1) setVariation({ ...variation, fens: variation.fens.slice(0, -1), sans: variation.sans.slice(0, -1), last: null });
          else setVariation(null);
        } else go(ply - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (!variation) go(ply + 1);
      } else if (e.key === "Home") go(0);
      else if (e.key === "End") go(total);
      else if (e.key === "f") setOrientation((o) => (o === "white" ? "black" : "white"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ply, total, go, variation]);

  // Live engine on side-variations.
  const varFen = variation ? variation.fens[variation.fens.length - 1] : null;
  useEffect(() => {
    if (!varFen || !engine || (progress && review && !review.complete)) {
      setLiveLines([]);
      return;
    }
    const chess = new Chess(varFen);
    if (chess.isGameOver()) {
      setLiveLines([]);
      return;
    }
    const h = engine.search(varFen, { depth: PRESETS[preset].depth + 2, multipv: 3 }, (l) => setLiveLines(l));
    return () => h.cancel();
  }, [varFen, engine, preset, progress, review]);

  if (parsed instanceof Error) return <div className="container center-msg"><div className="error-box">{parsed.message}</div></div>;

  const { headers, fens, moves } = parsed;
  const analyzed = review?.moves ?? [];
  const cur: MoveReview | undefined = ply > 0 ? analyzed[ply - 1] : undefined;
  const fen = varFen ?? fens[ply];

  // Score shown on the eval bar.
  let barScore = review ? (ply === 0 ? review.startEval : cur?.evalAfter ?? null) : null;
  const stmOf = (f: string) => f.split(" ")[1] as "w" | "b";
  if (variation) barScore = liveLines[0] ? toWhitePov(liveLines[0].score, stmOf(varFen!)) : null;

  // Arrows: better move (if the played one wasn't best) + next best move.
  const arrows: Arrow[] = [];
  if (!variation && cur && cur.bestUci && cur.bestUci !== cur.uci && !["book", "forced"].includes(cur.classification)) {
    arrows.push({ from: cur.bestUci.slice(0, 2), to: cur.bestUci.slice(2, 4), color: "#81b64c" });
  }
  if (variation && liveLines[0]?.pv[0]) {
    const u = liveLines[0].pv[0];
    arrows.push({ from: u.slice(0, 2), to: u.slice(2, 4), color: "#5c9ced" });
  }

  const lastMove = variation
    ? variation.last
    : ply > 0
      ? { from: moves[ply - 1].from, to: moves[ply - 1].to }
      : null;

  const onBoardMove = (from: string, to: string, promotion?: string) => {
    const baseFen = varFen ?? fens[ply];
    const c = new Chess(baseFen);
    let m;
    try {
      m = c.move({ from, to, promotion });
    } catch {
      play("illegal");
      return;
    }
    // Playing the actual game move just advances the game.
    if (!variation && ply < total && moves[ply].from === from && moves[ply].to === to) {
      go(ply + 1);
      return;
    }
    playForSan(m.san, c.isGameOver());
    setVariation((v) =>
      v
        ? { ...v, fens: [...v.fens, c.fen()], sans: [...v.sans, m.san], last: { from, to } }
        : { basePly: ply, fens: [baseFen, c.fen()], sans: [m.san], last: { from, to } },
    );
  };

  const white = headers.White || "White";
  const black = headers.Black || "Black";
  const top = orientation === "white" ? "b" : "w";
  const clockFor = (color: "w" | "b") => {
    // Last clock reading for this color at or before current ply.
    for (let p = ply; p >= 1; p--) {
      const m = moves[p - 1];
      if (m.color === color) return parsed.clocks[p - 1];
    }
    return parsed.clocks[color === "w" ? 0 : 1];
  };
  const fmtClock = (s?: number) =>
    s === undefined ? "" : s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}` : `${Math.floor(s / 60)}:${(s % 60).toFixed(s < 20 ? 1 : 0).padStart(s < 20 ? 4 : 2, "0")}`;

  const strip = (color: "w" | "b") => {
    const name = color === "w" ? white : black;
    const elo = color === "w" ? headers.WhiteElo : headers.BlackElo;
    return (
      <div className="player-strip">
        <span style={{ width: 14, height: 14, borderRadius: 3, background: color === "w" ? "#f3f3f3" : "#111", border: "1px solid #555" }} />
        <Link to={`/player/${encodeURIComponent(name)}`} style={{ color: "var(--text)" }}>{name}</Link>
        {elo && <span className="muted">({elo})</span>}
        {parsed.clocks.length > 0 && <span className="clock">{fmtClock(clockFor(color))}</span>}
      </div>
    );
  };

  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 100;

  return (
    <div className="container review-grid">
      <div className="board-col">
        {strip(top)}
        <div className="board-wrap">
          <EvalBar score={barScore} orientation={orientation} />
          <Board
            fen={fen}
            orientation={orientation}
            lastMove={lastMove}
            arrows={arrows}
            badge={!variation && cur ? { square: cur.to, cls: cur.classification } : null}
            onMove={onBoardMove}
          />
        </div>
        {strip(top === "w" ? "b" : "w")}
        <div className="controls">
          <button className="btn btn-icon" onClick={() => go(0)} aria-label="First move">⏮</button>
          <button className="btn btn-icon" onClick={() => (variation ? setVariation(null) : go(ply - 1))} aria-label="Previous move">◀</button>
          <button className="btn btn-icon" onClick={() => go(ply + 1)} aria-label="Next move" disabled={!!variation}>▶</button>
          <button className="btn btn-icon" onClick={() => go(total)} aria-label="Last move">⏭</button>
          <button className="btn btn-icon" onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))} aria-label="Flip board">⇅</button>
        </div>
        {variation && (
          <div className="card" style={{ marginTop: 12, padding: 14 }}>
            <div className="row">
              <b>Exploring:</b>
              <span className="muted">{variation.sans.join(" ")}</span>
              <span className="spacer" />
              <button className="btn btn-sm" onClick={() => setVariation(null)}>Back to game</button>
            </div>
            <div className="stack" style={{ gap: 6, marginTop: 10 }}>
              {liveLines.length === 0 && <span className="muted small">Engine thinking…</span>}
              {liveLines.map((l) => (
                <LineRow key={l.multipv} score={toWhitePov(l.score, stmOf(varFen!))} san={uciLineToSan(varFen!, l.pv)} depth={l.depth} />
              ))}
            </div>
          </div>
        )}
      </div>

      <aside className="side-panel">
        <div className="tabs">
          <button className={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>Review</button>
          <button className={tab === "moves" ? "on" : ""} onClick={() => setTab("moves")}>Moves</button>
          <button className={tab === "engine" ? "on" : ""} onClick={() => setTab("engine")}>Engine</button>
        </div>
        <div className="panel-body">
          {engineErr && <div className="error-box">{engineErr}</div>}
          {download !== null && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="small muted">
                Downloading {flavor === "full" ? "Stockfish 19 NNUE (~99 MB, cached after the first time)" : "Stockfish 19 Lite"}… {Math.round(download * 100)}%
              </span>
              <div className="progress"><div style={{ width: `${download * 100}%` }} /></div>
            </div>
          )}
          {!engine && !engineErr && download === null && <span className="small muted">Starting engine…</span>}
          {progress && review && !review.complete && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="small muted">
                Analyzing move {Math.min(progress.done, progress.total)}/{progress.total} · {PRESETS[preset].label} ({PRESETS[preset].hint})
              </span>
              <div className="progress"><div style={{ width: `${pct}%` }} /></div>
            </div>
          )}

          {tab === "review" && (
            <>
              {cur && <Explanation m={cur} />}
              {review && (
                <EvalGraph startEval={review.startEval} moves={analyzed} total={total} ply={ply} onSelect={go} />
              )}
              {review && <Summary review={review} white={white} black={black} chessComAcc={chessComAcc} onJump={(cls) => {
                const idx = analyzed.findIndex((m, i) => i + 1 > ply && m.classification === cls);
                const first = idx >= 0 ? idx : analyzed.findIndex((m) => m.classification === cls);
                if (first >= 0) go(first + 1);
              }} />}
              <MoveList moves={moves.map((m) => m.san)} analyzed={analyzed} ply={ply} onSelect={go} startColor={stmOf(fens[0])} startNumber={Number(fens[0].split(" ")[5]) || 1} />
            </>
          )}

          {tab === "moves" && (
            <MoveList moves={moves.map((m) => m.san)} analyzed={analyzed} ply={ply} onSelect={go} startColor={stmOf(fens[0])} startNumber={Number(fens[0].split(" ")[5]) || 1} />
          )}

          {tab === "engine" && (
            <div className="stack">
              <div>
                <div className="small muted" style={{ marginBottom: 6 }}>Analysis depth</div>
                <div className="seg">
                  {(Object.keys(PRESETS) as PresetId[]).map((p) => (
                    <button key={p} className={p === preset ? "on" : ""} onClick={() => {
                      setPreset(p);
                      try { localStorage.setItem("wazir:preset", p); } catch { /* ignore */ }
                    }}>
                      {PRESETS[p].label} <span className="muted">{PRESETS[p].hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="small muted" style={{ marginBottom: 6 }}>Engine</div>
                <div className="seg">
                  <button className={flavor === "full" ? "on" : ""} onClick={() => { setFlavor("full"); saveFlavor("full"); }}>Stockfish 19 NNUE (strongest)</button>
                  <button className={flavor === "lite" ? "on" : ""} onClick={() => { setFlavor("lite"); saveFlavor("lite"); }}>Lite (small download)</button>
                </div>
              </div>
              {engine && (
                <div className="small muted">
                  {engine.info.name} · {engine.info.threads} thread{engine.info.threads > 1 ? "s" : ""} · {engine.info.hashMb} MB hash
                  {!engine.info.multiThreaded && " · single-threaded (this browser isn't cross-origin isolated)"}
                </div>
              )}
              <div>
                <h3 style={{ marginBottom: 8 }}>Best lines in this position</h3>
                <div className="stack" style={{ gap: 6 }}>
                  {(ply < total ? analyzed[ply]?.lines : undefined)?.map((l, i) => (
                    <LineRow key={i} score={l.score} san={l.san} depth={l.depth} />
                  )) ?? <span className="small muted">{ply >= total ? "Game over." : "Not analyzed yet."}</span>}
                </div>
              </div>
              <p className="small muted">Tip: click pieces on the board to explore your own ideas; the engine follows along live.</p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------ subparts */

function LineRow({ score, san, depth }: { score: import("../lib/engine").Score; san: string[]; depth: number }) {
  const s = formatScore(score);
  const pos = score.type === "mate" ? score.value > 0 : score.value >= 0;
  return (
    <div className="engine-line" title={`depth ${depth}`}>
      <span className={`score ${pos ? "pos" : "neg"}`}>{s}</span>
      <span className="pv">{san.join(" ")}</span>
    </div>
  );
}

const article = (label: string) => (/^[aeiou]/i.test(label) ? "an" : "a");

function Explanation({ m }: { m: MoveReview }) {
  const meta = CLASS_META[m.classification];
  const moveName = `${m.moveNumber}${m.color === "w" ? "." : "..."} ${m.san}`;
  let detail = "";
  switch (m.classification) {
    case "book":
      detail = m.opening ? `Opening theory: ${m.opening}.` : "A known opening move.";
      break;
    case "forced":
      detail = "The only legal move.";
      break;
    case "brilliant":
      detail = "A strong sacrifice that the engine agrees with.";
      break;
    case "great":
      detail = "The only good move here: the alternatives were clearly worse.";
      break;
    case "best":
      detail = "The engine's top choice.";
      break;
    case "miss":
      detail = `Your opponent just slipped and this let it go. ${m.bestSan} was the punishing move.`;
      break;
    default:
      detail = m.bestSan ? `The best move was ${m.bestSan}${m.lines[0] ? ` (${formatScore(m.lines[0].score)})` : ""}.` : "";
  }
  return (
    <div className="explain">
      <ClassIcon cls={m.classification} size={30} />
      <div>
        <div className="what">
          {moveName} is {meta.label === "Best" ? "the best move" : `${article(meta.label)} ${meta.label.toLowerCase()} move`}
        </div>
        <div className="small" style={{ color: "var(--text-2)" }}>{detail}</div>
        <div className="small muted">Eval after: {formatScore(m.evalAfter)} · move accuracy {m.accuracy.toFixed(0)}%</div>
      </div>
    </div>
  );
}

function Summary({
  review,
  white,
  black,
  chessComAcc,
  onJump,
}: {
  review: GameReview;
  white: string;
  black: string;
  chessComAcc?: { white: number; black: number };
  onJump: (cls: Classification) => void;
}) {
  const fmt = (a: number | null) => (a === null ? "–" : a.toFixed(1));
  const accFmt = (a: number | null) => (review.complete ? fmt(a) : "…");
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="acc-row">
        <div>
          <div className="small muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{white}</div>
          <div className="acc-big w">{accFmt(review.white.accuracy)}</div>
        </div>
        <div className="small muted">Accuracy</div>
        <div>
          <div className="small muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{black}</div>
          <div className="acc-big b">{accFmt(review.black.accuracy)}</div>
        </div>
      </div>
      {chessComAcc && (
        <div className="small muted" style={{ textAlign: "center" }}>
          chess.com's own Game Review: {chessComAcc.white.toFixed(1)} / {chessComAcc.black.toFixed(1)}
        </div>
      )}
      {review.opening && <div className="small" style={{ textAlign: "center" }}><span className="muted">{review.opening.eco}</span> {review.opening.name}</div>}
      <table className="cls-table">
        <tbody>
          {CLASS_ORDER.filter((c) => c !== "forced" || review.white.counts.forced + review.black.counts.forced > 0).map((c) => (
            <tr key={c} style={{ cursor: "pointer" }} onClick={() => onJump(c)}>
              <td className="n">{review.white.counts[c]}</td>
              <td>
                <span className="row" style={{ gap: 8, justifyContent: "center" }}>
                  <ClassIcon cls={c} size={18} />
                  <span style={{ minWidth: 80 }}>{CLASS_META[c].label}</span>
                </span>
              </td>
              <td className="n">{review.black.counts[c]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="stack" style={{ gap: 4 }}>
        {(["opening", "middlegame", "endgame"] as const).map((ph) => (
          <div className="phase-row" key={ph}>
            <b className="num" style={{ width: 50 }}>{fmt(review.white.phases[ph])}</b>
            <span className="muted" style={{ textTransform: "capitalize" }}>{ph}</span>
            <b className="num" style={{ width: 50, textAlign: "right" }}>{fmt(review.black.phases[ph])}</b>
          </div>
        ))}
        <div className="phase-row">
          <b className="num" style={{ width: 50 }}>{review.white.acpl}</b>
          <span className="muted">Avg. centipawn loss</span>
          <b className="num" style={{ width: 50, textAlign: "right" }}>{review.black.acpl}</b>
        </div>
      </div>
      <div className="small muted" style={{ textAlign: "center" }}>
        {review.engine} · {PRESETS[review.preset].label} ({PRESETS[review.preset].hint})
      </div>
    </div>
  );
}

function MoveList({
  moves,
  analyzed,
  ply,
  onSelect,
  startColor,
  startNumber,
}: {
  moves: string[];
  analyzed: MoveReview[];
  ply: number;
  onSelect: (p: number) => void;
  startColor: "w" | "b";
  startNumber: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Scroll only the panel (scrollIntoView would also scroll the page and clipped ancestors).
    const el = ref.current?.querySelector<HTMLElement>(".mv.on");
    const box = ref.current?.closest<HTMLElement>(".panel-body");
    if (!el || !box) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if (top < 0 || top > box.clientHeight - el.offsetHeight) box.scrollTop += top - box.clientHeight / 2;
  }, [ply]);
  const rows: { no: number; w?: number; b?: number }[] = [];
  let i = 0;
  let no = startNumber;
  if (startColor === "b") {
    rows.push({ no, b: 0 });
    i = 1;
    no++;
  }
  for (; i < moves.length; i += 2) {
    rows.push({ no, w: i, b: i + 1 < moves.length ? i + 1 : undefined });
    no++;
  }
  const cell = (idx?: number) => {
    if (idx === undefined) return <div />;
    const a = analyzed[idx];
    return (
      <div className={`mv${ply === idx + 1 ? " on" : ""}`} onClick={() => onSelect(idx + 1)}>
        {a && !["best", "excellent", "good"].includes(a.classification) && <ClassIcon cls={a.classification} size={15} />}
        {moves[idx]}
      </div>
    );
  };
  return (
    <div className="moves" ref={ref}>
      {rows.map((r) => (
        <div key={r.no} style={{ display: "contents" }}>
          <div className="no">{r.no}.</div>
          {cell(r.w)}
          {cell(r.b)}
        </div>
      ))}
    </div>
  );
}
