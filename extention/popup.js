// popup.js — Wazir Premium: Chess.com-accurate analysis engine
import { Chess } from "./lib/chess.js";

const API_ORIGIN = "https://chess-pgn-api.shreyash-chandra123.workers.dev";

/* ============================================================
   CHESS.COM ACCURACY MODEL
   
   Chess.com uses win probability to calculate accuracy:
   - Win% = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
   - Accuracy per move = 103.1668 * exp(-0.04354 * winLoss) - 3.1669
   - Clamped to [0, 100]
   ============================================================ */

function cpToWinPercent(cp) {
  cp = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function mateToWinPercent(mateIn) {
  if (mateIn > 0) return 100;
  if (mateIn < 0) return 0;
  return 50;
}

function evalToWinPercent(info) {
  if (!info) return 50;
  if (info.type === "mate") {
    return mateToWinPercent(info.value);
  }
  return cpToWinPercent(info.value);
}

function winPercentToAccuracy(winBefore, winAfter, isWhite) {
  let winLoss;
  if (isWhite) {
    winLoss = winBefore - winAfter;
  } else {
    winLoss = 100 - winBefore - (100 - winAfter);
  }

  if (winLoss <= 0) return 100;

  const accuracy = 103.1668 * Math.exp(-0.04354 * winLoss) - 3.1669;
  return Math.max(0, Math.min(100, accuracy));
}

function classifyMoveChessCom(
  winLoss,
  cpBefore,
  cpAfter,
  preTop,
  playedInfo,
  ply
) {
  // Check for brilliant move
  if (preTop && preTop.length >= 2 && playedInfo) {
    const bestCp = preTop[0]?.type === "cp" ? preTop[0].value : 0;
    const playedCp = playedInfo?.type === "cp" ? -playedInfo.value : 0;
    const secondCp = preTop[1]?.type === "cp" ? preTop[1].value : 0;

    if (
      winLoss <= 2 &&
      bestCp - secondCp >= 150 &&
      Math.abs(playedCp - bestCp) <= 20
    ) {
      return { tag: "brilliant", symbol: "!!" };
    }

    if (
      winLoss <= 1 &&
      bestCp - secondCp >= 100 &&
      Math.abs(playedCp - bestCp) <= 10
    ) {
      return { tag: "great", symbol: "!" };
    }
  }

  // Book moves
  if (ply <= 12 && Math.abs(cpBefore) <= 30 && Math.abs(cpAfter) <= 30) {
    return { tag: "book", symbol: "" };
  }

  // Classification by win% loss
  if (winLoss <= 2) return { tag: "best", symbol: "" };
  if (winLoss <= 5) return { tag: "excellent", symbol: "" };
  if (winLoss <= 10) return { tag: "good", symbol: "" };
  if (winLoss <= 15) return { tag: "inaccuracy", symbol: "?!" };
  if (winLoss <= 25) return { tag: "mistake", symbol: "?" };
  return { tag: "blunder", symbol: "??" };
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
const depthEl = $("#depth");
const msEl = $("#ms");
const mpvEl = $("#mpv");
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
const boardWrapper = $("#board-wrapper");
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

const TAG_COLORS = {
  brilliant: "#1baca6",
  great: "#5c8bb0",
  best: "#96bc4b",
  excellent: "#96bc4b",
  good: "#97af8b",
  book: "#a88865",
  inaccuracy: "#f7c631",
  mistake: "#e6912c",
  blunder: "#ca3431",
};

const TAG_ICONS = {
  brilliant: "💎",
  great: "!",
  best: "★",
  excellent: "✓",
  good: "",
  book: "📖",
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
};

/* ============================================================
   ENGINE MANAGEMENT
   ============================================================ */

let engine = null;
let engineReady = false;
let currentMultiPV = 3;

const ENGINE_TIMEOUT = 8000;

function initEngine() {
  if (engine) return;
  engineReady = false;

  try {
    engine = new Worker(
      chrome.runtime.getURL("stockfish/stockfish-17.1-lite-single-03e3232.js")
    );
  } catch (err) {
    console.error("Engine init failed:", err);
    setProgress("Engine failed to start", 0);
    return;
  }

  engine.addEventListener("message", (e) => {
    const line = typeof e.data === "string" ? e.data : e.data?.data;
    if (!line) return;

    if (line.includes("uciok")) {
      post("setoption name Threads value 1");
      post("setoption name Hash value 64");
      post(`setoption name MultiPV value ${currentMultiPV}`);
      post("isready");
    } else if (line.includes("readyok")) {
      engineReady = true;
      setProgress("Engine ready", 0);
    }
  });

  engine.onerror = (ev) => {
    console.error("Engine error:", ev);
    setProgress("Engine error", 0);
  };

  engine.postMessage("uci");
}

function shutdownEngine() {
  if (engine) {
    try {
      engine.terminate();
    } catch (e) {}
    engine = null;
    engineReady = false;
  }
}

function post(cmd) {
  if (engine) engine.postMessage(cmd);
}

function waitEngineReady(timeout = 7000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = setInterval(() => {
      if (engineReady) {
        clearInterval(check);
        resolve(true);
      } else if (Date.now() - start > timeout) {
        clearInterval(check);
        resolve(false);
      }
    }, 50);
  });
}

function parseMultiPVInfo(line) {
  const mpvMatch = line.match(/\bmultipv\s+(\d+)/);
  const scoreMatch = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
  const pvMatch = line.match(/\bpv\s+(.+)$/);
  const depthMatch = line.match(/\bdepth\s+(\d+)/);

  if (!mpvMatch || !scoreMatch) return null;

  return {
    multipv: parseInt(mpvMatch[1], 10),
    type: scoreMatch[1],
    value: parseInt(scoreMatch[2], 10),
    pv: pvMatch ? pvMatch[1].trim().split(/\s+/) : [],
    depth: depthMatch ? parseInt(depthMatch[1], 10) : 0,
  };
}

function analyzePosition(fen, opts, multipv) {
  return new Promise((resolve) => {
    if (!engine) return resolve([]);

    const results = {};
    let resolved = false;

    const handler = (e) => {
      const line = typeof e.data === "string" ? e.data : e.data?.data;
      if (!line || resolved) return;

      if (line.startsWith("info ") && line.includes("multipv")) {
        const info = parseMultiPVInfo(line);
        if (info && info.multipv <= multipv) {
          results[info.multipv] = info;
        }
      } else if (line.startsWith("bestmove ")) {
        resolved = true;
        engine.removeEventListener("message", handler);
        clearTimeout(tid);
        resolve(Object.values(results).sort((a, b) => a.multipv - b.multipv));
      }
    };

    engine.addEventListener("message", handler);

    const tid = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          engine.removeEventListener("message", handler);
        } catch (e) {}
        resolve(Object.values(results).sort((a, b) => a.multipv - b.multipv));
      }
    }, ENGINE_TIMEOUT);

    post(`position fen ${fen}`);
    if (multipv !== currentMultiPV) {
      post(`setoption name MultiPV value ${multipv}`);
      currentMultiPV = multipv;
    }

    if (opts.movetime) {
      post(`go movetime ${opts.movetime}`);
    } else {
      post(`go depth ${opts.depth}`);
    }
  });
}

function analyzeMove(fen, moveObj, opts) {
  return new Promise((resolve) => {
    if (!engine) return resolve(null);

    const uci = moveObj.from + moveObj.to + (moveObj.promotion || "");
    let result = null;
    let resolved = false;

    const handler = (e) => {
      const line = typeof e.data === "string" ? e.data : e.data?.data;
      if (!line || resolved) return;

      if (line.startsWith("info ") && line.includes("score")) {
        const info = parseMultiPVInfo(line);
        if (info) result = info;
      } else if (line.startsWith("bestmove ")) {
        resolved = true;
        engine.removeEventListener("message", handler);
        clearTimeout(tid);
        resolve(result);
      }
    };

    engine.addEventListener("message", handler);

    const tid = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          engine.removeEventListener("message", handler);
        } catch (e) {}
        resolve(result);
      }
    }, ENGINE_TIMEOUT);

    post(`position fen ${fen}`);
    if (opts.movetime) {
      post(`go movetime ${opts.movetime} searchmoves ${uci}`);
    } else {
      post(`go depth ${opts.depth} searchmoves ${uci}`);
    }
  });
}

/* ============================================================
   PGN PARSING
   ============================================================ */

function parseHeaders(pgn) {
  const headers = {};
  const re = /\[(\w+)\s+"([^"]*)"\]/g;
  let m;
  while ((m = re.exec(pgn))) {
    headers[m[1]] = m[2];
  }
  return headers;
}

function extractMoves(pgn) {
  let s = pgn
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/;[^\n]*/g, " ")
    .replace(/\$\d+/g, " ");

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
   ANALYSIS ENGINE
   ============================================================ */

let lastAnalysis = null;

async function runAnalysis(pgn, opts) {
  const headers = parseHeaders(pgn);
  const sanMoves = extractMoves(pgn);

  if (!sanMoves.length) {
    throw new Error("No moves found in PGN");
  }

  let startFen;
  if (headers.SetUp === "1" && headers.FEN) {
    startFen = headers.FEN;
  }

  const game = new Chess(startFen);
  const perMove = [];
  const sides = { w: [], b: [] };
  const total = sanMoves.length;

  post("ucinewgame");

  for (let i = 0; i < total; i++) {
    const san = sanMoves[i];
    const fenBefore = game.fen();
    const stm = game.turn();
    const isWhite = stm === "w";

    const preTop = await analyzePosition(fenBefore, opts, opts.multipv || 3);
    const bestInfo = preTop[0];
    const bestCp =
      bestInfo?.type === "cp"
        ? bestInfo.value
        : bestInfo?.type === "mate"
        ? bestInfo.value > 0
          ? 1000
          : -1000
        : 0;
    const winBefore = evalToWinPercent(bestInfo);

    const testGame = new Chess(fenBefore);
    const moveObj = testGame.move(san, { sloppy: true });
    if (!moveObj) {
      console.warn(`Invalid move at ply ${i + 1}: ${san}`);
      break;
    }

    const playedInfo = await analyzeMove(fenBefore, moveObj, opts);

    let postCp = 0;
    if (playedInfo) {
      if (playedInfo.type === "cp") {
        postCp = -playedInfo.value;
      } else if (playedInfo.type === "mate") {
        postCp = playedInfo.value > 0 ? -1000 : 1000;
      }
    }

    const winAfter = 100 - evalToWinPercent(playedInfo);

    game.move(moveObj);

    let winLoss;
    if (isWhite) {
      winLoss = winBefore - winAfter;
    } else {
      winLoss = 100 - winBefore - (100 - winAfter);
    }
    winLoss = Math.max(0, winLoss);

    const moveAccuracy = winPercentToAccuracy(winBefore, winAfter, isWhite);

    const classification = classifyMoveChessCom(
      winLoss,
      bestCp,
      postCp,
      preTop,
      playedInfo,
      i + 1
    );

    const pvMap = {};
    for (const line of preTop) {
      pvMap[line.multipv] = line;
    }

    const entry = {
      ply: i + 1,
      color: isWhite ? "white" : "black",
      san,
      uci: moveObj.from + moveObj.to + (moveObj.promotion || ""),
      fenBefore,
      fenAfter: game.fen(),
      evalBefore: bestInfo,
      evalAfter: playedInfo,
      winBefore,
      winAfter,
      winLoss,
      accuracy: moveAccuracy,
      cpLoss: Math.max(0, bestCp - postCp),
      tag: classification.tag,
      symbol: classification.symbol,
      pvLines: pvMap,
      bestMove: bestInfo?.pv?.[0] || null,
      from: moveObj.from,
      to: moveObj.to,
    };

    perMove.push(entry);
    sides[stm].push(entry);

    const pct = Math.round(((i + 1) / total) * 100);
    setProgress(`Analyzing move ${i + 1}/${total}`, pct);
  }

  const calcStats = (arr) => {
    if (!arr.length) return { accuracy: 0, acpl: 0, counts: {} };

    const avgAccuracy =
      arr.reduce((sum, m) => sum + m.accuracy, 0) / arr.length;
    const avgCpLoss = arr.reduce((sum, m) => sum + m.cpLoss, 0) / arr.length;

    const counts = {
      brilliant: arr.filter((m) => m.tag === "brilliant").length,
      great: arr.filter((m) => m.tag === "great").length,
      best: arr.filter((m) => m.tag === "best").length,
      excellent: arr.filter((m) => m.tag === "excellent").length,
      good: arr.filter((m) => m.tag === "good").length,
      book: arr.filter((m) => m.tag === "book").length,
      inaccuracy: arr.filter((m) => m.tag === "inaccuracy").length,
      mistake: arr.filter((m) => m.tag === "mistake").length,
      blunder: arr.filter((m) => m.tag === "blunder").length,
    };

    return {
      accuracy: Math.round(avgAccuracy * 10) / 10,
      acpl: Math.round(avgCpLoss),
      counts,
    };
  };

  return {
    headers,
    startFen,
    perMove,
    white: calcStats(sides.w),
    black: calcStats(sides.b),
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
  if (!container) return;

  const order = [
    ["brilliant", "💎"],
    ["great", "!"],
    ["best", "★"],
    ["excellent", "✓"],
    ["good", "○"],
    ["book", "📖"],
    ["inaccuracy", "?!"],
    ["mistake", "?"],
    ["blunder", "??"],
  ];

  container.innerHTML = order
    .filter(([key]) => counts[key] > 0)
    .map(
      ([key, icon]) => `
      <div class="move-badge" data-type="${key}">
        <span class="icon">${icon}</span>
        <span>${counts[key]}</span>
      </div>
    `
    )
    .join("");
}

function renderSummary(analysis) {
  const h = analysis.headers;

  // Player names
  if (wNameEl) wNameEl.textContent = h.White || "White";
  if (bNameEl) bNameEl.textContent = h.Black || "Black";
  if (wRatingEl) wRatingEl.textContent = h.WhiteElo || "—";
  if (bRatingEl) bRatingEl.textContent = h.BlackElo || "—";

  // Accuracy
  if (wAccuracyEl) {
    wAccuracyEl.textContent = `${analysis.white.accuracy}%`;
    wAccuracyEl.className = `accuracy-value ${getAccuracyClass(
      analysis.white.accuracy
    )}`;
  }
  if (bAccuracyEl) {
    bAccuracyEl.textContent = `${analysis.black.accuracy}%`;
    bAccuracyEl.className = `accuracy-value ${getAccuracyClass(
      analysis.black.accuracy
    )}`;
  }

  // ACPL
  if (wAcplEl) wAcplEl.textContent = analysis.white.acpl;
  if (bAcplEl) bAcplEl.textContent = analysis.black.acpl;

  // Badges
  renderBadges(wBadgesEl, analysis.white.counts);
  renderBadges(bBadgesEl, analysis.black.counts);

  // Opening
  if (openingNameEl) {
    const opening =
      h.Opening || h.ECOUrl?.split("/").pop()?.replace(/-/g, " ") || "Unknown";
    openingNameEl.textContent = `Opening: ${opening}`;
  }

  // Render charts
  renderAdvantageChart(analysis.perMove);
  renderAccuracyChart(analysis.perMove);

  // Render moves list
  renderMovesList(analysis);

  // Enable board button
  if (btnBoard) btnBoard.disabled = false;

  setProgress("Analysis complete", 100);
  setTimeout(() => setProgress("Ready", 0), 2000);
}

/* ============================================================
   CHARTS
   ============================================================ */

function renderAdvantageChart(perMove) {
  if (!advCanvas) return;
  const ctx = advCanvas.getContext("2d");
  const w = advCanvas.width;
  const h = advCanvas.height;

  ctx.clearRect(0, 0, w, h);

  if (!perMove.length) return;

  // Background
  ctx.fillStyle = "#272522";
  ctx.fillRect(0, 0, w, h);

  // Center line (0 eval)
  const centerY = h / 2;
  ctx.strokeStyle = "#4a4745";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(w, centerY);
  ctx.stroke();

  // Build points
  const points = [];
  const maxEval = 500; // Clamp display at ±5 pawns

  for (let i = 0; i < perMove.length; i++) {
    const m = perMove[i];
    let cp = 0;
    if (m.evalBefore) {
      if (m.evalBefore.type === "cp") {
        cp = m.evalBefore.value;
      } else if (m.evalBefore.type === "mate") {
        cp = m.evalBefore.value > 0 ? 1000 : -1000;
      }
    }
    points.push(Math.max(-maxEval, Math.min(maxEval, cp)));
  }

  // Add final position
  const lastMove = perMove[perMove.length - 1];
  if (lastMove?.evalAfter) {
    let cp = 0;
    if (lastMove.evalAfter.type === "cp") {
      cp = -lastMove.evalAfter.value;
    } else if (lastMove.evalAfter.type === "mate") {
      cp = lastMove.evalAfter.value > 0 ? -1000 : 1000;
    }
    points.push(Math.max(-maxEval, Math.min(maxEval, cp)));
  }

  if (points.length < 2) return;

  const padding = 10;
  const graphW = w - padding * 2;
  const graphH = h - padding * 2;

  // Draw filled area
  ctx.beginPath();
  ctx.moveTo(padding, centerY);

  for (let i = 0; i < points.length; i++) {
    const x = padding + (i / (points.length - 1)) * graphW;
    const y = centerY - (points[i] / maxEval) * (graphH / 2);
    if (i === 0) {
      ctx.lineTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.lineTo(padding + graphW, centerY);
  ctx.closePath();

  // Gradient fill
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.8)");
  gradient.addColorStop(0.5, "rgba(128, 128, 128, 0.3)");
  gradient.addColorStop(1, "rgba(64, 61, 57, 0.8)");
  ctx.fillStyle = gradient;
  ctx.fill();

  // Draw line
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const x = padding + (i / (points.length - 1)) * graphW;
    const y = centerY - (points[i] / maxEval) * (graphH / 2);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.strokeStyle = "#81b64c";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function renderAccuracyChart(perMove) {
  if (!accCanvas) return;
  const ctx = accCanvas.getContext("2d");
  const w = accCanvas.width;
  const h = accCanvas.height;

  ctx.clearRect(0, 0, w, h);

  if (!perMove.length) return;

  ctx.fillStyle = "#272522";
  ctx.fillRect(0, 0, w, h);

  const padding = 10;
  const barWidth = Math.max(2, (w - padding * 2) / perMove.length - 1);

  for (let i = 0; i < perMove.length; i++) {
    const m = perMove[i];
    const x = padding + i * (barWidth + 1);
    const barH = (m.accuracy / 100) * (h - padding * 2);
    const y = h - padding - barH;

    // Color based on move type
    ctx.fillStyle = TAG_COLORS[m.tag] || "#97af8b";
    ctx.fillRect(x, y, barWidth, barH);
  }
}

/* ============================================================
   MOVES LIST
   ============================================================ */

function renderMovesList(analysis) {
  if (!movesList) return;

  const h = analysis.headers;
  if (movesTitle) {
    movesTitle.textContent = `${h.White || "White"} vs ${h.Black || "Black"}`;
  }
  if (movesSubtitle) {
    movesSubtitle.textContent = `${h.Event || "Game"} • ${h.Result || "*"}`;
  }

  movesList.innerHTML = "";

  const perMove = analysis.perMove;
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

    // Flash animation for mistakes/blunders
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

  // Add click handlers
  movesList.querySelectorAll(".move-san").forEach((el) => {
    el.addEventListener("click", () => {
      const ply = parseInt(el.dataset.ply, 10);
      switchToBoard(ply);
    });
  });
}

function formatEval(info) {
  if (!info) return "";
  if (info.type === "mate") {
    return `M${Math.abs(info.value)}`;
  }
  const pawns = (info.value / 100).toFixed(1);
  return info.value >= 0 ? `+${pawns}` : pawns;
}

/* ============================================================
   BOARD RENDERING
   ============================================================ */

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
        resolve();
      };
      img.onerror = () => resolve();
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

function setupBoardCanvas() {
  const dpr = window.devicePixelRatio || 1;
  boardCanvas.style.width = `${BOARD_SIZE}px`;
  boardCanvas.style.height = `${BOARD_SIZE}px`;
  boardCanvas.width = BOARD_SIZE * dpr;
  boardCanvas.height = BOARD_SIZE * dpr;
  ctx = boardCanvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function sqToXY(sq) {
  const file = "abcdefgh".indexOf(sq[0]);
  const rank = parseInt(sq[1], 10) - 1;
  const fx = flipped ? 7 - file : file;
  const fy = flipped ? rank : 7 - rank;
  return { x: fx * SQ_SIZE, y: fy * SQ_SIZE };
}

function drawBoard() {
  ctx.clearRect(0, 0, BOARD_SIZE, BOARD_SIZE);

  // Draw squares
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const isLight = (r + f) % 2 === 0;
      ctx.fillStyle = isLight ? COLORS.light : COLORS.dark;

      const drawF = flipped ? 7 - f : f;
      const drawR = flipped ? r : 7 - r;
      ctx.fillRect(drawF * SQ_SIZE, drawR * SQ_SIZE, SQ_SIZE, SQ_SIZE);
    }
  }

  // Draw coordinates
  renderCoords();
}

function renderCoords() {
  if (!boardCoords) return;
  boardCoords.innerHTML = "";

  const files = flipped ? "hgfedcba" : "abcdefgh";
  const ranks = flipped ? "12345678" : "87654321";

  for (let i = 0; i < 8; i++) {
    // File labels (bottom)
    const fileEl = document.createElement("div");
    fileEl.className = `board-coord file ${i % 2 === 0 ? "dark" : "light"}`;
    fileEl.style.left = `${i * SQ_SIZE + SQ_SIZE - 8}px`;
    fileEl.style.bottom = "2px";
    fileEl.textContent = files[i];
    boardCoords.appendChild(fileEl);

    // Rank labels (right)
    const rankEl = document.createElement("div");
    rankEl.className = `board-coord rank ${i % 2 === 0 ? "light" : "dark"}`;
    rankEl.style.right = "4px";
    rankEl.style.top = `${i * SQ_SIZE + 2}px`;
    rankEl.textContent = ranks[i];
    boardCoords.appendChild(rankEl);
  }
}

function drawPieces(game) {
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
          SQ_SIZE - padding * 2
        );
      } else {
        // Fallback circle
        ctx.fillStyle = piece.color === "w" ? "#fff" : "#000";
        ctx.beginPath();
        ctx.arc(
          x + SQ_SIZE / 2,
          y + SQ_SIZE / 2,
          SQ_SIZE * 0.35,
          0,
          Math.PI * 2
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
  ctx.fillStyle = color;
  for (const sq of squares) {
    const { x, y } = sqToXY(sq);
    ctx.fillRect(x, y, SQ_SIZE, SQ_SIZE);
  }
}

function drawArrow(from, to, color) {
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

  // Line
  ctx.beginPath();
  ctx.moveTo(x1 + ux * SQ_SIZE * 0.2, y1 + uy * SQ_SIZE * 0.2);
  ctx.lineTo(x2 - ux * headLen, y2 - uy * headLen);
  ctx.stroke();

  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - ux * headLen - uy * headWidth,
    y2 - uy * headLen + ux * headWidth
  );
  ctx.lineTo(
    x2 - ux * headLen + uy * headWidth,
    y2 - uy * headLen - ux * headWidth
  );
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function updateEvalBar(info) {
  if (!evalBarWhite) return;

  let winPercent = 50;
  if (info) {
    winPercent = evalToWinPercent(info);
  }

  // Clamp for display
  winPercent = Math.max(1, Math.min(99, winPercent));

  evalBarWhite.style.height = `${winPercent}%`;

  // Update labels
  let evalText = "0.0";
  if (info) {
    if (info.type === "mate") {
      evalText = `M${Math.abs(info.value)}`;
    } else {
      evalText = (Math.abs(info.value) / 100).toFixed(1);
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

function gotoPly(ply) {
  if (!boardAnalysis) return;

  const perMove = boardAnalysis.perMove;
  currentPly = Math.max(0, Math.min(ply, perMove.length));

  // Rebuild position
  const game = new Chess(boardAnalysis.startFen);
  for (let i = 0; i < currentPly; i++) {
    try {
      game.move(perMove[i].san, { sloppy: true });
    } catch (e) {}
  }
  boardGame = game;

  // Clear overlay
  if (boardOverlay) boardOverlay.innerHTML = "";

  // Draw board
  drawBoard();

  // Highlight last move
  if (currentPly > 0) {
    const lastMove = perMove[currentPly - 1];
    if (lastMove.from && lastMove.to) {
      highlightSquares([lastMove.from, lastMove.to], COLORS.highlightLast);
    }
  }

  // Redraw board and pieces
  drawBoard();
  if (currentPly > 0) {
    const lastMove = perMove[currentPly - 1];
    if (lastMove.from && lastMove.to) {
      highlightSquares([lastMove.from, lastMove.to], COLORS.highlightLast);
    }
  }
  drawPieces(game);

  // Draw best move arrow
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

  // Update eval bar
  if (currentPly > 0) {
    const node = perMove[currentPly - 1];
    updateEvalBar(node.evalBefore);
  } else {
    updateEvalBar(null);
  }

  // Update ply display
  if (plyDisplay) {
    plyDisplay.textContent = `${currentPly}/${perMove.length}`;
  }

  // Update position info
  if (posFen) {
    posFen.textContent = game.fen();
  }

  // Update best move display
  if (currentPly > 0) {
    const node = perMove[currentPly - 1];
    const pvData = node.pvLines?.[selectedPV];

    if (bestMoveSan && pvData?.pv?.[0]) {
      const sanMove = uciToSan(node.fenBefore, pvData.pv[0]);
      bestMoveSan.textContent = sanMove || pvData.pv[0];
    } else if (bestMoveSan) {
      bestMoveSan.textContent = "—";
    }

    if (pvLine && pvData?.pv) {
      const sanList = pvToSanList(node.fenBefore, pvData.pv);
      pvLine.textContent = `PV: ${sanList.join(" ")}`;
    } else if (pvLine) {
      pvLine.textContent = "PV: —";
    }

    if (evalDisplay && pvData) {
      const evalStr = formatEval(pvData);
      evalDisplay.textContent = evalStr;
      evalDisplay.className = `eval-display ${
        pvData.value >= 0 ? "positive" : "negative"
      }`;
    } else if (evalDisplay) {
      evalDisplay.textContent = "—";
    }
  } else {
    if (bestMoveSan) bestMoveSan.textContent = "—";
    if (pvLine) pvLine.textContent = "PV: —";
    if (evalDisplay) evalDisplay.textContent = "—";
  }

  // Update move badge
  if (moveBadgeOverlay && currentPly > 0) {
    const node = perMove[currentPly - 1];
    moveBadgeOverlay.textContent = node.tag.toUpperCase();
    moveBadgeOverlay.style.background = TAG_COLORS[node.tag] || "#666";
    moveBadgeOverlay.style.display = "block";
  } else if (moveBadgeOverlay) {
    moveBadgeOverlay.style.display = "none";
  }

  // Update mini moves
  renderMiniMoves();
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

  const perMove = boardAnalysis.perMove;
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

  // Add click handlers
  miniMoves.querySelectorAll(".mini-move-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      gotoPly(parseInt(btn.dataset.ply, 10));
    });
  });
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

  // Switch to board tab
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
      p.setAttribute("aria-hidden", !isActive);
    });

    // Initialize board when switching to board tab
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
      initEngine();
      setProgress("Starting engine...", 0);

      const ready = await waitEngineReady();
      if (!ready) {
        setProgress("Engine failed to start", 0);
        return;
      }

      const opts = {
        depth: parseInt(depthEl?.value || "20", 10),
        movetime: parseInt(msEl?.value || "100", 10),
        multipv: parseInt(mpvEl?.value || "3", 10),
      };

      const analysis = await runAnalysis(pgn, opts);
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
if (btnLast)
  btnLast.addEventListener("click", () =>
    gotoPly(boardAnalysis?.perMove?.length || 0)
  );

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
    flipped = flipBoard.checked;
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
    if (idx !== -1) {
      gotoPly(idx + 1);
    }
  });
});

// Keyboard navigation
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
        flipped = flipBoard.checked;
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
    username
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
      // Try next username
    }
  }

  throw new Error("Game not found in archives");
}

/* ============================================================
   INITIALIZATION
   ============================================================ */

// Initialize engine on load
initEngine();

// Cleanup on unload
window.addEventListener("unload", shutdownEngine);

// Set initial status
setProgress("Ready", 0);
