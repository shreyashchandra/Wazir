/* popup.js - full updated file (PNG Neo pieces, high-quality smoothing, best-move-after fix) */

import { Chess } from "./lib/chess.js";

const API_ORIGIN = "https://chess-pgn-api.shreyash-chandra123.workers.dev";

/* ---------- Force sane popup width ---------- */
document.documentElement.style.minWidth = "920px";
document.body.style.minWidth = "920px";
/* ----------------------------- DOM refs ----------------------------- */
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
const boardCard = document.getElementById("board-card");
const canvas = document.getElementById("board-canvas");
const ctx = canvas.getContext("2d");
const coordsLayer = document.getElementById("coords");

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
const pvButtons = Array.from(document.querySelectorAll(".pv-btn"));

/* ----------------------------- Engine ----------------------------- */
let engine;
let engineReady = false;
let currentMultiPV = 3;

function initEngine() {
  if (engine) return;
  engine = new Worker(
    chrome.runtime.getURL("stockfish/stockfish-17.1-lite-single-03e3232.js")
  );

  engine.onerror = (e) => {
    console.error("Stockfish worker error:", e.message, e);
    progressEl.textContent = "Engine error: see console (Inspect popup).";
  };

  engine.onmessage = (e) => {
    const line = typeof e.data === "string" ? e.data : e.data?.data;
    if (!line) return;
    if (line.includes("uciok")) {
      post(`setoption name Threads value 1`);
      post(`setoption name Hash value 32`);
      post(`setoption name MultiPV value ${currentMultiPV}`);
      post("isready");
    } else if (line.includes("readyok")) {
      engineReady = true;
      progressEl.textContent = "Engine ready.";
    }
  };

  post("uci");
}

function post(cmd) {
  engine.postMessage(cmd);
}

function parseInfoMulti(line) {
  const m = line.match(
    /\bmultipv\s+(\d+).*?\bscore\s+(cp|mate)\s+(-?\d+).*?\bpv\s+(.+)$/
  );
  if (!m) return null;
  const multipv = parseInt(m[1], 10);
  const type = m[2];
  const value = parseInt(m[3], 10);
  const pv = m[4].trim().split(/\s+/);
  const move = pv[0];
  return { multipv, type, value, pv, move };
}

function onceBestWithMulti(multipv) {
  return new Promise((resolve) => {
    const lines = {};
    const handler = (e) => {
      const line = typeof e.data === "string" ? e.data : e.data?.data;
      if (!line) return;
      if (line.startsWith("info ") && line.includes("multipv")) {
        const info = parseInfoMulti(line);
        if (info && info.multipv <= multipv) lines[info.multipv] = info;
      } else if (line.startsWith("bestmove ")) {
        engine.removeEventListener("message", handler);
        const arr = Object.values(lines).sort((a, b) => a.multipv - b.multipv);
        resolve(arr);
      }
    };
    engine.addEventListener("message", handler);
  });
}

async function analyzeFenMulti(fen, opts, multipv) {
  post(`position fen ${fen}`);
  if (multipv !== currentMultiPV) {
    post(`setoption name MultiPV value ${multipv}`);
    currentMultiPV = multipv;
  }
  if (opts.movetime) post(`go movetime ${opts.movetime}`);
  else post(`go depth ${opts.depth}`);
  const arr = await onceBestWithMulti(multipv);
  return arr;
}

async function analyzeFenForMove(fen, moveObj, opts) {
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

/* ---------------- Messaging helpers: ensure content.js listening --------- */
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error("No active tab");
  return tab.id;
}

// async function logTabId() {
//   const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
//   if (!tab || !tab.id) throw new Error("No active tab");
//   console.log(tab);
//   return tab;
// }

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

/* -------- Local API helpers (returns your exact-formatted PGN) ---------- */
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
      if (g && g.PGN) return g.PGN;
    } catch {
      // try next
    }
  }
  throw new Error("Game not found in monthly archives via local API");
}

/* ------------------------ Get PGN button handler ------------------------ */
btnAuto.addEventListener("click", async () => {
  autoStatus.textContent = "Getting PGN (local API)...";
  try {
    const pgn = await loadPgnViaLocalApi();
    pgnEl.value = pgn.trim();
    autoStatus.textContent = "PGN loaded from local API.";
  } catch (e) {
    console.error(e);
    autoStatus.textContent =
      "Couldn't get PGN via local API. Ensure the game is open and server running at " +
      API_ORIGIN +
      ". Error: " +
      (e?.message || e);
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

    progressEl.textContent = "Preparing engine...";
    barEl.style.width = "0%";
    await waitReady();

    const pgn = pgnEl.value.trim();
    if (!pgn) {
      progressEl.textContent = "Please paste a PGN or fetch it.";
      return;
    }

    const depth = parseInt(depthEl.value, 10);
    const movetime = parseInt(msEl.value, 10) || 0;
    const multipv = parseInt(mpvEl.value, 10);

    const summary = await runAnalysis(pgn, { depth, movetime, multipv });
    lastSummary = summary;
    boardBtn.disabled = false;
    renderSummary(summary);
  } catch (e) {
    console.error(e);
    progressEl.textContent = "Error: " + (e?.message || e);
  }
});

function waitReady() {
  return new Promise((res) => {
    const t = setInterval(() => {
      if (engineReady) {
        clearInterval(t);
        res();
      }
    }, 50);
  });
}

async function runAnalysis(pgn, opts) {
  const headers = parseHeadersFromPgn(pgn);
  const startFen =
    headers.SetUp === "1" && headers.FEN ? headers.FEN : undefined;

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

    const preArr = await analyzeFenMulti(fenBefore, opts, opts.multipv);
    const preBest = preArr[0];
    const preCp = infoToCp(preBest);

    const preview = new Chess(fenBefore);
    const moveObj = preview.move(san, { sloppy: true });
    if (!moveObj) break;

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

    // Collect MultiPV lines for this node (1..m)
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
      // for PV selector: each is { move: uci, pv: [uci...], type, value }
      pvLines: pvMap,
    };

    perMove.push(entry);
    sides[stm].push(entry);

    const pct = Math.round(((i + 1) / total) * 100);
    barEl.style.width = pct + "%";
    progressEl.textContent = `Analyzing... ${i + 1}/${total} moves`;
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

  return { headers, white: by("w"), black: by("b"), perMove, startFen };
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

/* Colors + sizes */
const LIGHT = "#EEEDD2";
const DARK = "#769656";
const H_LAST = "rgba(46, 204, 113, 0.6)";
const H_BEST = "rgba(52, 152, 219, 0.65)";
const SIZE = 520; // canvas size (px)
const SQ = SIZE / 8; // square size (px)

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

const IMAGES = {}; // key -> HTMLImageElement

function preloadPieces() {
  const promises = [];
  for (const k of pieceKeys) {
    const img = new Image();
    img.src = chrome.runtime.getURL(`pieces/${k}.png`);
    IMAGES[k] = img;
    promises.push(
      new Promise((res) => {
        if (img.complete) return res();
        img.onload = () => res();
        img.onerror = () => {
          console.warn("Failed to load piece", k, img.src);
          res();
        };
      })
    );
  }
  return Promise.all(promises);
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
  // coords
  const files = flipped ? "hgfedcba" : "abcdefgh";
  const ranks = flipped ? "12345678" : "87654321";
  const coordHtml = [];
  for (let i = 0; i < 8; i++) {
    coordHtml.push(
      `<div style="position:absolute; left:${
        i * SQ + 3
      }px; bottom:2px; font-weight:600; color:#0008;">${files[i]}</div>`
    );
    coordHtml.push(
      `<div style="position:absolute; right:2px; top:${
        i * SQ + 2
      }px; font-weight:600; color:#0008;">${ranks[i]}</div>`
    );
  }
  coordsLayer.innerHTML = coordHtml.join("");
}

/* Draw pieces using preloaded PNG images for Neo look */
function drawPieces(game) {
  // enable smoothing for high-quality downscale
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
      if (img && img.complete) {
        const pad = Math.round(SQ * 0.03); // small padding for nice fit
        ctx.drawImage(img, x + pad, y + pad, SQ - pad * 2, SQ - pad * 2);
      } else {
        // fallback: simple circle (should rarely run)
        ctx.fillStyle = piece.color === "b" ? "#111" : "#fff";
        ctx.beginPath();
        ctx.arc(x + SQ / 2, y + SQ / 2 - 4, SQ * 0.24, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function highlightSquares(sqs, color) {
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = color === "best" ? H_BEST : H_LAST;
  for (const sq of sqs) {
    const { x, y } = sqToXY(sq);
    ctx.fillRect(x, y, SQ, SQ);
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

  // shaft
  ctx.beginPath();
  ctx.moveTo(x1 + ux * back, y1 + uy * back);
  ctx.lineTo(x2 - ux * head, y2 - uy * head);
  ctx.stroke();

  // head
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

/* ------------------ gotoPly: show best move AFTER last played move ---------------- */
function gotoPly(ply) {
  currentPly = Math.max(0, Math.min(ply, boardPerMove.length));
  const base = new Chess(boardStartFen);
  for (let i = 0; i < currentPly; i++) {
    base.move(boardPerMove[i].san, { sloppy: true });
  }

  drawBoardBase();
  drawPieces(base);

  // Last move highlight
  if (currentPly > 0) {
    const prev = new Chess(boardStartFen);
    for (let i = 0; i < currentPly - 1; i++)
      prev.move(boardPerMove[i].san, { sloppy: true });
    const last = prev.move(boardPerMove[currentPly - 1].san, { sloppy: true });
    if (last) {
      highlightSquares([last.from, last.to], "last");
    }
  }

  // Best move arrow: show engine suggestion AFTER the last played move
  let node = null;
  if (currentPly > 0) {
    node = boardPerMove[currentPly - 1];
  }

  if (node && node.pvLines && node.pvLines[selectedPV]) {
    const bestUci = node.pvLines[selectedPV].move || null;
    if (bestUci) {
      const from = bestUci.slice(0, 2);
      const to = bestUci.slice(2, 4);
      highlightSquares([from, to], "best");
      drawArrow(from, to, "#2E86DE");
    }
  }

  // UI text
  plyIndicator.textContent = `${currentPly}/${boardPerMove.length}`;
  const turn = base.turn() === "w" ? "White to move" : "Black to move";
  posHeader.textContent = `${turn} | FEN: ${base.fen()}`;

  // Best move + PV text (based on node above)
  if (node && node.pvLines && node.pvLines[selectedPV]) {
    const info = node.pvLines[selectedPV];
    const bestSAN = uciToSAN(base.fen(), info.move);
    bestMoveEl.textContent = `Best (#${selectedPV}): ${bestSAN || info.move}`;
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

  // Move list with selection
  renderMiniMoves(currentPly);
}

function uciToSAN(fen, uci) {
  if (!uci) return null;
  const g = new Chess(fen);
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.slice(4) || undefined;
  const m = g.move({ from, to, promotion });
  return m ? m.san : null;
}

function buildBoard(summary) {
  boardSummary = summary;
  boardPerMove = summary?.perMove || [];
  boardStartFen = summary?.startFen;
  flipped = false;
  selectedPV = 1;

  boardCard.style.display = "block";
  boardCard.scrollIntoView({ behavior: "smooth", block: "start" });

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
btnExit.addEventListener("click", () => (boardCard.style.display = "none"));
flipEl.addEventListener("change", () => {
  flipped = !!flipEl.checked;
  drawBoardBase();
  gotoPly(currentPly);
});
pvButtons.forEach((b) =>
  b.addEventListener("click", () => {
    selectedPV = parseInt(b.dataset.pv, 10) || 1;
    gotoPly(currentPly);
  })
);

boardBtn.addEventListener("click", async () => {
  // ensure pieces loaded before showing board
  await preloadPieces();

  if (!lastSummary) {
    // allow board from PGN-only if user didn’t analyze
    const pgn = pgnEl.value.trim();
    const san = extractSanTokens(pgn);
    if (!san.length) {
      autoStatus.textContent = "Board view: analyze or paste a PGN first.";
      return;
    }
    const startFen =
      parseHeadersFromPgn(pgn).SetUp === "1" && parseHeadersFromPgn(pgn).FEN
        ? parseHeadersFromPgn(pgn).FEN
        : undefined;
    const perMove = san.map((s, i) => ({
      ply: i + 1,
      san: s,
      pvLines: {},
    }));
    buildBoard({ perMove, startFen });
  } else {
    buildBoard(lastSummary);
  }
});

// window.onload = () => {
//   logTabId();
// };
