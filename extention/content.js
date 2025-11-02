// content.js

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function findGameMeta() {
  const p = location.pathname;
  let m = p.match(/\/game\/(live|daily)\/(\d+)/);
  if (m) return { kind: m[1], id: m[2] };
  m = p.match(/\/analysis\/game\/(live|daily)\/(\d+)/);
  if (m) return { kind: m[1], id: m[2] };
  return null;
}

function looksLikePgn(text) {
  if (!text) return false;
  const t = String(text).trim();
  if (t.startsWith("<!DOCTYPE") || t.startsWith("<html")) return false;
  if (/\[Event\s+"/.test(t)) return true;
  return /\d+\.\s/.test(t);
}

async function fetchText(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  return { ok: res.ok, status: res.status, url: res.url, text };
}

async function fetchPgnDirect(kind, id) {
  const url = `https://www.chess.com/game/${kind}/${id}.pgn`;
  const { ok, text } = await fetchText(url, { credentials: "include" });
  if (ok && looksLikePgn(text)) return text;
  return null;
}

function monthStr(ts) {
  const d = new Date(ts * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}/${m}`;
}

async function fetchMonthlyPgnFromApi(gameUrl) {
  const usernames = new Set();

  document
    .querySelectorAll(
      'a[href^="/member/"], a[href^="https://www.chess.com/member/"]'
    )
    .forEach((a) => {
      const u = a.href.split("/").pop();
      if (u) usernames.add(u);
    });

  if (window?.context?.user?.username) {
    usernames.add(window.context.user.username);
  }

  const ogImg =
    document.querySelector('meta[property="og:image"]')?.content || "";
  const m = ogImg.match(/\/share\/game\/(?:live|daily)\/([^/]+)\/\d+/);
  if (m) usernames.add(m[1]);

  async function getLiveGameJson(id) {
    try {
      const r = await fetch(`https://www.chess.com/callback/live/game/${id}`, {
        credentials: "include",
      });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  const gm =
    gameUrl.match(/\/game\/live\/(\d+)/) ||
    gameUrl.match(/\/game\/daily\/(\d+)/);
  const gameId = gm ? gm[1] : null;

  let month = null;
  if (gameId) {
    const j = await getLiveGameJson(gameId);
    if (j?.game?.end_time || j?.game?.start_time) {
      month = monthStr(j.game.end_time || j.game.start_time);
      const w = j?.game?.white?.username;
      const b = j?.game?.black?.username;
      if (w) usernames.add(w);
      if (b) usernames.add(b);
    }
  }

  if (!month || usernames.size === 0) return null;

  for (const u of usernames) {
    try {
      const mUrl = `https://api.chess.com/pub/player/${u}/games/${month}`;
      const r = await fetch(mUrl);
      if (!r.ok) continue;
      const data = await r.json();
      if (!Array.isArray(data?.games)) continue;
      const found = data.games.find(
        (g) => g.url === gameUrl || g?.pgn?.includes(`Link "${gameUrl}"`)
      );
      if (found?.pgn && looksLikePgn(found.pgn)) {
        return found.pgn;
      }
    } catch {
      // continue
    }
  }
  return null;
}

async function getGameContextForPopup() {
  const meta = await findGameMeta();
  if (!meta) return { ok: false, error: "Not on a game page." };

  async function getLiveGameJson(id) {
    try {
      const r = await fetch(`https://www.chess.com/callback/live/game/${id}`, {
        credentials: "include",
      });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  const usernames = new Set();
  let ts = 0;

  for (let attempt = 0; attempt < 4; attempt++) {
    const j = await getLiveGameJson(meta.id);
    if (j) {
      ts = j?.game?.end_time || j?.game?.start_time || ts;
      const w = j?.game?.white?.username;
      const b = j?.game?.black?.username;
      if (w) usernames.add(w);
      if (b) usernames.add(b);
    }

    document
      .querySelectorAll(
        'a[href^="/member/"], a[href^="https://www.chess.com/member/"]'
      )
      .forEach((a) => {
        const u = a.href.split("/").pop();
        if (u) usernames.add(u);
      });

    const ogImg =
      document.querySelector('meta[property="og:image"]')?.content || "";
    const m = ogImg.match(/\/share\/game\/(?:live|daily)\/([^/]+)\/\d+/);
    if (m) usernames.add(m[1]);

    if (usernames.size >= 1 && ts) break;
    await sleep(500);
  }

  const d = ts ? new Date(ts * 1000) : new Date();
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");

  return { ok: true, meta, year, month, usernames: Array.from(usernames) };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "PING") {
    sendResponse({ pong: true });
    return true;
  }

  if (msg?.type === "GET_PGN") {
    (async () => {
      try {
        const meta = await findGameMeta();
        if (!meta) {
          sendResponse({
            ok: false,
            error:
              "Open a specific game page (View Game/Analysis) and try again.",
          });
          return;
        }

        let pgn = await fetchPgnDirect(meta.kind, meta.id);

        if (!pgn || !looksLikePgn(pgn)) {
          const url = `https://www.chess.com/game/${meta.kind}/${meta.id}`;
          const byApi = await fetchMonthlyPgnFromApi(url);
          if (byApi && looksLikePgn(byApi)) {
            sendResponse({ ok: true, pgn: byApi, meta, mode: "monthly-api" });
            return;
          }
        }

        if (!pgn || !looksLikePgn(pgn)) {
          sendResponse({
            ok: false,
            error:
              "Couldn't get PGN. Paste PGN from Share -> PGN, or try again.",
          });
          return;
        }

        sendResponse({ ok: true, pgn, meta, mode: "direct" });
      } catch (e) {
        sendResponse({
          ok: false,
          error: "PGN fetch error: " + (e?.message || e),
        });
      }
    })();
    return true;
  }

  if (msg?.type === "GET_GAME_CONTEXT") {
    (async () => {
      try {
        const ctx = await getGameContextForPopup();
        sendResponse(ctx);
      } catch (e) {
        sendResponse({
          ok: false,
          error: "Context error: " + (e?.message || e),
        });
      }
    })();
    return true;
  }
});
