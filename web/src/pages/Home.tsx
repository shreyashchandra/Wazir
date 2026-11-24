import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { UserSearch } from "../components/Layout";
import { ClassIcon } from "../components/ClassIcon";
import { PrivacyPolicy } from "./Privacy";

const EXT_URL = "https://chromewebstore.google.com/detail/wazir/pmmbehjgblpgcjmggmckeaophifjmilk";

// Position after 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? (Qxf7# next) for the mini board.
function MiniBoard() {
  const rows = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR".split("/");
  const cells: { piece: string | null; light: boolean; sq: string }[] = [];
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++, f++) cells.push({ piece: null, light: (r + f) % 2 === 0, sq: "abcdefgh"[f] + (8 - r) });
      } else {
        cells.push({ piece: ch, light: (r + f) % 2 === 0, sq: "abcdefgh"[f] + (8 - r) });
        f++;
      }
    }
  });
  return (
    <div className="mini-board">
      {cells.map((c) => (
        <i key={c.sq} style={{ background: c.sq === "f6" ? "#e86a5c" : c.light ? "var(--sq-light)" : "var(--sq-dark)", position: "relative" }}>
          {c.piece && (
            <img
              src={`/pieces/${c.piece === c.piece.toUpperCase() ? "w" : "b"}${c.piece.toUpperCase()}.svg`}
              alt=""
              style={{ width: "100%", height: "100%", display: "block" }}
            />
          )}
        </i>
      ))}
    </div>
  );
}

export function Home() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <span className="eyebrow">Free · No sign-up · Stockfish 19</span>
            <h1>
              Every game you've played. <span className="gold">Finally explained.</span>
            </h1>
            <p className="lead">
              Engine-grade reviews of your chess.com games, the stats that show where you're really improving, and a
              Chess Wrapped every month.
            </p>
            <UserSearch big autoFocus />
            <div className="platform-pill">
              Works with <b>chess.com</b> · just your public username
            </div>
          </div>
          <div className="fan" aria-hidden="true">
            <div className="story-card c1">
              <span className="k">Win streak</span>
              <span className="v">11</span>
              <span className="s">in a row. Opponents queued up and left disappointed.</span>
            </div>
            <div className="story-card c2">
              <span className="k">October · Blitz</span>
              <span className="v">+148</span>
              <span className="s">1312 → 1460, peak 1471. The Climber 🧗</span>
            </div>
            <div className="story-card c3">
              <span className="k">Biggest win</span>
              <span className="v">1712</span>
              <span className="s">251 points above you. Giant slayer.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="block">
        <div className="container grid grid-2" style={{ alignItems: "center", gap: 56 }}>
          <div className="poster" aria-label="Sample Wrapped summary">
            <div className="row" style={{ justifyContent: "space-between", fontSize: ".75rem", opacity: 0.85 }}>
              <span>Wazir · Chess Wrapped</span>
              <span>October</span>
            </div>
            <div className="head" style={{ marginTop: 14 }}>rook_and_roll</div>
            <div style={{ fontSize: ".8rem", opacity: 0.85 }}>chess.com · 214 games</div>
            <div className="score">
              <div className="ring">86</div>
              <div>
                <div style={{ fontSize: ".72rem", opacity: 0.7 }}>avg. accuracy</div>
                <b style={{ fontSize: "1.2rem" }}>The Climber 🧗</b>
              </div>
            </div>
            <div className="row-p"><span>Giant killer</span><b>Beat a 1712</b></div>
            <div className="row-p"><span>Nemesis</span><b>knightmare_99</b></div>
            <div className="row-p"><span>Plays best</span><b>8pm – midnight</b></div>
            <div className="row-p"><span>Secret weapon</span><b>London System 64%</b></div>
            <div className="cta"><span>What's your chess story?</span><span>→</span></div>
          </div>
          <div>
            <span className="eyebrow">Chess Wrapped · with a soundtrack</span>
            <h2 className="section-title">Your month, as a story.</h2>
            <p className="section-lead">Story slides with original music, ready to share. A new one drops at the end of every month, plus your year in December.</p>
            <ol className="num-list">
              {["Games, hours and your win rate", "Your rating journey", "Signature openings", "Your giant-killer moment", "Your nemesis and rival", "Your chess persona"].map((t, i) => (
                <li key={t}><span>{String(i + 1).padStart(2, "0")}</span>{t}</li>
              ))}
            </ol>
            <Link className="btn btn-gold" to="/wrapped">Unwrap my month →</Link>
          </div>
        </div>
      </section>

      <section className="block band-forest">
        <div className="container">
          <span className="eyebrow">Your one-stop chess toolkit</span>
          <h2 className="section-title" style={{ maxWidth: "18ch" }}>Review every game. Track every rating point.</h2>
          <p className="section-lead">Everything runs on your device with chess.com's public data.</p>
          <div className="grid grid-3" style={{ marginTop: 32 }}>
            <Link className="feature-card" to="/review">
              <div className="viz">
                <MiniBoard />
                <div className="mini-note">
                  <ClassIcon cls="blunder" size={20} />
                  <span>3…Nf6 is a blunder. It allows mate in one: 4.Qxf7#</span>
                </div>
              </div>
              <h3>Every game, reviewed</h3>
              <p>Stockfish 19 NNUE, about two minutes per game: accuracy, Brilliant to Blunder labels, best lines and an explorable board.</p>
            </Link>
            <Link className="feature-card" to="/stats">
              <div className="viz" style={{ padding: 18 }}>
                <svg viewBox="0 0 200 120" style={{ width: "100%" }}>
                  <polyline fill="none" stroke="var(--series-2)" strokeWidth="2.5" strokeLinejoin="round" points="0,95 20,90 40,96 60,80 80,84 100,66 120,70 140,52 160,48 180,34 200,26" />
                  <polyline fill="none" stroke="var(--series-1)" strokeWidth="2.5" strokeLinejoin="round" points="0,70 25,74 50,64 75,72 100,60 125,64 150,54 175,58 200,50" />
                </svg>
                <div style={{ position: "absolute", top: 14, left: 16, fontSize: ".75rem", color: "var(--muted)" }}>RATING · 12 MONTHS</div>
                <div style={{ position: "absolute", top: 30, left: 16, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "1.8rem" }}>+212</div>
              </div>
              <h3>Stats &amp; progress</h3>
              <p>Rating history, monthly accuracy, openings, colors, opponent strength and when you play your best.</p>
            </Link>
            <Link className="feature-card" to="/wrapped">
              <div className="viz" style={{ background: "linear-gradient(160deg,#3c1642,#ff5d8f)", color: "#fff" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "2.6rem" }}>🦉</div>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "1.6rem" }}>The Night Owl</div>
                  <div style={{ opacity: 0.85, fontSize: ".85rem" }}>38% of your games ended after midnight</div>
                </div>
              </div>
              <h3>Chess Wrapped</h3>
              <p>Monthly and yearly recaps with a soundtrack, a persona and a share image.</p>
            </Link>
          </div>
        </div>
      </section>

      <section className="block">
        <div className="container grid grid-2" style={{ alignItems: "center", gap: 48 }}>
          <div>
            <span className="eyebrow">Accuracy you can trust</span>
            <h2 className="section-title">Calibrated against chess.com.</h2>
            <p className="prose">
              Every position is searched by full-strength Stockfish 19, the engine family chess.com uses. Evaluations
              become win probabilities, and the accuracy model is fitted to chess.com's own published Game Review
              numbers. Move labels follow chess.com's expected-points thresholds, with a 3,800-line opening book for
              Book moves. When chess.com has already reviewed a game, its accuracy is shown next to ours.
            </p>
          </div>
          <div className="card stack">
            <div className="row"><b>Engine</b><span className="spacer" /><span className="muted">Stockfish 19 NNUE, multi-threaded</span></div>
            <div className="row"><b>Depth</b><span className="spacer" /><span className="muted">12 / 16 / 20 / 24</span></div>
            <div className="row"><b>Lines</b><span className="spacer" /><span className="muted">MultiPV 3 on every position</span></div>
            <div className="row"><b>Sounds</b><span className="spacer" /><span className="muted">Board sounds, toggle in the top bar</span></div>
            <div className="row"><b>Cost</b><span className="spacer" /><span className="muted">Free. Your device does the work.</span></div>
          </div>
        </div>
      </section>

      <section className="block band-forest" id="extension">
        <div className="container grid grid-2" style={{ alignItems: "center" }}>
          <div>
            <span className="eyebrow">Chrome extension</span>
            <h2 className="section-title">Review right on chess.com.</h2>
            <p className="prose">Open a finished game, click Wazir in your toolbar, and get a full local review without leaving the page.</p>
            <div className="row" style={{ marginTop: 20 }}>
              <a className="btn btn-gold" href={EXT_URL} target="_blank" rel="noreferrer">Install extension</a>
              <a className="btn btn-ghost" href="https://github.com/shreyashchandra/Wazir" target="_blank" rel="noreferrer">View on GitHub</a>
            </div>
          </div>
          <div className="grid grid-2">
            {["Open a finished game", "Click Wazir", "Fetch the PGN", "Analyze locally"].map((s, i) => (
              <div className="tile" key={s}><div className="label">Step {i + 1}</div><div style={{ fontWeight: 600 }}>{s}</div></div>
            ))}
          </div>
        </div>
      </section>

      <section className="block" id="support">
        <div className="container faq">
          <h2 className="section-title">Questions</h2>
          <div className="qs">
            <div><h4>Is it really free?</h4><p>Yes. The engine runs in your browser, so there's nothing to pay for and no account.</p></div>
            <div><h4>Do you need my password?</h4><p>No. Only your public chess.com username, through chess.com's public API.</p></div>
            <div><h4>How close is it to chess.com?</h4><p>Same engine family, and the accuracy model is fitted to chess.com's own numbers. Small differences remain because their exact formula is private.</p></div>
            <div><h4>Something broke?</h4><p>Report it on <a href="https://github.com/shreyashchandra/Wazir/issues" target="_blank" rel="noreferrer">GitHub</a> or email <a href="mailto:shreyash.chandra123@gmail.com">shreyash.chandra123@gmail.com</a>.</p></div>
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="container">
          <h2>Every game tells a story. <span className="gold">What's yours?</span></h2>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <UserSearch big />
          </div>
        </div>
      </section>

      <section className="block" id="privacy">
        <div className="container">
          <PrivacyPolicy />
        </div>
      </section>
    </>
  );
}
