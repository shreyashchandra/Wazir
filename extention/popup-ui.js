// popup-ui.js — UI-only: tabs, graphs, animations
// requires popup.js (module) to load first and expose hooks on window.__wazir

const QS = (s) => document.querySelector(s);
const QSA = (s) => Array.from(document.querySelectorAll(s));

/* DOM */
const tabs = QSA("#tabs .tab");
const panels = QSA(".panel");
const barEl = QS("#bar");
const progressEl = QS("#progress");

const accCanvas = QS("#acc-graph");
const advCanvas = QS("#adv-graph");
const accCtx = accCanvas.getContext("2d");
const advCtx = advCanvas.getContext("2d");

const movesContainer = QS("#moves");
const titleEl = QS("#title");
const notesEl = QS("#notes");
const openingNameEl = QS("#opening-name");
const pgnEl = QS("#pgn");
const boardViewBtn = QS("#board-view");

/* TAB switching */
tabs.forEach((t) => {
  t.addEventListener("click", () => {
    const tab = t.dataset.tab;
    tabs.forEach((x) => x.classList.toggle("active", x === t));
    panels.forEach((p) =>
      p.classList.toggle("active", p.id === `panel-${tab}`)
    );
    // accessibility
    panels.forEach((p) =>
      p.setAttribute("aria-hidden", !p.classList.contains("active"))
    );
    tabs.forEach((x) =>
      x.setAttribute("aria-selected", x.classList.contains("active"))
    );
  });
});

/* small helpers for drawing graphs */
function clearCanvas(ctx, canvas) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}
function drawLine(ctx, canvas, points, opts = {}) {
  clearCanvas(ctx, canvas);
  const w = canvas.width;
  const h = canvas.height;
  if (!points || !points.length) return;
  const pad = 10;
  ctx.lineWidth = opts.lineWidth || 2;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const x = pad + ((w - pad * 2) * i) / (points.length - 1 || 1);
    const y =
      pad +
      (h - pad * 2) *
        (1 -
          (points[i] - (opts.min ?? Math.min(...points))) /
            ((opts.max ?? Math.max(...points)) -
              (opts.min ?? Math.min(...points)) || 1));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = opts.color || "#62d8a6";
  ctx.stroke();
}

/* event: whenever popup.js finishes renderSummary, it should dispatch 'wazir:summaryRendered' */
window.addEventListener("wazir:summaryRendered", (ev) => {
  const s = ev.detail;
  try {
    titleEl.textContent = [
      s.headers?.Event || "Game",
      s.headers?.White && s.headers?.Black
        ? `${s.headers.White} vs ${s.headers.Black}`
        : "",
      s.headers?.Result ? `(${s.headers.Result})` : "",
    ]
      .filter(Boolean)
      .join(" ");

    pgnEl.value =
      s.headers && s.headers.raw_pgn ? s.headers.raw_pgn : pgnEl.value;

    // opening detection
    let opening = "Unknown";
    try {
      const parse = window.__wazir?.parseHeadersFromPgn;
      if (parse) {
        const h = parse(s.headers?.raw_pgn || "");
        if (h?.Opening) opening = h.Opening;
        else if (h?.ECO) opening = `${h?.ECO || ""} ${h?.Opening || ""}`.trim();
      }
    } catch (e) {}

    openingNameEl.textContent = `Opening: ${opening}`;

    // build move list UI
    buildMoveList(s.perMove || []);

    // prepare graphs
    const accPoints =
      (s.perMove && s.perMove.length
        ? s.perMove.map((m) => Math.max(0, 100 - 0.22 * (m.cpLoss || 0)))
        : []) || [];

    const advPoints = [];
    if (s.perMove && s.perMove.length) {
      for (let i = 0; i < s.perMove.length; i++) {
        const node = s.perMove[i];
        const best =
          node && node.pvLines && node.pvLines[1] ? node.pvLines[1] : null;
        const cp = best
          ? best.type === "cp"
            ? best.value
            : best.value > 0
            ? 1000
            : -1000
          : 0;
        advPoints.push(cp);
      }
    }

    // Draw graphs if data available; clear otherwise
    if (accPoints.length) {
      drawLine(accCtx, accCanvas, accPoints, {
        color: "#62d8a6",
        min: 0,
        max: 100,
      });
    } else {
      clearCanvas(accCtx, accCanvas);
    }

    if (advPoints.length) {
      const advMax = Math.max(...advPoints.map(Math.abs), 100);
      drawLine(advCtx, advCanvas, advPoints, {
        color: "#45a3ff",
        min: -advMax,
        max: advMax,
      });
    } else {
      clearCanvas(advCtx, advCanvas);
    }

    animateMoveTags();

    // progress bar reset
    barEl.style.width = "100%";
    setTimeout(() => (barEl.style.width = "0%"), 700);
  } catch (err) {
    console.error("UI render error", err);
  }
});

/* Build moves list DOM */
function buildMoveList(perMove) {
  movesContainer.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (let i = 0; i < (perMove?.length || 0); i += 2) {
    const w = perMove[i];
    const b = perMove[i + 1];
    const idx = Math.floor(i / 2) + 1;
    const row = document.createElement("div");
    row.className = "move-row";
    row.innerHTML = `
      <div class="muted">${idx}.</div>
      <div>
        ${
          w
            ? `<div class="san">${w.san} <span class="tag ${
                w.tag
              }">${capitalizeTag(w.tag)}</span></div><div class="muted small">${
                w.cpLoss
              } cp</div>`
            : ""
        }
      </div>
      <div>
        ${
          b
            ? `<div class="san">${b.san} <span class="tag ${
                b.tag
              }">${capitalizeTag(b.tag)}</span></div><div class="muted small">${
                b.cpLoss
              } cp</div>`
            : ""
        }
      </div>
    `;
    frag.appendChild(row);

    // small flash on mistakes/blunders
    if (w && (w.tag === "mistake" || w.tag === "blunder")) {
      setTimeout(
        () =>
          row.classList.add(
            w.tag === "blunder" ? "flash-blunder" : "flash-mistake"
          ),
        60 + Math.random() * 220
      );
      setTimeout(
        () =>
          row.classList.remove(
            w.tag === "blunder" ? "flash-blunder" : "flash-mistake"
          ),
        1600
      );
    }
    if (b && (b.tag === "mistake" || b.tag === "blunder")) {
      setTimeout(
        () =>
          row.classList.add(
            b.tag === "blunder" ? "flash-blunder" : "flash-mistake"
          ),
        60 + Math.random() * 220
      );
      setTimeout(
        () =>
          row.classList.remove(
            b.tag === "blunder" ? "flash-blunder" : "flash-mistake"
          ),
        1600
      );
    }
  }
  movesContainer.appendChild(frag);
}

function capitalizeTag(t) {
  if (!t) return "";
  if (t === "inaccuracy") return "Inaccuracy";
  return t[0].toUpperCase() + t.slice(1);
}

function animateMoveTags() {
  QSA(".move-row").forEach((r, i) => {
    r.addEventListener(
      "mouseenter",
      () => (r.style.filter = "brightness(1.04)")
    );
    r.addEventListener("mouseleave", () => (r.style.filter = ""));
  });
}

/* Click handlers: provide a way to open board from UI */
if (boardViewBtn) {
  boardViewBtn.addEventListener("click", async () => {
    const t = tabs.find((x) => x.dataset.tab === "board");
    if (t) t.click();

    if (window.__wazir?.buildBoardFromSummary) {
      const last = window.__wazir.lastSummaryGetter();
      if (last) {
        window.__wazir.buildBoardFromSummary(last);
      }
    }
  });
}

/* expose small helper: render a quick status */
function setStatus(s) {
  if (progressEl) progressEl.textContent = s;
}
window.addEventListener("load", () => setStatus("Ready"));

window.__wazir_ui = {
  setStatus,
};
