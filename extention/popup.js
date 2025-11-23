// popup.js — refactored for robust async flows & engine lifecycle
import { Chess } from "./lib/chess.js";

const API_ORIGIN = "https://chess-pgn-api.shreyash-chandra123.workers.dev";

/* ---------- Force sane popup width ---------- */
document.documentElement.style.minWidth = "920px";
document.body.style.minWidth = "920px";

/* ----------------------------- DOM refs ----------------------------- */
const panelBoard = document.getElementById("panel-board");
const btnAuto = document.getElementById("btn-auto");
const autoStatus = document.getElementById("auto-status");
const pgnEl = document.getElementById("pgn");
const analyzeBtn = document.getElementById("analyze");
const progressEl = document.getElementById("progress");
const barEl = document.getElementById("bar");
const titleEl = document.getElementById("title");
const notesEl = document.getElementById("notes");
const depthEl = document.getElementById("depth");
const msEl = document.getElementById("ms");
const mpvEl = document.getElementById("mpv");
const boardBtn = document.getElementById("board-view");

const wAccEl = document.getElementById("w-acc");
const bAccEl = document.getElementById("b-acc");
const wAcplEl = document.getElementById("w-acpl");
const bAcplEl = document.getElementById("b-acpl");
const wBadges = document.getElementById("w-badges");
const bBadges = document.getElementById("b-badges");
const movesTable = document.getElementById("moves");

/* ---------------- Board view elements ---------------- */
const boardCard = panelBoard || document.getElementById("panel-board");

const canvas = document.getElementById("board-canvas");
const coordsLayer = document.getElementById("coords");
const boardOverlay = document.getElementById("board-overlay");
const moveBadgeEl = document.getElementById("move-badge");

let ctx = canvas.getContext("2d");

/* Sizes used for drawing (logical) */
const SIZE = 520; // logical px size — CSS also sets this
const SQ = SIZE / 8;

/* ensure canvas is scaled to devicePixelRatio for crisp rendering */
function setupCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = SIZE + "px";
  canvas.style.height = SIZE + "px";
  canvas.width = Math.round(SIZE * dpr);
  canvas.height = Math.round(SIZE * dpr);
  ctx = canvas.getContext("2d", { alpha: false });
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  coordsLayer.style.width = SIZE + "px";
  coordsLayer.style.height = SIZE + "px";
  boardOverlay.style.width = SIZE + "px";
  boardOverlay.style.height = SIZE + "px";
}
setupCanvas();
window.addEventListener("resize", () => {
  setupCanvas();
  if (panelBoard && panelBoard.classList.contains("active")) {
    drawBoardBase();
    if (boardStartFen) {
      const g = new Chess(boardStartFen);
      drawPieces(g);
    }
  }
});

/* Buttons + controls */
const btnFirst = document.getElementById("btn-first");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");
const btnLast = document.getElementById("btn-last");
const btnExit = document.getElementById("btn-exit");
const flipEl = document.getElementById("flip");

const plyIndicator = document.getElementById("ply-indicator");
const posHeader = document.getElementById("pos-header");
const bestMoveEl = document.getElementById("best-move");
const pvLineEl = document.getElementById("pv-line");
const evalLineEl = document.getElementById("eval-line");
const miniMovesEl = document.getElementById("mini-moves");

/* Colors and tags */
const TAG_COLORS = {
  brilliant: "rgba(0, 255, 255, 0.6)",
  great: "rgba(66, 135, 245, 0.6)",
  best: "rgba(69, 163, 255, 0.65)",
  excellent: "rgba(0, 255, 100, 0.55)",
  good: "rgba(180, 255, 120, 0.45)",
  book: "rgba(180, 180, 180, 0.45)",
  miss: "rgba(255, 220, 100, 0.60)",
  inaccuracy: "rgba(255, 190, 80, 0.60)",
  mistake: "rgba(255, 150, 50, 0.60)",
  blunder: "rgba(255, 0, 0, 0.55)",
};

/* ----------------------------- Engine ----------------------------- */
let engine = null;
let engineReady = false;
let currentMultiPV = 3;
const ENGINE_START_TIMEOUT = 7000; // ms
const ENGINE_QUERY_TIMEOUT = 8000; // ms

function initEngine() {
  if (engine) return;
  engineReady = false;

  try {
    engine = new Worker(
      chrome.runtime.getURL("stockfish/stockfish-17.1-lite-single-03e3232.js")
    );
  } catch (err) {
    console.error("Failed to create engine worker:", err);
    setStatus("Engine worker failed to start.");
    return;
  }

  const onmsg = (e) => {
    const line = typeof e.data === "string" ? e.data : e.data?.data;
    if (!line) return;
    if (line.includes("uciok")) {
      post(`setoption name Threads value 1`);
      post(`setoption name Hash value 32`);
      post(`setoption name MultiPV value ${currentMultiPV}`);
      post("isready");
    } else if (line.includes("readyok")) {
      engineReady = true;
      setStatus("Engine ready.");
    }
  };

  engine.addEventListener("message", onmsg);
  engine.onerror = (ev) => {
    console.error("Stockfish worker error:", ev?.message || ev);
    setStatus("Engine error. See console (Inspect popup).");
  };

  post = (cmd) => {
    try {
      if (engine) engine.postMessage(cmd);
    } catch (err) {
      console.error("Failed to post to engine:", err);
    }
  };

  // send uci to start handshake
  try {
    engine.postMessage("uci");
  } catch (e) {
    console.error("Engine start post failed", e);
  }
}

function shutdownEngine() {
  try {
    if (engine) {
      try {
        engine.terminate();
      } catch (killErr) {
        console.warn("Engine termination error:", killErr);
      }
      engine = null;
      engineReady = false;
    }
  } catch (err) {
    console.error("Error shutting down engine:", err);
  }
}

function post(cmd) {
  if (!engine) return;
  engine.postMessage(cmd);
}

function parseInfoMulti(line) {
  // token-based parser: more robust than one big regex
  // Expected minimal structure: "info ... multipv N ... score (cp|mate) V ... pv uci uci ..."
  const multipvMatch = line.match(/\bmultipv\s+(\d+)/);
  const scoreMatch = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
  const pvMatch = line.match(/\bpv\s+(.+)$/);
  if (!multipvMatch || !scoreMatch) return null;
  const multipv = parseInt(multipvMatch[1], 10);
  const type = scoreMatch[1];
  const value = parseInt(scoreMatch[2], 10);
  const pv = pvMatch ? pvMatch[1].trim().split(/\s+/) : [];
  const move = pv.length ? pv[0] : null;
  return { multipv, type, value, pv, move };
}

function onceBestWithMulti(multipv, timeout = ENGINE_QUERY_TIMEOUT) {
  return new Promise((resolve) => {
    if (!engine) return resolve([]);
    const lines = {};
    const handler = (e) => {
      const line = typeof e.data === "string" ? e.data : e.data?.data;
      if (!line) return;
      if (line.startsWith("info ") && line.includes("multipv")) {
        const info = parseInfoMulti(line);
        if (info && info.multipv <= multipv) lines[info.multipv] = info;
      } else if (line.startsWith("bestmove ")) {
        engine.removeEventListener("message", handler);
        clearTimeout(tid);
        const arr = Object.values(lines).sort((a, b) => a.multipv - b.multipv);
        resolve(arr);
      }
    };
    engine.addEventListener("message", handler);
    const tid = setTimeout(() => {
      try {
        engine.removeEventListener("message", handler);
      } catch {}
      const arr = Object.values(lines).sort((a, b) => a.multipv - b.multipv);
      resolve(arr);
    }, timeout);
  });
}

async function analyzeFenMulti(fen, opts, multipv) {
  if (!engine) initEngine();
  if (!engine) return [];
  post(`position fen ${fen}`);
  if (multipv !== currentMultiPV) {
    post(`setoption name MultiPV value ${multipv}`);
    currentMultiPV = multipv;
  }
  if (opts.movetime) post(`go movetime ${opts.movetime}`);
  else post(`go depth ${opts.depth}`);
  const arr = await onceBestWithMulti(multipv);
  return arr || [];
}

async function analyzeFenForMove(fen, moveObj, opts) {
  if (!engine) initEngine();
  if (!engine) return null;
  const uci =
    moveObj.from + moveObj.to + (moveObj.promotion ? moveObj.promotion : "");
  post(`position fen ${fen}`);
  if (opts.movetime) post(`go movetime ${opts.movetime} searchmoves ${uci}`);
  else post(`go depth ${opts.depth} searchmoves ${uci}`);
  const arr = await onceBestWithMulti(1);
  return arr && arr[0] ? arr[0] : null;
}

/* ----------------------------- Scoring helpers --------------------------- */
const MAX_CP = 1000;
const MATE_CP = 1000;
const LOSS_CAP = 1000;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function infoToCp(info) {
  if (!info) return 0;
  if (info.type === "cp") return clamp(info.value, -MAX_CP, MAX_CP);
  if (info.type === "mate") {
    const sign = info.value > 0 ? 1 : -1;
    return sign * MATE_CP;
  }
  return 0;
}

function acplToAccuracy(acpl) {
  const acc = 100 - 0.22 * acpl;
  return clamp(Math.round(acc), 0, 100);
}

function classifyLoss(cpLoss) {
  if (cpLoss >= 300) return "blunder";
  if (cpLoss >= 150) return "mistake";
  if (cpLoss >= 75) return "inaccuracy";
  if (cpLoss <= 10) return "best";
  if (cpLoss <= 30) return "excellent";
  return "good";
}

function isBook(ply, preCp, playedCp) {
  return ply <= 10 && Math.abs(preCp) <= 30 && Math.abs(playedCp) <= 30;
}

function categorizeMove({ ply, preCp, playedCp, preTop, cpLoss }) {
  cpLoss = Math.min(Math.max(cpLoss, 0), LOSS_CAP);

  let miss = false;
  if (preTop && preTop.length >= 2) {
    const bestEval = infoToCp(preTop[0]);
    const secondEval = infoToCp(preTop[1]);
    const bestGain = bestEval - preCp;
    const yourGain = playedCp - preCp;
    if (cpLoss <= 35 && bestGain - yourGain >= 150) miss = true;
    if (
      cpLoss <= 20 &&
      bestEval - secondEval >= 120 &&
      Math.abs(playedCp - bestEval) <= 20
    ) {
      return { tag: "great" };
    }
  }

  if (isBook(ply, preCp, playedCp)) return { tag: "book" };
  if (miss) return { tag: "miss" };

  const cls = classifyLoss(cpLoss);
  if (cls === "best") return { tag: "best" };
  if (cls === "excellent") return { tag: "excellent" };
  if (cls === "good") return { tag: "good" };
  if (cls === "inaccuracy") return { tag: "inaccuracy" };
  if (cls === "mistake") return { tag: "mistake" };
  return { tag: "blunder" };
}

/* ----------------------------- Messaging helpers ------------------------ */
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error("No active tab");
  return tab.id;
}

async function sendMessageToTab(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (res) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message || "sendMessage failed"));
      resolve(res);
    });
  });
}

async function ensureContentScript(tabId) {
  try {
    const res = await sendMessageToTab(tabId, { type: "PING" });
    if (res && res.pong) return;
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  }
}

async function getGameContextFromPage() {
  const tabId = await getActiveTabId();
  await ensureContentScript(tabId);
  try {
    const res = await sendMessageToTab(tabId, { type: "GET_GAME_CONTEXT" });
    if (!res) throw new Error("No response from content script");
    return res;
  } catch (e) {
    throw new Error(e?.message || "No response");
  }
}

/* -------- Local API helpers (returns PGN string) ---------- */
async function fetchGamesFromLocalApi(username, year, month) {
  const url = `${API_ORIGIN}/pgn?username=${encodeURIComponent(
    username
  )}&year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API ${r.status}`);
  const data = await r.json();
  if (!Array.isArray(data)) throw new Error("Bad API shape");
  return data;
}

async function loadPgnViaLocalApi() {
  const ctx = await getGameContextFromPage();
  if (!ctx?.ok) throw new Error(ctx?.error || "Not on a game page");
  const { meta, year, month, usernames } = ctx;
  if (!meta?.id) throw new Error("Game id not found");

  let candidates = Array.isArray(usernames) ? usernames.slice() : [];
  if (!candidates.length) {
    await new Promise((r) => setTimeout(r, 600));
    const retry = await getGameContextFromPage();
    candidates = Array.isArray(retry?.usernames) ? retry.usernames.slice() : [];
  }
  if (!candidates.length) throw new Error("Usernames not found");

  for (const u of candidates) {
    try {
      const games = await fetchGamesFromLocalApi(u, year, month);
      let g = games.find((x) => String(x.gameID) === String(meta.id));
      if (!g) {
        g = games.find(
          (x) => /\[Link\s+"[^"]*\/(\d+)/.test(x.PGN) && x.PGN.includes(meta.id)
        );
      }
      if (g && g.PGN) {
        return g.PGN;
      }
    } catch {
      // try next username
    }
  }
  throw new Error("Game not found in monthly archives via local API");
}

/* ------------------------ Get PGN button handler ------------------------ */
btnAuto.addEventListener("click", async () => {
  autoStatus.innerHTML = `Getting PGN <span class="spinner" aria-hidden="true"></span>`;
  try {
    const pgn = await loadPgnViaLocalApi();
    pgnEl.value = String(pgn || "").trim();
    autoStatus.textContent = "PGN loaded!";
  } catch (e) {
    console.error(e);
    autoStatus.textContent = "Couldn't get PGN. Try again.";
  }
});

/* ---------------------------- Analysis flow ---------------------------- */
let lastSummary = null;

analyzeBtn.addEventListener("click", async () => {
  try {
    initEngine();
    titleEl.textContent = "-";
    notesEl.textContent = "";
    wAccEl.textContent = "-";
    bAccEl.textContent = "-";
    wAcplEl.textContent = "-";
    bAcplEl.textContent = "-";
    wBadges.innerHTML = "";
    bBadges.innerHTML = "";
    movesTable.innerHTML = "";
    boardBtn.disabled = true;

    setStatus("Preparing engine...");
    barEl.style.width = "0%";

    const ready = await waitReady(ENGINE_START_TIMEOUT);
    if (!ready) {
      setStatus("Engine failed to start.");
      return;
    }

    const pgn = String(pgnEl.value || "").trim();
    if (!pgn) {
      setStatus("Please paste a PGN or fetch it.");
      return;
    }

    const depth = parseInt(depthEl.value, 10);
    const movetime = parseInt(msEl.value, 10) || 0;
    const multipv = parseInt(mpvEl.value, 10);

    const summary = await runAnalysis(pgn, {
      depth,
      movetime,
      multipv,
      mpv: multipv,
    });
    lastSummary = summary;
    boardBtn.disabled = false;
    renderSummary(summary);
  } catch (e) {
    console.error(e);
    setStatus("Error: " + (e?.message || e));
  }
});

function waitReady(timeout = 7000) {
  return new Promise((res) => {
    const start = Date.now();
    const t = setInterval(() => {
      if (engineReady) {
        clearInterval(t);
        res(true);
        return;
      }
      if (Date.now() - start > timeout) {
        clearInterval(t);
        res(false);
      }
    }, 50);
  });
}

async function runAnalysis(pgn, opts) {
  const headers = parseHeadersFromPgn(pgn);
  headers.raw_pgn = pgn;
  let startFen;
  if (headers.SetUp === "1" && headers.FEN) {
    startFen = headers.FEN;
  } else {
    const m = pgn.match(/\[FEN\s+"([^"]+)"\]/);
    if (m) startFen = m[1];
  }

  const sanTokens = extractSanTokens(pgn);
  if (!sanTokens.length) {
    throw new Error(
      "Invalid PGN (no moves). Paste PGN from Share -> PGN or open View Game."
    );
  }

  const base = new Chess(startFen);
  const perMove = [];
  const sides = { w: [], b: [] };
  const total = sanTokens.length;

  post("ucinewgame");

  for (let i = 0; i < total; i++) {
    const san = sanTokens[i];
    const fenBefore = base.fen();
    const stm = base.turn();

    const preArr = await analyzeFenMulti(fenBefore, opts, opts.mpv || 1);
    const preBest = preArr[0];
    const preCp = infoToCp(preBest);

    const preview = new Chess(fenBefore);
    const moveObj = preview.move(san, { sloppy: true });
    if (!moveObj) {
      console.warn("Invalid SAN at ply", i + 1, "token:", san);
      break;
    }

    const playedInfo = await analyzeFenForMove(fenBefore, moveObj, opts);
    const playedCp = playedInfo ? infoToCp(playedInfo) : preCp;

    base.move(moveObj);

    let cpLoss = preCp - playedCp;
    if (cpLoss < 0) cpLoss = 0;
    if (cpLoss > LOSS_CAP) cpLoss = LOSS_CAP;

    const cat = categorizeMove({
      ply: i + 1,
      preCp,
      playedCp,
      preTop: preArr,
      cpLoss,
    });

    const pvMap = {};
    for (const line of preArr) {
      pvMap[line.multipv] = line;
    }

    const entry = {
      ply: i + 1,
      color: stm === "w" ? "White" : "Black",
      san,
      preCp,
      postCp: playedCp,
      cpLoss,
      tag: cat.tag,
      pvLines: pvMap,
    };

    perMove.push(entry);
    sides[stm].push(entry);

    const pct = Math.round(((i + 1) / total) * 100);
    barEl.style.width = pct + "%";
    setStatus(`Analyzing... ${i + 1}/${total} moves`);
  }

  const by = (color) => {
    const arr = sides[color];
    const moves = arr.length;
    const sumLoss = arr.reduce((a, r) => a + r.cpLoss, 0);
    const acpl = moves ? sumLoss / moves : 0;

    const count = (t) => arr.filter((r) => r.tag === t).length;

    return {
      moves,
      acpl: Math.round(acpl),
      accuracy: acplToAccuracy(acpl),
      counts: {
        best: count("best"),
        excellent: count("excellent"),
        great: count("great"),
        good: count("good"),
        book: count("book"),
        miss: count("miss"),
        inaccuracy: count("inaccuracy"),
        mistake: count("mistake"),
        blunder: count("blunder"),
      },
    };
  };

  return {
    headers,
    white: by("w"),
    black: by("b"),
    perMove,
    startFen: startFen || undefined,
  };
}

/* ----------------------------- Rendering ----------------------------- */
function renderSummary(s) {
  const h = s.headers || {};
  const title = [
    h.Event || "Game",
    h.White && h.Black ? `${h.White} vs ${h.Black}` : "",
    h.Result ? `(${h.Result})` : "",
  ]
    .filter(Boolean)
    .join(" ");
  titleEl.textContent = title;

  wAccEl.textContent = s.white.accuracy + "%";
  bAccEl.textContent = s.black.accuracy + "%";
  wAcplEl.textContent = s.white.acpl;
  bAcplEl.textContent = s.black.acpl;

  renderBadges(wBadges, s.white.counts);
  renderBadges(bBadges, s.black.counts);

  movesTable.innerHTML = "";
  const rows = chunkMoves(s.perMove);
  rows.forEach((r) => movesTable.appendChild(r));

  notesEl.textContent =
    "Notes:\n" +
    "- cpLoss = best_eval - played_eval from the same root (searchmoves).\n" +
    "- Mate evals are clamped to stabilize accuracy.\n" +
    "- Categories are heuristic but calibrated to feel similar to Chess.com.";

  window.dispatchEvent(new CustomEvent("wazir:summaryRendered", { detail: s }));
}

function renderBadges(container, counts) {
  const order = [
    ["best", "Best"],
    ["excellent", "Excellent"],
    ["great", "Great"],
    ["good", "Good"],
    ["book", "Book"],
    ["miss", "Miss"],
    ["inaccuracy", "Inaccuracy"],
    ["mistake", "Mistake"],
    ["blunder", "Blunder"],
  ];
  container.innerHTML = order
    .map(
      ([k, label]) =>
        `<div class="badge" data-t="${k}">${label}: ${counts[k] || 0}</div>`
    )
    .join("");
}

function chunkMoves(all) {
  const frag = [];
  for (let i = 0; i < all.length; i += 2) {
    const w = all[i];
    const b = all[i + 1];

    const row = document.createElement("div");
    row.className = "row-move";

    const idx = Math.floor(i / 2) + 1;
    row.innerHTML = `
      <div class="muted">${idx}.</div>
      ${
        w
          ? `<div>
              <span>${w.san}</span>
              <span class="tag ${w.tag}" style="margin-left:6px">${tagLabel(
              w.tag
            )}</span>
            </div>
            <div class="muted">${w.cpLoss} cp</div>`
          : `<div></div><div></div>`
      }
      ${
        b
          ? `<div>
              <span>${b.san}</span>
              <span class="tag ${b.tag}" style="margin-left:6px">${tagLabel(
              b.tag
            )}</span>
            </div>
            <div class="muted">${b.cpLoss} cp</div>`
          : `<div></div><div></div>`
      }
    `;
    frag.push(row);
  }
  return frag;
}

function tagLabel(tag) {
  switch (tag) {
    case "best":
      return "Best";
    case "excellent":
      return "Excellent";
    case "great":
      return "Great";
    case "good":
      return "Good";
    case "book":
      return "Book";
    case "miss":
      return "Miss";
    case "inaccuracy":
      return "Inaccuracy";
    case "mistake":
      return "Mistake";
    case "blunder":
      return "Blunder";
    default:
      return tag;
  }
}

/* ----------------------------- PGN helpers ----------------------------- */
function normalizePgn(raw) {
  if (!raw) return "";
  let s = String(raw).replace(/\r\n/g, "\n").trim();
  s = s
    .replace(/^\[Link\s+"[^"]*"\]\s*$/gim, "")
    .replace(/^\[ECO\s+"[^"]*"\]\s*$/gim, "")
    .replace(/^\[EndTime\s+"[^"]*"\]\s*$/gim, "");
  const tagBlockMatch = s.match(/^(?:\[[^\]]+\]\s*\n)+/m);
  if (tagBlockMatch) {
    const tagBlock = tagBlockMatch[0];
    const rest = s.slice(tagBlock.length);
    s = tagBlock.replace(/\s+$/, "") + "\n\n" + rest.replace(/^\s+/, "");
  }
  s = s.replace(/&nbsp;/g, " ").replace(/[\u200B-\u200D\uFEFF]/g, "");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function parseHeadersFromPgn(pgn) {
  const headers = {};
  const re = /\[([A-Za-z0-9_]+)\s+"([^"]*)"\]/g;
  let m;
  while ((m = re.exec(pgn))) headers[m[1]] = m[2];
  return headers;
}

function extractSanTokens(pgn) {
  let s = normalizePgn(pgn);
  s = s.replace(/^\s*\[[^\]]+\]\s*$/gm, "");
  s = s
    .replace(/\{[^}]*\}/g, " ")
    .replace(/;.*$/gm, " ")
    .replace(/\$\d+/g, " ");
  while (/\([^()]*\)/.test(s)) s = s.replace(/\([^()]*\)/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  const tokens = [];
  const results = new Set(["1-0", "0-1", "1/2-1/2", "*"]);
  for (const w of s.split(" ")) {
    if (!w) continue;
    if (/^\d+\.(\.\.)?$/.test(w) || w === "..." || w === ".." || w === ".")
      continue;
    if (results.has(w)) break;
    tokens.push(w);
  }
  return tokens;
}

/* ============================ BOARD VIEW ============================== */

/* Colors */
const LIGHT = "#f0d9b5";
const DARK = "#b58863";
const H_LAST = "rgba(46, 204, 113, 0.6)";
const H_BEST = "rgba(52, 152, 219, 0.65)";

/* ------------------ PNG piece preloading (local pieces) -------------- */
const pieceKeys = [
  "wK",
  "wQ",
  "wR",
  "wB",
  "wN",
  "wP",
  "bK",
  "bQ",
  "bR",
  "bB",
  "bN",
  "bP",
];

const IMAGES = {};

function preloadPieces(timeout = 4000) {
  const promises = [];
  for (const k of pieceKeys) {
    const img = new Image();
    const src = chrome.runtime.getURL(`pieces/${k}.png`);
    img.src = src;
    IMAGES[k] = img;

    promises.push(
      new Promise((res) => {
        if (img.complete && img.naturalWidth > 0) {
          return res();
        }
        img.onload = () => res();
        img.onerror = () => res();
        setTimeout(() => res(), timeout);
      })
    );
  }
  return Promise.all(promises).then(() => {
    // no-op; IMAGES references ready where available
  });
}

/* ------------------- board state ------------------ */
let boardSummary = null;
let boardGame = null;
let boardStartFen = undefined;
let boardPerMove = [];
let currentPly = 0;
let flipped = false;
let selectedPV = 1; // which multipv to show

function sqToXY(sq) {
  const file = "abcdefgh".indexOf(sq[0]);
  const rank = parseInt(sq[1], 10) - 1;
  const fx = flipped ? 7 - file : file;
  const fy = flipped ? rank : 7 - rank;
  return { x: fx * SQ, y: fy * SQ };
}

function drawBoardBase() {
  ctx.clearRect(0, 0, SIZE, SIZE);
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const x = (flipped ? 7 - f : f) * SQ;
      const y = (flipped ? r : 7 - r) * SQ;
      ctx.fillStyle = (r + f) % 2 === 0 ? LIGHT : DARK;
      ctx.fillRect(x, y, SQ, SQ);
    }
  }
  const files = flipped ? "hgfedcba" : "abcdefgh";
  const ranks = flipped ? "12345678" : "87654321";
  coordsLayer.innerHTML = "";
  for (let i = 0; i < 8; i++) {
    const fileEl = document.createElement("div");
    fileEl.style.position = "absolute";
    fileEl.style.left = i * SQ + 3 + "px";
    fileEl.style.bottom = "2px";
    fileEl.style.fontWeight = "600";
    fileEl.style.color = "#0008";
    fileEl.textContent = files[i];
    coordsLayer.appendChild(fileEl);

    const rankEl = document.createElement("div");
    rankEl.style.position = "absolute";
    rankEl.style.right = "2px";
    rankEl.style.top = i * SQ + 2 + "px";
    rankEl.style.fontWeight = "600";
    rankEl.style.color = "#0008";
    rankEl.textContent = ranks[i];
    coordsLayer.appendChild(rankEl);
  }
}

/* Draw pieces using preloaded PNG images for Neo look */
function drawPieces(game) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = "abcdefgh"[f] + (8 - r);
      const piece = game.get(sq);
      if (!piece) continue;
      const { x, y } = sqToXY(sq);

      const key = (piece.color === "w" ? "w" : "b") + piece.type.toUpperCase();
      const img = IMAGES[key];
      if (img && img.complete && img.naturalWidth > 0) {
        const pad = Math.round(SQ * 0.03);
        ctx.drawImage(img, x + pad, y + pad, SQ - pad * 2, SQ - pad * 2);
      } else {
        ctx.fillStyle = piece.color === "b" ? "#111" : "#fff";
        ctx.beginPath();
        ctx.arc(x + SQ / 2, y + SQ / 2 - 4, SQ * 0.24, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function highlightSquares(sqs, color, tag) {
  ctx.save();
  ctx.globalCompositeOperation = "multiply";

  const fill =
    color && color.startsWith && color.startsWith("rgba")
      ? color
      : color === "best"
      ? H_BEST
      : H_LAST;
  ctx.fillStyle = fill;

  for (const sq of sqs) {
    const { x, y } = sqToXY(sq);
    ctx.fillRect(x, y, SQ, SQ);

    if (tag === "blunder") {
      const el = document.createElement("div");
      el.className = "blunder-highlight";
      el.style.position = "absolute";
      el.style.left = x + "px";
      el.style.top = y + "px";
      el.style.width = SQ + "px";
      el.style.height = SQ + "px";
      el.style.pointerEvents = "none";
      boardOverlay.appendChild(el);
      setTimeout(() => el.remove(), 700);
    }
  }
  ctx.restore();
}

function drawArrow(from, to, color) {
  const a = sqToXY(from);
  const b = sqToXY(to);
  const x1 = a.x + SQ / 2;
  const y1 = a.y + SQ / 2;
  const x2 = b.x + SQ / 2;
  const y2 = b.y + SQ / 2;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;

  const ux = dx / len;
  const uy = dy / len;
  const head = Math.max(10, SQ * 0.18);
  const back = Math.max(6, SQ * 0.1);

  ctx.save();
  ctx.lineWidth = Math.max(6, SQ * 0.11);
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.95;

  ctx.beginPath();
  ctx.moveTo(x1 + ux * back, y1 + uy * back);
  ctx.lineTo(x2 - ux * head, y2 - uy * head);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - ux * head - uy * head * 0.6,
    y2 - uy * head + ux * head * 0.6
  );
  ctx.lineTo(
    x2 - ux * head + uy * head * 0.6,
    y2 - uy * head - ux * head * 0.6
  );
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function toSANListFromPV(fen, pv) {
  const g = new Chess(fen);
  const sanList = [];
  for (const uci of pv || []) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.slice(4) || undefined;
    const m = g.move({ from, to, promotion });
    if (!m) break;
    sanList.push(m.san);
  }
  return sanList;
}

/* ------------------ gotoPly ---------------- */
function gotoPly(ply) {
  currentPly = Math.max(0, Math.min(ply, boardPerMove.length));
  const base = new Chess(boardStartFen);
  for (let i = 0; i < currentPly; i++) {
    try {
      base.move(boardPerMove[i].san, { sloppy: true });
    } catch (e) {
      console.warn("apply san failed at ply", i, boardPerMove[i], e);
    }
  }

  boardOverlay.innerHTML = "";

  drawBoardBase();
  drawPieces(base);

  if (currentPly > 0) {
    const prev = new Chess(boardStartFen);
    for (let i = 0; i < currentPly - 1; i++) {
      try {
        prev.move(boardPerMove[i].san, { sloppy: true });
      } catch (e) {}
    }
    try {
      const last = prev.move(boardPerMove[currentPly - 1].san, {
        sloppy: true,
      });
      if (last) {
        const tag = (boardPerMove[currentPly - 1]?.tag || "").toLowerCase();
        const color = TAG_COLORS[tag] || H_LAST;
        highlightSquares([last.from, last.to], color, tag);
      }
    } catch (e) {}
  }

  let node = null;
  if (currentPly > 0) node = boardPerMove[currentPly - 1];

  if (node && node.pvLines && node.pvLines[selectedPV]) {
    const bestUci = node.pvLines[selectedPV].move || null;
    if (bestUci) {
      const from = bestUci.slice(0, 2);
      const to = bestUci.slice(2, 4);
      const moveTag = (node?.tag || "").toLowerCase();
      const color = TAG_COLORS[moveTag] || "#2E86DE";
      highlightSquares([from, to], color);
      drawArrow(from, to, color);
    }
  }

  plyIndicator.textContent = `${currentPly}/${boardPerMove.length}`;
  const turn = base.turn() === "w" ? "White to move" : "Black to move";
  posHeader.textContent = `${turn} | FEN: ${base.fen()}`;

  if (node && node.pvLines && node.pvLines[selectedPV]) {
    const info = node.pvLines[selectedPV];
    let bestSAN = null;
    try {
      bestSAN = uciToSAN(base.fen(), info.move);
    } catch (e) {
      console.warn("uciToSAN failed", e);
      bestSAN = null;
    }
    bestMoveEl.textContent = `Best (#${selectedPV}): ${
      bestSAN || info.move || "-"
    }`;
    const sanList = toSANListFromPV(base.fen(), info.pv);
    pvLineEl.textContent = `PV: ${sanList.join(" ") || "-"}`;
    const evalStr =
      info.type === "cp"
        ? `${(info.value / 100).toFixed(2)} cp`
        : `mate ${info.value}`;
    evalLineEl.textContent = `Eval: ${evalStr}`;
  } else {
    bestMoveEl.textContent = "Best: -";
    pvLineEl.textContent = "PV: -";
    evalLineEl.textContent = "Eval: -";
  }

  renderMiniMoves(currentPly);

  if (moveBadgeEl) {
    if (currentPly === 0) {
      moveBadgeEl.textContent = "";
      moveBadgeEl.style.background = "rgba(0,0,0,0.6)";
    } else {
      const tag = boardPerMove[currentPly - 1].tag || "";
      moveBadgeEl.textContent = tag ? tag.toUpperCase() : "";
      moveBadgeEl.style.background = TAG_COLORS[tag] || "rgba(0,0,0,0.6)";
    }
  }
}

function uciToSAN(fen, uci) {
  if (!uci) return null;
  const g = new Chess(fen);
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.slice(4) || undefined;
  try {
    const m = g.move({ from, to, promotion });
    return m ? m.san : null;
  } catch (e) {
    try {
      const m2 = g.move(from + to + (promotion || ""));
      return m2 ? m2.san : null;
    } catch (e2) {
      return null;
    }
  }
}

/* ------------------ buildBoard (async safe) ---------------- */
async function buildBoard(summary) {
  if (!panelBoard) {
    console.error("panel-board missing");
    return;
  }

  try {
    if (document.activeElement && document.activeElement.blur)
      document.activeElement.blur();
  } catch (e) {}

  // hide other panels but do not reveal board until ready
  document.querySelectorAll(".panel").forEach((p) => {
    p.classList.remove("active");
    p.setAttribute("aria-hidden", "true");
  });

  // set internal state before rendering
  boardSummary = summary;
  boardPerMove = summary?.perMove || [];
  boardStartFen = summary?.startFen || undefined;
  flipped = false;
  selectedPV = 1;

  // preload pieces and prepare canvas BEFORE revealing panel
  await preloadPieces();
  setupCanvas();
  drawBoardBase();
  gotoPly(0);

  // now safe to reveal board panel
  panelBoard.classList.add("active");
  panelBoard.setAttribute("aria-hidden", "false");
  panelBoard.style.display = "block";
  boardCard.scrollIntoView({ behavior: "smooth", block: "center" });
}

/* small helper to await preload pieces, setup canvas and render initial state */
async function awaitPreloadThenDraw() {
  await preloadPieces();
  setupCanvas();
  drawBoardBase();
  gotoPly(0);
}

function renderMiniMoves(selPly) {
  const parts = [];
  for (let i = 0; i < boardPerMove.length; i += 2) {
    const idx = Math.floor(i / 2) + 1;
    const w = boardPerMove[i];
    const b = boardPerMove[i + 1];
    parts.push(`<div class="mini-row">`);
    parts.push(
      `<span class="muted" style="min-width:22px;display:inline-block;">${idx}.</span>`
    );
    if (w) {
      parts.push(
        `<button class="mini-mv ${selPly === i + 1 ? "sel" : ""}" data-ply="${
          i + 1
        }">${w.san}</button>`
      );
    } else {
      parts.push(`<span class="mini-mv disabled"></span>`);
    }
    if (b) {
      parts.push(
        `<button class="mini-mv ${selPly === i + 2 ? "sel" : ""}" data-ply="${
          i + 2
        }">${b.san}</button>`
      );
    }
    parts.push(`</div>`);
  }
  miniMovesEl.innerHTML = parts.join("");
  miniMovesEl.querySelectorAll(".mini-mv[data-ply]").forEach((btn) => {
    btn.addEventListener("click", () => {
      gotoPly(parseInt(btn.dataset.ply, 10));
    });
  });
}

/* Board controls */
btnFirst.addEventListener("click", () => gotoPly(0));
btnPrev.addEventListener("click", () => gotoPly(currentPly - 1));
btnNext.addEventListener("click", () => gotoPly(currentPly + 1));
btnLast.addEventListener("click", () => gotoPly(boardPerMove.length));
btnExit.addEventListener("click", () => {
  if (panelBoard) {
    panelBoard.style.display = "none";
    panelBoard.classList.remove("active");
    panelBoard.setAttribute("aria-hidden", "true");
  }
});
flipEl.addEventListener("change", () => {
  flipped = !!flipEl.checked;
  drawBoardBase();
  gotoPly(currentPly);
});

document.querySelectorAll("#quick-filters button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tag = btn.dataset.tag;
    const idx = boardPerMove.findIndex((m) => m.tag === tag);
    if (idx !== -1) gotoPly(idx + 1);
  });
});

boardBtn.addEventListener("click", async () => {
  await preloadPieces();
  try {
    if (document.activeElement && document.activeElement.blur)
      document.activeElement.blur();
  } catch (e) {}

  if (!lastSummary || !lastSummary.perMove) {
    console.error("Summary missing when building board!", lastSummary);
    return;
  }

  await buildBoard(lastSummary);
  gotoPly(currentPly);
});

/* Expose small hooks for UI module */
window.__wazir = {
  parseHeadersFromPgn,
  extractSanTokens,
  lastSummaryGetter: () => lastSummary,
  buildBoardFromSummary: async (summary) => await buildBoard(summary),
};

/* shutdown engine when popup unloads to free resources */
window.addEventListener("unload", () => {
  shutdownEngine();
});

/* helper for UI status */
function setStatus(s) {
  if (progressEl) progressEl.textContent = s;
}
window.__wazir_ui = { setStatus };
window.addEventListener("load", () => setStatus("Ready"));
