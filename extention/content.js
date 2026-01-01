// content.js — Chess.com game context extractor

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function findGameMeta() {
  const p = location.pathname;

  // /game/live/ID or /game/daily/ID
  let m = p.match(/\/game\/(live|daily)\/(\d+)/);
  if (m) return { kind: m[1], id: m[2] };

  // /analysis/game/live/ID
  m = p.match(/\/analysis\/game\/(live|daily)\/(\d+)/);
  if (m) return { kind: m[1], id: m[2] };

  // /game/ID
  m = p.match(/\/game\/(\d+)/);
  if (m) return { kind: "auto", id: m[1] };

  return null;
}

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

function monthStr(ts) {
  const d = new Date(ts * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return { year: y, month: m };
}

async function getGameContextForPopup() {
  const meta = await findGameMeta();
  if (!meta) return { ok: false, error: "Not on a game page" };

  const usernames = new Set();
  let ts = 0;

  // Try to get game data from Chess.com API
  for (let attempt = 0; attempt < 4; attempt++) {
    const j = await getLiveGameJson(meta.id);
    if (j) {
      ts = j?.game?.end_time || j?.game?.start_time || ts;
      const w = j?.game?.white?.username;
      const b = j?.game?.black?.username;
      if (w) usernames.add(w);
      if (b) usernames.add(b);
    }

    // Also try to find usernames from DOM
    document
      .querySelectorAll(
        'a[href^="/member/"], a[href^="https://www.chess.com/member/"]'
      )
      .forEach((a) => {
        const u = a.href.split("/").pop();
        if (u) usernames.add(u);
      });

    // Check og:image meta tag
    const ogImg =
      document.querySelector('meta[property="og:image"]')?.content || "";
    const m = ogImg.match(/\/share\/game\/(?:live|daily)\/([^/]+)\/\d+/);
    if (m) usernames.add(m[1]);

    if (usernames.size >= 1 && ts) break;
    await sleep(500);
  }

  const { year, month } = ts
    ? monthStr(ts)
    : {
        year: new Date().getUTCFullYear(),
        month: String(new Date().getUTCMonth() + 1).padStart(2, "0"),
      };

  return {
    ok: true,
    meta,
    year,
    month,
    usernames: Array.from(usernames),
  };
}

// Message handler
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "PING") {
    sendResponse({ pong: true });
    return true;
  }

  if (msg?.type === "GET_GAME_CONTEXT") {
    getGameContextForPopup()
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});
