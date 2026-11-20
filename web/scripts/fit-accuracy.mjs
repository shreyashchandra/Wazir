// Fits the accuracy-model constants (ACC_MODEL in src/lib/accuracy.ts) to chess.com's
// published accuracies. Input: per-move files written by tests/collect.test.ts.
// Usage: node scripts/fit-accuracy.mjs /tmp/calib.0.json /tmp/calib.1.json ...
import { readFileSync } from "node:fs";
const data = process.argv.slice(2).flatMap((f) => JSON.parse(readFileSync(f, "utf8"))).filter((g) => g.moves.length >= 10);
const S0 = 0.00368208;
const toCp = (w) => { const x = Math.max(-0.99999, Math.min(0.99999, (w - 50) / 50)); return Math.log((1 + x) / (1 - x)) / S0; };
const win = (cp, s) => 50 + 50 * (2 / (1 + Math.exp(-s * cp)) - 1);
// Precompute cp series.
for (const g of data) {
  g.cpB = g.moves.map((m) => toCp(m.b)); g.cpA = g.moves.map((m) => toCp(m.a)); g.cpW = [toCp(g.start), ...g.moves.map((m) => toCp(m.w))];
}
const std = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
function gameAcc(g, p) {
  const n = g.moves.length;
  const ww = g.cpW.map((c) => win(c, p.s));
  const ws = Math.max(2, Math.min(8, Math.floor(n / 10)));
  const wins = []; const head = ww.slice(0, ws);
  for (let i = 0; i < Math.min(ws - 2, n); i++) wins.push(head);
  for (let i = 0; i + ws <= ww.length && wins.length < n; i++) wins.push(ww.slice(i, i + ws));
  while (wins.length < n) wins.push(wins[wins.length - 1]);
  const wt = wins.map((w) => Math.max(0.5, Math.min(12, std(w))));
  const res = {};
  for (const c of ["w", "b"]) {
    let sw = 0, sa = 0, inv = 0, k = 0;
    for (let i = 0; i < n; i++) {
      if (g.moves[i].c !== c) continue;
      const d = Math.max(0, win(g.cpB[i], p.s) - win(g.cpA[i], p.s));
      const a = d <= 0 ? 100 : Math.max(0, Math.min(100, 103.1668 * Math.exp(-p.k * d) - 3.1669 + p.bonus));
      sw += wt[i]; sa += a * wt[i]; inv += 1 / Math.max(a, p.f); k++;
    }
    res[c] = k ? p.l * (sa / sw) + (1 - p.l) * (k / inv) : null;
  }
  return res;
}
function mae(set, p) {
  let e = 0, n = 0;
  for (const g of set) { const r = gameAcc(g, p); if (r.w !== null) { e += Math.abs(r.w - g.cc.white); n++; } if (r.b !== null) { e += Math.abs(r.b - g.cc.black); n++; } }
  return e / n;
}
function bias(set, p) { let e = 0, n = 0; for (const g of set) { const r = gameAcc(g, p); e += r.w - g.cc.white + r.b - g.cc.black; n += 2; } return e / n; }
function fit(set) {
  let best = null;
  for (const s of [0.0012, 0.0016, 0.002, 0.0025, 0.003, 0.00368208])
    for (const k of [0.04354, 0.06, 0.075, 0.09, 0.11, 0.13])
      for (const bonus of [-3, -1, 0, 1])
        for (const l of [0, 0.25, 0.5])
         for (const f of [10, 15, 20, 25, 30]) {
          const p = { s, k, bonus, l, f }; const m = mae(set, p);
          if (!best || m < best.m) best = { p, m };
        }
  // local refine
  let { p } = best; let step = { s: 0.0004, k: 0.006, bonus: 0.5, l: 0.1, f: 4 };
  for (let it = 0; it < 6; it++) {
    for (const key of Object.keys(step)) for (const dir of [-1, 1]) {
      const q = { ...p, [key]: p[key] + dir * step[key] }; if (q.l < 0 || q.l > 1 || q.k <= 0 || q.s <= 0) continue;
      const m = mae(set, q); if (m < best.m) { best = { p: q, m }; p = q; }
    }
    for (const key of Object.keys(step)) step[key] /= 2;
  }
  return best;
}
const base = { s: S0, k: 0.04354, bonus: 1, l: 0.5, f: 1 };
console.log(`games=${data.length} sides=${data.length * 2}`);
console.log(`current model: MAE ${mae(data, base).toFixed(2)} bias ${bias(data, base).toFixed(2)}`);
// 4-fold CV
const folds = 4; let cv = 0;
for (let f = 0; f < folds; f++) {
  const train = data.filter((_, i) => i % folds !== f), test = data.filter((_, i) => i % folds === f);
  const b = fit(train); cv += mae(test, b.p) / folds;
}
const all = fit(data);
console.log(`fitted on all: MAE ${all.m.toFixed(2)} bias ${bias(data, all.p).toFixed(2)} params ${JSON.stringify(all.p)}`);
console.log(`4-fold CV MAE (held-out): ${cv.toFixed(2)}`);
