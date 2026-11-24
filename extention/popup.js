// popup.js — Wazir extension popup.
// Analysis (engine, accuracy model, move classification) comes from the shared
// core in lib/wazir-core.js, built from the website's src/lib by
// `npm run build:extension` in web/. Do not edit wazir-core.js by hand.

import { Chess } from "./lib/chess.js";
import {
  StockfishEngine,
  analyzeGame,
  CLASS_META,
  hashString,
} from "./lib/wazir-core.js";

const API_ORIGIN = "https://chess-pgn-api.shreyash-chandra123.workers.dev";

/* ============================================================
   WIN% (eval bar / charts only; accuracy comes from the shared core)
   ============================================================ */

function cpToWinPercent(cp) {
  const clamped = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

function mateToWinPercent(mateIn) {
  if (mateIn > 0) return 100;
  if (mateIn < 0) return 0;
  return 50;
}

function evalToWinPercent(info) {
  if (!info) return 50;
  if (info.type === "mate") return mateToWinPercent(info.value);
  return cpToWinPercent(info.value);
}

/* ============================================================
   DOM REFERENCES
   ============================================================ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// Summary panel
const wNameEl = $("#w-name");
const bNameEl = $("#b-name");
const wRatingEl = $("#w-rating");
const bRatingEl = $("#b-rating");
const wAccuracyEl = $("#w-accuracy");
const bAccuracyEl = $("#b-accuracy");
const wAcplEl = $("#w-acpl");
const bAcplEl = $("#b-acpl");
const wBadgesEl = $("#w-badges");
const bBadgesEl = $("#b-badges");
const openingNameEl = $("#opening-name");

// Controls
const btnAuto = $("#btn-auto");
const btnAnalyze = $("#btn-analyze");
const btnBoard = $("#btn-board");
const pgnInput = $("#pgn-input");
const presetEl = $("#preset");
const progressBar = $("#progress-bar");
const progressText = $("#progress-text");

// Charts
const advCanvas = $("#adv-graph");
const accCanvas = $("#acc-graph");

// Moves panel
const movesList = $("#moves-list");
const movesTitle = $("#moves-title");
const movesSubtitle = $("#moves-subtitle");

// Board panel
const boardCanvas = $("#board-canvas");
const boardCoords = $("#board-coords");
const boardOverlay = $("#board-overlay");
const moveBadgeOverlay = $("#move-badge-overlay");
const evalBarWhite = $("#eval-bar-white");
const evalTop = $("#eval-top");
const evalBottom = $("#eval-bottom");
const plyDisplay = $("#ply-display");
const posFen = $("#pos-fen");
const bestMoveSan = $("#best-move-san");
const pvLine = $("#pv-line");
const evalDisplay = $("#eval-display");
const miniMoves = $("#mini-moves");

const btnFirst = $("#btn-first");
const btnPrev = $("#btn-prev");
const btnNext = $("#btn-next");
const btnLast = $("#btn-last");
const btnBack = $("#btn-back");
const flipBoard = $("#flip-board");

let ctx = boardCanvas.getContext("2d");

/* ============================================================
   CONSTANTS
   ============================================================ */

const BOARD_SIZE = 375;
const SQ_SIZE = BOARD_SIZE / 8;

const COLORS = {
  light: "#ebecd0",
  dark: "#739552",
  highlightYellow: "rgba(255, 255, 0, 0.5)",
  highlightLast: "rgba(255, 255, 0, 0.4)",
  arrowGreen: "rgba(129, 182, 76, 0.9)",
  arrowBlue: "rgba(92, 155, 237, 0.85)",
};

const TAG_COLORS = Object.fromEntries(
  Object.entries(CLASS_META).map(([k, v]) => [k, v.color]),
);

const TAG_ICONS = {
  brilliant: "💎",
  great: "!",
  best: "★",
  excellent: "✓",
  good: "",
  book: "📖",
  forced: "→",
  inaccuracy: "?!",
  mistake: "?",
  miss: "✕",
  blunder: "??",
};

/* ============================================================
   ENGINE (shared Stockfish 19 wrapper)
   Multi-threaded when the popup is cross-origin isolated (see the
   cross_origin_* keys in manifest.json), single-threaded otherwise.
   ============================================================ */

let enginePromise = null;

function getEngine() {
  if (!enginePromise) {
    enginePromise = StockfishEngine.create("lite", undefined, {
      scriptBase: chrome.runtime.getURL("stockfish/"),
    });
    enginePromise
      .then((e) =>
        console.info(
          `[wazir] ${e.info.name}, ${e.info.threads} thread(s), ${e.info.hashMb} MB hash`,
        ),
      )
      .catch((err) => {
        console.error("Engine init failed:", err);
        setProgress("Engine failed to start", 0);
        enginePromise = null;
      });
  }
  return enginePromise;
}

// Warm the engine up as soon as the popup opens.
function initEngine() {
  getEngine();
}

function shutdownEngine() {
  enginePromise?.then((e) => e.terminate()).catch(() => {});
  enginePromise = null;
}

/* ============================================================
   UCI PARSING + POV FIXES (THE CORE BUG FIX)
   ============================================================ */

function flipEval(info) {
  if (!info) return null;
  return { ...info, value: -info.value };
}

// Stockfish score is from side-to-move POV at root.
// Convert to White POV so UI/eval bar/charts are consistent.
function evalFromWhitePov(info, sideToMove) {
  if (!info) return null;
  return sideToMove === "w" ? info : flipEval(info);
}

/* ============================================================
   ENGINE QUERIES (custom positions on the board)
   Returns infos in side-to-move POV: { multipv, type, value, pv, depth }.
   ============================================================ */

async function analyzePosition(fen, opts, multipv) {
  const engine = await getEngine();
  const lines = await engine.search(fen, {
    depth: opts.depth,
    multipv,
    movetime: opts.movetime,
  }).promise;
  return lines.map((l) => ({
    multipv: l.multipv,
    type: l.score.type,
    value: l.score.value,
    pv: l.pv,
    depth: l.depth,
  }));
}

/* ============================================================
   PART 2/3 continues: PGN parsing + runAnalysis + UI rendering
   ============================================================ */

// popup.js — DROP-IN FILE (PART 2/3)
// Copy-paste this directly BELOW PART 1/3 (do not remove anything from PART 1).

/* ============================================================
   PGN PARSING
   ============================================================ */

function parseHeaders(pgn) {
  const headers = {};
  const re = /\[(\w+)\s+"([^"]*)"\]/g;
  let m;
  while ((m = re.exec(pgn))) headers[m[1]] = m[2];
  return headers;
}

function extractMoves(pgn) {
  let s = pgn
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/;[^\n]*/g, " ")
    .replace(/\$\d+/g, " ");

  // Remove RAVs (variations)
  while (/\([^()]*\)/.test(s)) {
    s = s.replace(/\([^()]*\)/g, " ");
  }

  s = s.replace(/\s+/g, " ").trim();

  const tokens = [];
  const results = new Set(["1-0", "0-1", "1/2-1/2", "*"]);

  for (const word of s.split(" ")) {
    if (!word) continue;
    if (/^\d+\.+$/.test(word)) continue;
    if (word === "..." || word === ".." || word === ".") continue;
    if (results.has(word)) break;
    tokens.push(word);
  }

  return tokens;
}

/* ============================================================
   ANALYSIS ENGINE (FIXED POV + FIXED parsing use)
   - All evals stored in analysis are White POV.
   - cpLoss/ACPL computed as mover POV so black isn't inverted.
   ============================================================ */

let lastAnalysis = null;

async function runAnalysis(pgn, preset) {
  const engine = await getEngine();
  setProgress(`Analyzing… (${engine.info.threads} thread${engine.info.threads > 1 ? "s" : ""})`, 0);
  const review = await analyzeGame(pgn, `ext:${hashString(pgn)}`, engine, preset, {
    onProgress: (_r, done, total) =>
      setProgress(`Analyzing move ${Math.min(done, total)}/${total}`, Math.round((done / Math.max(1, total)) * 100)),
  });
  setProgress("Analysis complete", 100);
  return toPopupAnalysis(review, pgn);
}

/** Maps a shared GameReview onto the shape the popup's renderers expect. */
function toPopupAnalysis(review, pgn) {
  const info = (line, multipv) =>
    line ? { multipv, type: line.score.type, value: line.score.value, pv: line.uci, depth: line.depth } : null;

  let prevAfter = review.startEval ? { multipv: 1, ...review.startEval, pv: [] } : null;
  const perMove = review.moves.map((m) => {
    const pvLines = {};
    m.lines.forEach((l, i) => (pvLines[i + 1] = info(l, i + 1)));
    const evalBefore = pvLines[1] || prevAfter; // White POV
    const evalAfter = { multipv: 1, ...m.evalAfter, pv: [] };
    prevAfter = evalAfter;
    return {
      ply: m.ply,
      color: m.color === "w" ? "white" : "black",
      san: m.san,
      uci: m.uci,
      fenBefore: m.fenBefore,
      fenAfter: m.fenAfter,
      evalBefore,
      evalAfter,
      winBefore: m.winBefore,
      winAfter: m.winAfter,
      winLoss: m.winLoss,
      accuracy: m.accuracy,
      cpLoss: m.cpLoss,
      tag: m.classification,
      symbol: CLASS_META[m.classification].glyph,
      pvLines,
      bestMove: m.bestUci,
      from: m.from,
      to: m.to,
    };
  });

  const side = (s) => ({
    accuracy: s.accuracy === null ? 0 : Math.round(s.accuracy * 10) / 10,
    acpl: s.acpl,
    counts: s.counts,
  });

  return {
    headers: review.headers,
    startFen: review.startFen === "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" ? undefined : review.startFen,
    perMove,
    white: side(review.white),
    black: side(review.black),
    opening: review.opening,
    engine: review.engine,
    pgn,
  };
}

/* ============================================================
   UI RENDERING
   ============================================================ */

function setProgress(text, percent) {
  if (progressText) progressText.textContent = text;
  if (progressBar) progressBar.style.width = `${percent}%`;
}

function getAccuracyClass(accuracy) {
  if (accuracy >= 90) return "";
  if (accuracy >= 70) return "medium";
  return "low";
}

function renderBadges(container, counts) {
  if (!container || !counts) return;

  const order = [
    ["brilliant", "💎"],
    ["great", "!"],
    ["best", "★"],
    ["excellent", "✓"],
    ["good", "○"],
    ["book", "📖"],
    ["forced", "→"],
    ["inaccuracy", "?!"],
    ["mistake", "?"],
    ["miss", "✕"],
    ["blunder", "??"],
  ];

  container.innerHTML = order
    .filter(([key]) => (counts[key] || 0) > 0)
    .map(
      ([key, icon]) => `
      <div class="move-badge" data-type="${key}">
        <span class="icon">${icon}</span>
        <span>${counts[key]}</span>
      </div>
    `,
    )
    .join("");
}

function renderSummary(analysis) {
  const h = analysis.headers || {};

  // Player names
  if (wNameEl) wNameEl.textContent = h.White || "White";
  if (bNameEl) bNameEl.textContent = h.Black || "Black";
  if (wRatingEl) wRatingEl.textContent = h.WhiteElo || "—";
  if (bRatingEl) bRatingEl.textContent = h.BlackElo || "—";

  // Accuracy
  if (wAccuracyEl) {
    wAccuracyEl.textContent = `${analysis.white.accuracy}%`;
    wAccuracyEl.className = `accuracy-value ${getAccuracyClass(
      analysis.white.accuracy,
    )}`;
  }
  if (bAccuracyEl) {
    bAccuracyEl.textContent = `${analysis.black.accuracy}%`;
    bAccuracyEl.className = `accuracy-value ${getAccuracyClass(
      analysis.black.accuracy,
    )}`;
  }

  // ACPL
  if (wAcplEl) wAcplEl.textContent = String(analysis.white.acpl);
  if (bAcplEl) bAcplEl.textContent = String(analysis.black.acpl);

  // Badges
  renderBadges(wBadgesEl, analysis.white.counts);
  renderBadges(bBadgesEl, analysis.black.counts);

  // Opening
  if (openingNameEl) {
    const opening =
      h.Opening || h.ECOUrl?.split("/").pop()?.replace(/-/g, " ") || "Unknown";
    openingNameEl.textContent = `Opening: ${opening}`;
  }

  renderAdvantageChart(analysis.perMove || []);
  renderAccuracyChart(analysis.perMove || []);
  renderMovesList(analysis);

  if (btnBoard) btnBoard.disabled = false;

  setProgress("Analysis complete", 100);
  setTimeout(() => setProgress("Ready", 0), 2000);
}

/* ============================================================
   CHARTS
   - perMove evals are stored as White POV, so do NOT negate here.
   ============================================================ */

function renderAdvantageChart(perMove) {
  if (!advCanvas) return;

  const ctx2 = advCanvas.getContext("2d");
  const w = advCanvas.width;
  const h = advCanvas.height;

  ctx2.clearRect(0, 0, w, h);
  if (!perMove.length) return;

  // Background
  ctx2.fillStyle = "#272522";
  ctx2.fillRect(0, 0, w, h);

  // Center line
  const centerY = h / 2;
  ctx2.strokeStyle = "#4a4745";
  ctx2.lineWidth = 1;
  ctx2.beginPath();
  ctx2.moveTo(0, centerY);
  ctx2.lineTo(w, centerY);
  ctx2.stroke();

  const points = [];
  const maxEval = 500; // clamp ±5.0 pawns

  for (let i = 0; i < perMove.length; i++) {
    const m = perMove[i];
    let cp = 0;

    if (m.evalBefore) {
      if (m.evalBefore.type === "cp") cp = m.evalBefore.value;
      else if (m.evalBefore.type === "mate")
        cp = m.evalBefore.value > 0 ? 1000 : -1000;
    }

    points.push(Math.max(-maxEval, Math.min(maxEval, cp)));
  }

  // Add final point from last evalAfter (also White POV)
  const lastMove = perMove[perMove.length - 1];
  if (lastMove?.evalAfter) {
    let cp = 0;
    if (lastMove.evalAfter.type === "cp") cp = lastMove.evalAfter.value;
    else if (lastMove.evalAfter.type === "mate")
      cp = lastMove.evalAfter.value > 0 ? 1000 : -1000;

    points.push(Math.max(-maxEval, Math.min(maxEval, cp)));
  }

  if (points.length < 2) return;

  const padding = 10;
  const graphW = w - padding * 2;
  const graphH = h - padding * 2;

  // Fill
  ctx2.beginPath();
  ctx2.moveTo(padding, centerY);

  for (let i = 0; i < points.length; i++) {
    const x = padding + (i / (points.length - 1)) * graphW;
    const y = centerY - (points[i] / maxEval) * (graphH / 2);
    ctx2.lineTo(x, y);
  }

  ctx2.lineTo(padding + graphW, centerY);
  ctx2.closePath();

  const gradient = ctx2.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.8)");
  gradient.addColorStop(0.5, "rgba(128, 128, 128, 0.3)");
  gradient.addColorStop(1, "rgba(64, 61, 57, 0.8)");
  ctx2.fillStyle = gradient;
  ctx2.fill();

  // Line
  ctx2.beginPath();
  for (let i = 0; i < points.length; i++) {
    const x = padding + (i / (points.length - 1)) * graphW;
    const y = centerY - (points[i] / maxEval) * (graphH / 2);
    if (i === 0) ctx2.moveTo(x, y);
    else ctx2.lineTo(x, y);
  }
  ctx2.strokeStyle = "#81b64c";
  ctx2.lineWidth = 2;
  ctx2.stroke();
}

function renderAccuracyChart(perMove) {
  if (!accCanvas) return;

  const ctx2 = accCanvas.getContext("2d");
  const w = accCanvas.width;
  const h = accCanvas.height;

  ctx2.clearRect(0, 0, w, h);
  if (!perMove.length) return;

  ctx2.fillStyle = "#272522";
  ctx2.fillRect(0, 0, w, h);

  const padding = 10;
  const barWidth = Math.max(2, (w - padding * 2) / perMove.length - 1);

  for (let i = 0; i < perMove.length; i++) {
    const m = perMove[i];
    const x = padding + i * (barWidth + 1);
    const barH = ((m.accuracy || 0) / 100) * (h - padding * 2);
    const y = h - padding - barH;

    ctx2.fillStyle = TAG_COLORS[m.tag] || "#97af8b";
    ctx2.fillRect(x, y, barWidth, barH);
  }
}

/* ============================================================
   MOVES LIST
   ============================================================ */

function formatEval(info) {
  if (!info) return "";
  if (info.type === "mate") return `M${Math.abs(info.value)}`;
  const pawns = (info.value / 100).toFixed(1);
  return info.value >= 0 ? `+${pawns}` : pawns;
}

function renderMovesList(analysis) {
  if (!movesList) return;

  const h = analysis.headers || {};
  if (movesTitle) {
    movesTitle.textContent = `${h.White || "White"} vs ${h.Black || "Black"}`;
  }
  if (movesSubtitle) {
    movesSubtitle.textContent = `${h.Event || "Game"} • ${h.Result || "*"}`;
  }

  movesList.innerHTML = "";

  const perMove = analysis.perMove || [];
  for (let i = 0; i < perMove.length; i += 2) {
    const w = perMove[i];
    const b = perMove[i + 1];
    const moveNum = Math.floor(i / 2) + 1;

    const row = document.createElement("div");
    row.className = "move-row";

    row.innerHTML = `
      <div class="move-number">${moveNum}.</div>
      <div class="move-cell">
        ${
          w
            ? `
          <span class="move-san" data-ply="${w.ply}">${w.san}</span>
          <span class="move-tag ${w.tag}" title="${w.tag}">${
            TAG_ICONS[w.tag] || ""
          }</span>
          <span class="move-eval">${formatEval(w.evalBefore)}</span>
        `
            : ""
        }
      </div>
      <div class="move-cell">
        ${
          b
            ? `
          <span class="move-san" data-ply="${b.ply}">${b.san}</span>
          <span class="move-tag ${b.tag}" title="${b.tag}">${
            TAG_ICONS[b.tag] || ""
          }</span>
          <span class="move-eval">${formatEval(b.evalBefore)}</span>
        `
            : ""
        }
      </div>
    `;

    if (w?.tag === "blunder" || w?.tag === "mistake") {
      setTimeout(() => row.classList.add(`flash-${w.tag}`), 50 + i * 30);
      setTimeout(() => row.classList.remove(`flash-${w.tag}`), 1500 + i * 30);
    }
    if (b?.tag === "blunder" || b?.tag === "mistake") {
      setTimeout(() => row.classList.add(`flash-${b.tag}`), 50 + i * 30);
      setTimeout(() => row.classList.remove(`flash-${b.tag}`), 1500 + i * 30);
    }

    movesList.appendChild(row);
  }

  movesList.querySelectorAll(".move-san").forEach((el) => {
    el.addEventListener("click", () => {
      const ply = parseInt(el.dataset.ply, 10);
      switchToBoard(ply);
    });
  });
}

/* ============================================================
   PART 3/3 continues: Board rendering + listeners + PGN fetch
   ============================================================ */
// popup.js — DROP-IN FILE (PART 3/3)
// Copy-paste this directly BELOW PART 2/3.

/* ============================================================
   BOARD RENDERING (evals are White POV everywhere)
   ============================================================ */

const boardWrapper = $("#board-wrapper");

const PIECE_IMAGES = {};
const PIECE_KEYS = [
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

async function preloadPieces() {
  const promises = PIECE_KEYS.map((key) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        PIECE_IMAGES[key] = img;
        resolve(true);
      };
      img.onerror = () => resolve(false);
      img.src = chrome.runtime.getURL(`pieces/${key}.png`);
    });
  });

  await Promise.all(promises);
}

// Board state
let boardAnalysis = null;
let boardGame = null;
let currentPly = 0;
let flipped = false;
let selectedPV = 1;
let selectedSquare = null;
let isCustomMode = false;
let customFen = null;

function setupBoardCanvas() {
  if (!boardCanvas) return;
  const dpr = window.devicePixelRatio || 1;

  boardCanvas.style.width = `${BOARD_SIZE}px`;
  boardCanvas.style.height = `${BOARD_SIZE}px`;
  boardCanvas.width = Math.floor(BOARD_SIZE * dpr);
  boardCanvas.height = Math.floor(BOARD_SIZE * dpr);

  ctx = boardCanvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Add click listener
  boardCanvas.removeEventListener("mousedown", handleBoardClick);
  boardCanvas.addEventListener("mousedown", handleBoardClick);
}

function sqToXY(sq) {
  const file = "abcdefgh".indexOf(sq[0]);
  const rank = parseInt(sq[1], 10) - 1;

  const fx = flipped ? 7 - file : file;
  const fy = flipped ? rank : 7 - rank;

  return { x: fx * SQ_SIZE, y: fy * SQ_SIZE };
}

function drawBoard() {
  if (!ctx) return;

  ctx.clearRect(0, 0, BOARD_SIZE, BOARD_SIZE);

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const isLight = (r + f) % 2 === 0;
      ctx.fillStyle = isLight ? COLORS.light : COLORS.dark;

      const drawF = flipped ? 7 - f : f;
      const drawR = flipped ? r : 7 - r;

      ctx.fillRect(drawF * SQ_SIZE, drawR * SQ_SIZE, SQ_SIZE, SQ_SIZE);
    }
  }

  renderCoords();
}

function renderCoords() {
  if (!boardCoords) return;
  boardCoords.innerHTML = "";

  const files = flipped ? "hgfedcba" : "abcdefgh";
  const ranks = flipped ? "12345678" : "87654321";

  for (let i = 0; i < 8; i++) {
    const fileEl = document.createElement("div");
    fileEl.className = `board-coord file ${i % 2 === 0 ? "dark" : "light"}`;
    fileEl.style.left = `${i * SQ_SIZE + SQ_SIZE - 8}px`;
    fileEl.style.bottom = "2px";
    fileEl.textContent = files[i];
    boardCoords.appendChild(fileEl);

    const rankEl = document.createElement("div");
    rankEl.className = `board-coord rank ${i % 2 === 0 ? "light" : "dark"}`;
    rankEl.style.right = "4px";
    rankEl.style.top = `${i * SQ_SIZE + 2}px`;
    rankEl.textContent = ranks[i];
    boardCoords.appendChild(rankEl);
  }
}

function drawPieces(game) {
  if (!ctx || !game) return;

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = "abcdefgh"[f] + (8 - r);
      const piece = game.get(sq);
      if (!piece) continue;

      const { x, y } = sqToXY(sq);
      const key = (piece.color === "w" ? "w" : "b") + piece.type.toUpperCase();
      const img = PIECE_IMAGES[key];

      if (img) {
        const padding = SQ_SIZE * 0.05;
        ctx.drawImage(
          img,
          x + padding,
          y + padding,
          SQ_SIZE - padding * 2,
          SQ_SIZE - padding * 2,
        );
      } else {
        // fallback
        ctx.fillStyle = piece.color === "w" ? "#fff" : "#000";
        ctx.beginPath();
        ctx.arc(
          x + SQ_SIZE / 2,
          y + SQ_SIZE / 2,
          SQ_SIZE * 0.35,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.strokeStyle = piece.color === "w" ? "#000" : "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }
}

function highlightSquares(squares, color) {
  if (!ctx) return;
  ctx.fillStyle = color;
  for (const sq of squares) {
    const { x, y } = sqToXY(sq);
    ctx.fillRect(x, y, SQ_SIZE, SQ_SIZE);
  }
}

function drawArrow(from, to, color) {
  if (!ctx) return;

  const a = sqToXY(from);
  const b = sqToXY(to);

  const x1 = a.x + SQ_SIZE / 2;
  const y1 = a.y + SQ_SIZE / 2;
  const x2 = b.x + SQ_SIZE / 2;
  const y2 = b.y + SQ_SIZE / 2;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;

  const ux = dx / len;
  const uy = dy / len;

  const headLen = SQ_SIZE * 0.3;
  const headWidth = SQ_SIZE * 0.2;
  const lineWidth = SQ_SIZE * 0.15;

  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(x1 + ux * SQ_SIZE * 0.2, y1 + uy * SQ_SIZE * 0.2);
  ctx.lineTo(x2 - ux * headLen, y2 - uy * headLen);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - ux * headLen - uy * headWidth,
    y2 - uy * headLen + ux * headWidth,
  );
  ctx.lineTo(
    x2 - ux * headLen + uy * headWidth,
    y2 - uy * headLen - ux * headWidth,
  );
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function updateEvalBar(infoWhite) {
  if (!evalBarWhite) return;

  // infoWhite is White POV
  let winPercent = 50;
  if (infoWhite) winPercent = evalToWinPercent(infoWhite);

  // Clamp for display
  winPercent = Math.max(1, Math.min(99, winPercent));
  evalBarWhite.style.height = `${winPercent}%`;

  let evalText = "0.0";
  if (infoWhite) {
    if (infoWhite.type === "mate") {
      evalText = `M${Math.abs(infoWhite.value)}`;
    } else {
      evalText = (Math.abs(infoWhite.value) / 100).toFixed(1);
    }
  }

  if (evalTop) {
    evalTop.textContent = winPercent > 50 ? evalText : "";
    evalTop.style.color = "#403d39";
  }
  if (evalBottom) {
    evalBottom.textContent = winPercent <= 50 ? evalText : "";
    evalBottom.style.color = "#fff";
  }
}

function uciToSan(fen, uci) {
  if (!uci) return null;
  const g = new Chess(fen);
  try {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.slice(4) || undefined;
    const m = g.move({ from, to, promotion });
    return m?.san || null;
  } catch (e) {
    return null;
  }
}

function pvToSanList(fen, pv) {
  const g = new Chess(fen);
  const sanList = [];

  for (const uci of pv || []) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.slice(4) || undefined;

    try {
      const m = g.move({ from, to, promotion });
      if (!m) break;
      sanList.push(m.san);
    } catch (e) {
      break;
    }
  }

  return sanList;
}

function renderMiniMoves() {
  if (!miniMoves || !boardAnalysis) return;

  const perMove = boardAnalysis.perMove || [];
  let html = "";

  for (let i = 0; i < perMove.length; i += 2) {
    const w = perMove[i];
    const b = perMove[i + 1];
    const num = Math.floor(i / 2) + 1;

    html += `<div class="mini-move-row">`;
    html += `<span class="mini-move-num">${num}.</span>`;

    if (w) {
      html += `<button class="mini-move-btn ${
        currentPly === w.ply ? "selected" : ""
      }" data-ply="${w.ply}">${w.san}</button>`;
    }
    if (b) {
      html += `<button class="mini-move-btn ${
        currentPly === b.ply ? "selected" : ""
      }" data-ply="${b.ply}">${b.san}</button>`;
    }

    html += `</div>`;
  }

  miniMoves.innerHTML = html;

  miniMoves.querySelectorAll(".mini-move-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      gotoPly(parseInt(btn.dataset.ply, 10));
    });
  });
}

function gotoPly(ply) {
  if (!boardAnalysis) return;

  const perMove = boardAnalysis.perMove || [];
  currentPly = Math.max(0, Math.min(ply, perMove.length));

  const game = new Chess(boardAnalysis.startFen);
  for (let i = 0; i < currentPly; i++) {
    try {
      game.move(perMove[i].san, { sloppy: true });
    } catch (e) {}
  }
  boardGame = game;

  // Reset interactive state
  isCustomMode = false;
  selectedSquare = null;
  customFen = null;

  if (boardOverlay) boardOverlay.innerHTML = "";

  drawBoard();

  if (currentPly > 0) {
    const lastMove = perMove[currentPly - 1];
    if (lastMove.from && lastMove.to) {
      highlightSquares([lastMove.from, lastMove.to], COLORS.highlightLast);
    }
  }

  drawPieces(game);

  // Best-move arrow from PV (green)
  if (currentPly > 0) {
    const node = perMove[currentPly - 1];
    const pvData = node.pvLines?.[selectedPV];

    if (pvData?.pv?.[0]) {
      const uci = pvData.pv[0];
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      drawArrow(from, to, COLORS.arrowGreen);
    }
  }

  // Eval bar uses White POV evalBefore
  if (currentPly > 0) {
    updateEvalBar(perMove[currentPly - 1].evalBefore);
  } else {
    updateEvalBar(null);
  }

  if (plyDisplay) {
    plyDisplay.textContent = `${currentPly}/${perMove.length}`;
  }

  if (posFen) posFen.textContent = game.fen();

  if (currentPly > 0) {
    const node = perMove[currentPly - 1];
    const pvData = node.pvLines?.[selectedPV];

    if (bestMoveSan) {
      if (pvData?.pv?.[0]) {
        const sanMove = uciToSan(node.fenBefore, pvData.pv[0]);
        bestMoveSan.textContent = sanMove || pvData.pv[0];
      } else {
        bestMoveSan.textContent = "—";
      }
    }

    if (pvLine) {
      if (pvData?.pv?.length) {
        const sanList = pvToSanList(node.fenBefore, pvData.pv);
        pvLine.textContent = `PV: ${sanList.join(" ")}`;
      } else {
        pvLine.textContent = "PV: —";
      }
    }

    if (evalDisplay) {
      if (pvData) {
        evalDisplay.textContent = formatEval(pvData);
        evalDisplay.className = `eval-display ${
          pvData.value >= 0 ? "positive" : "negative"
        }`;
      } else {
        evalDisplay.textContent = "—";
        evalDisplay.className = "eval-display";
      }
    }
  } else {
    if (bestMoveSan) bestMoveSan.textContent = "—";
    if (pvLine) pvLine.textContent = "PV: —";
    if (evalDisplay) {
      evalDisplay.textContent = "—";
      evalDisplay.className = "eval-display";
    }
  }

  if (moveBadgeOverlay && currentPly > 0) {
    const node = perMove[currentPly - 1];
    moveBadgeOverlay.textContent = String(node.tag || "").toUpperCase();
    moveBadgeOverlay.style.background = TAG_COLORS[node.tag] || "#666";
    moveBadgeOverlay.style.display = "block";
  } else if (moveBadgeOverlay) {
    moveBadgeOverlay.style.display = "none";
  }

  renderMiniMoves();
}

function xyToSq(x, y) {
  const file = Math.floor(x / SQ_SIZE);
  const rank = Math.floor(y / SQ_SIZE);

  const fx = flipped ? 7 - file : file;
  const fy = flipped ? rank : 7 - rank;

  if (fx < 0 || fx > 7 || fy < 0 || fy > 7) return null;
  return "abcdefgh"[fx] + (8 - fy);
}

async function handleBoardClick(e) {
  if (!boardGame) return;

  const rect = boardCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const sq = xyToSq(x, y);
  if (!sq) return;

  if (selectedSquare) {
    if (selectedSquare === sq) {
      selectedSquare = null;
      redrawCurrentState();
      return;
    }

    // Try move
    try {
      const testGame = new Chess(boardGame.fen());
      const move = testGame.move({
        from: selectedSquare,
        to: sq,
        promotion: "q",
      });

      if (move) {
        boardGame.move({ from: selectedSquare, to: sq, promotion: "q" });
        selectedSquare = null;
        isCustomMode = true;
        customFen = boardGame.fen();

        redrawCurrentState();
        await analyzeCustomPosition();
      } else {
        const piece = boardGame.get(sq);
        if (piece && piece.color === boardGame.turn()) {
          selectedSquare = sq;
        } else {
          selectedSquare = null;
        }
      }
    } catch (err) {
      selectedSquare = null;
    }
  } else {
    const piece = boardGame.get(sq);
    if (piece && piece.color === boardGame.turn()) {
      selectedSquare = sq;
    }
  }

  redrawCurrentState();
}

function redrawCurrentState() {
  drawBoard();

  if (selectedSquare) {
    highlightSquares([selectedSquare], "rgba(255, 255, 0, 0.4)");

    // Draw legal move dots
    const moves = boardGame.moves({ square: selectedSquare, verbose: true });
    for (const m of moves) {
      const { x, y } = sqToXY(m.to);
      ctx.beginPath();
      ctx.arc(x + SQ_SIZE / 2, y + SQ_SIZE / 2, SQ_SIZE * 0.15, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
      ctx.fill();
    }
  }

  drawPieces(boardGame);
}

async function analyzeCustomPosition() {
  if (!boardGame) return;
  const fen = boardGame.fen();
  const stm = boardGame.turn();

  if (posFen) posFen.textContent = fen;
  if (bestMoveSan) bestMoveSan.textContent = "...";
  if (pvLine) pvLine.textContent = "Analyzing...";

  const results = await analyzePosition(fen, { depth: 20, movetime: 1500 }, 3);
  if (results.length > 0 && isCustomMode && customFen === boardGame.fen()) {
    const bestInfoRoot = results[0];
    const bestInfoWhite = evalFromWhitePov(bestInfoRoot, stm);
    updateEvalBar(bestInfoWhite);

    if (bestMoveSan) {
      const sanMove = uciToSan(fen, results[0].pv[0]);
      bestMoveSan.textContent = sanMove || results[0].pv[0];
    }

    if (pvLine) {
      const sanList = pvToSanList(fen, results[0].pv.slice(0, 5));
      pvLine.textContent = `Best: ${sanList.join(" ")}`;
    }

    if (evalDisplay) {
      evalDisplay.textContent = formatEval(bestInfoRoot);
      evalDisplay.className = `eval-display ${
        bestInfoRoot.value >= 0 ? "positive" : "negative"
      }`;
    }

    // Draw arrow for best move
    redrawCurrentState();
    const uci = results[0].pv[0];
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    drawArrow(from, to, COLORS.arrowGreen);
  }
}

function updateMoveBadge(node) {
  if (!moveBadgeOverlay) return;

  if (node && node.tag) {
    moveBadgeOverlay.textContent = String(node.tag || "").toUpperCase();
    moveBadgeOverlay.style.background = TAG_COLORS[node.tag] || "#666";
    moveBadgeOverlay.style.display = "block";
  } else {
    moveBadgeOverlay.style.display = "none";
  }
}

async function initBoard(analysis) {
  boardAnalysis = analysis;
  currentPly = 0;
  flipped = false;
  selectedPV = 1;

  await preloadPieces();
  setupBoardCanvas();
  gotoPly(0);
}

function switchToBoard(ply = 0) {
  if (!lastAnalysis) return;

  $$(".tab").forEach((t) => t.classList.remove("active"));
  $$(".panel").forEach((p) => {
    p.classList.remove("active");
    p.setAttribute("aria-hidden", "true");
  });

  const boardTab = $('[data-tab="board"]');
  const boardPanel = $("#panel-board");

  if (boardTab) boardTab.classList.add("active");
  if (boardPanel) {
    boardPanel.classList.add("active");
    boardPanel.setAttribute("aria-hidden", "false");
  }

  initBoard(lastAnalysis).then(() => {
    gotoPly(ply);
  });
}

/* ============================================================
   EVENT LISTENERS
   ============================================================ */

// Tab switching
$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const targetTab = tab.dataset.tab;

    $$(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    $$(".panel").forEach((p) => {
      const isActive = p.id === `panel-${targetTab}`;
      p.classList.toggle("active", isActive);
      p.setAttribute("aria-hidden", String(!isActive));
    });

    if (targetTab === "board" && lastAnalysis) {
      initBoard(lastAnalysis);
    }
  });
});

// Get PGN button
if (btnAuto) {
  btnAuto.addEventListener("click", async () => {
    setProgress("Fetching PGN...", 0);
    try {
      const pgn = await loadPgnFromPage();
      if (pgnInput) pgnInput.value = pgn;
      setProgress("PGN loaded", 0);
    } catch (e) {
      console.error(e);
      setProgress(`Error: ${e.message}`, 0);
    }
  });
}

// Analyze button
if (btnAnalyze) {
  btnAnalyze.addEventListener("click", async () => {
    const pgn = pgnInput?.value?.trim();
    if (!pgn) {
      setProgress("Please enter or fetch a PGN first", 0);
      return;
    }

    try {
      setProgress("Starting engine...", 0);
      const preset = presetEl?.value || "standard";
      const analysis = await runAnalysis(pgn, preset);
      lastAnalysis = analysis;
      renderSummary(analysis);
    } catch (e) {
      console.error(e);
      setProgress(`Error: ${e.message}`, 0);
    }
  });
}

// Board view button
if (btnBoard) {
  btnBoard.addEventListener("click", () => {
    switchToBoard(0);
  });
}

// Board navigation
if (btnFirst) btnFirst.addEventListener("click", () => gotoPly(0));
if (btnPrev) btnPrev.addEventListener("click", () => gotoPly(currentPly - 1));
if (btnNext) btnNext.addEventListener("click", () => gotoPly(currentPly + 1));
if (btnLast) {
  btnLast.addEventListener("click", () => {
    gotoPly(boardAnalysis?.perMove?.length || 0);
  });
}

// Back button
if (btnBack) {
  btnBack.addEventListener("click", () => {
    const summaryTab = $('[data-tab="summary"]');
    if (summaryTab) summaryTab.click();
  });
}

// Flip board
if (flipBoard) {
  flipBoard.addEventListener("change", () => {
    flipped = !!flipBoard.checked;
    gotoPly(currentPly);
  });
}

// PV buttons
$$(".pv-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedPV = parseInt(btn.dataset.pv, 10);
    $$(".pv-btn").forEach((b) => b.classList.toggle("active", b === btn));
    gotoPly(currentPly);
  });
});

// Quick filters
$$(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const filter = btn.dataset.filter;
    if (!boardAnalysis) return;

    const idx = boardAnalysis.perMove.findIndex((m) => m.tag === filter);
    if (idx !== -1) gotoPly(idx + 1);
  });
});

// Keyboard navigation (board panel only)
document.addEventListener("keydown", (e) => {
  const boardPanel = $("#panel-board");
  if (!boardPanel?.classList.contains("active")) return;

  switch (e.key) {
    case "ArrowLeft":
      gotoPly(currentPly - 1);
      break;
    case "ArrowRight":
      gotoPly(currentPly + 1);
      break;
    case "Home":
      gotoPly(0);
      break;
    case "End":
      gotoPly(boardAnalysis?.perMove?.length || 0);
      break;
    case "f":
      if (flipBoard) {
        flipBoard.checked = !flipBoard.checked;
        flipped = !!flipBoard.checked;
        gotoPly(currentPly);
      }
      break;
  }
});

/* ============================================================
   CONTENT SCRIPT COMMUNICATION
   ============================================================ */

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");
  return tab.id;
}

async function sendToTab(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (res) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(res);
      }
    });
  });
}

async function ensureContentScript(tabId) {
  try {
    const res = await sendToTab(tabId, { type: "PING" });
    if (res?.pong) return;
  } catch (e) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  }
}

async function getGameContext() {
  const tabId = await getActiveTabId();
  await ensureContentScript(tabId);

  const res = await sendToTab(tabId, { type: "GET_GAME_CONTEXT" });
  if (!res?.ok) throw new Error(res?.error || "Failed to get game context");
  return res;
}

async function fetchPgnFromApi(username, year, month) {
  const url = `${API_ORIGIN}/pgn?username=${encodeURIComponent(
    username,
  )}&year=${year}&month=${month}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function loadPgnFromPage() {
  const ctx = await getGameContext();
  const { meta, year, month, usernames } = ctx;

  if (!meta?.id) throw new Error("Game ID not found");
  if (!usernames?.length) throw new Error("Usernames not found");

  for (const username of usernames) {
    try {
      const games = await fetchPgnFromApi(username, year, month);
      const game = games.find((g) => String(g.gameID) === String(meta.id));
      if (game?.PGN) return game.PGN;
    } catch (e) {
      // try next username
    }
  }

  throw new Error("Game not found in archives");
}

/* ============================================================
   INITIALIZATION
   ============================================================ */

initEngine();
window.addEventListener("unload", shutdownEngine);

window.__wazir = {
  initBoard,
  buildBoardFromSummary: initBoard, // alias for UI
  lastSummaryGetter: () => lastAnalysis,
  parseHeadersFromPgn: (pgn) => parseHeaders(pgn),
  switchToBoard,
  gotoPly,
};

setProgress("Ready", 0);
