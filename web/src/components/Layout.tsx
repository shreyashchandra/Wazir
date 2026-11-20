import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { onSoundChange, play, setSoundEnabled, soundEnabled } from "../lib/sound";
import { Link, NavLink, useNavigate } from "react-router-dom";

export function UserSearch({ big, placeholder = "chess.com username", autoFocus }: { big?: boolean; placeholder?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const u = q.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?chess\.com\/member\//i, "");
    if (u) nav(`/player/${encodeURIComponent(u)}`);
  };
  return (
    <form className={big ? "user-search" : "row search-mini"} onSubmit={submit} role="search">
      <input
        className="input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        aria-label="chess.com username"
        autoFocus={autoFocus}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        style={big ? undefined : { width: 200, padding: "7px 12px" }}
      />
      <button className={big ? "btn btn-primary" : "btn btn-sm"} type="submit">
        {big ? "Analyze my chess" : "Go"}
      </button>
    </form>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <Link to="/" className="brand">
            <span className="logo" aria-hidden="true"><i /><i /><i /><i /></span>
            <span className="word">Wazir</span>
          </Link>
          <nav className="nav-links">
            <NavLink to="/review">Analyze</NavLink>
            <NavLink to="/stats">Stats</NavLink>
            <NavLink to="/wrapped">Wrapped</NavLink>
          </nav>
          <UserSearch />
          <BoardThemeToggle />
          <SoundToggle />
        </div>
      </header>
      <main>{children}</main>
      <footer className="footer">
        <div className="container row">
          <span>© {new Date().getFullYear()} Wazir · Powered by Stockfish 19 · Data from the chess.com public API</span>
          <span className="spacer" />
          <Link to="/privacy">Privacy</Link>
          <a href="https://github.com/shreyashchandra/Wazir" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <span className="muted">Pieces: cburnett (CC BY-SA 3.0). Not affiliated with Chess.com.</span>
        </div>
      </footer>
    </>
  );
}

function SoundToggle() {
  const [on, setOn] = useState(soundEnabled);
  useEffect(() => onSoundChange(setOn), []);
  return (
    <button
      className="icon-btn"
      onClick={() => {
        setSoundEnabled(!on);
        if (!on) setTimeout(() => play("move"), 0);
      }}
      aria-label={on ? "Mute sounds" : "Turn sounds on"}
      title={on ? "Sounds on" : "Sounds off"}
    >
      {on ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 5 6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 5 6 9H3v6h3l5 4V5z" /><path d="m22 9-6 6M16 9l6 6" /></svg>
      )}
    </button>
  );
}

function BoardThemeToggle() {
  const read = () => {
    try {
      return localStorage.getItem("wazir:board") === "wood" ? "wood" : "green";
    } catch {
      return "green";
    }
  };
  const [theme, setTheme] = useState<"green" | "wood">(read);
  useEffect(() => {
    document.documentElement.dataset.board = theme;
    try {
      localStorage.setItem("wazir:board", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return (
    <button className="icon-btn" onClick={() => setTheme(theme === "green" ? "wood" : "green")} aria-label="Switch board theme" title={`Board: ${theme}`}>
      <span style={{ display: "grid", gridTemplateColumns: "1fr 1fr", width: 16, height: 16, borderRadius: 3, overflow: "hidden" }}>
        <i style={{ background: "var(--sq-light)" }} /><i style={{ background: "var(--sq-dark)" }} /><i style={{ background: "var(--sq-dark)" }} /><i style={{ background: "var(--sq-light)" }} />
      </span>
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="center-msg">
      <div className="spinner" />
      {label && <div className="muted">{label}</div>}
    </div>
  );
}
