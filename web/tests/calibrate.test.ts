// Compares Wazir's accuracy against chess.com's own published accuracies.
// Opt-in (slow, needs network):  CALIBRATE=1 GAMES=8 DEPTH=16 npx vitest run tests/calibrate.test.ts
import { describe, it } from "vitest";
import { appendFileSync } from "node:fs";
const log = (s: string) => (process.env.OUT ? appendFileSync(process.env.OUT, s + "\n") : console.log(s));
import { analyzeGame, PRESETS } from "../src/lib/analyze";
import { createNodeEngine } from "./nodeEngine";

const run = process.env.CALIBRATE === "1";

describe.skipIf(!run)("calibration vs chess.com accuracies", () => {
  it(
    "reports mean absolute error",
    async () => {
      const user = process.env.USER_CC || "hikaru";
      const month = process.env.MONTH || "2026/10";
      const res = await fetch(`https://api.chess.com/pub/player/${user}/games/${month}`, {
        headers: { "User-Agent": "Mozilla/5.0 (Wazir calibration)" },
      });
      const { games } = await res.json();
      const sample = games.filter((g: any) => g.accuracies && g.rules === "chess" && g.time_class !== "bullet").slice(0, Number(process.env.GAMES || 6));
      PRESETS.fast.depth = Number(process.env.DEPTH || 16);
      PRESETS.fast.multipv = 2;
      const engine = await createNodeEngine(process.env.FLAVOR || "single");
      const errs: number[] = [];
      for (const g of sample) {
        const r = await analyzeGame(g.pgn, g.uuid, engine, "fast");
        const w = r.white.accuracy!, b = r.black.accuracy!;
        errs.push(Math.abs(w - g.accuracies.white), Math.abs(b - g.accuracies.black));
        log(
          `${g.white.username} vs ${g.black.username} (${g.time_class}) chess.com W ${g.accuracies.white.toFixed(1)} B ${g.accuracies.black.toFixed(1)} | wazir W ${w.toFixed(1)} B ${b.toFixed(1)}`,
        );
      }
      engine.quit();
      log(`MAE over ${errs.length} sides: ${(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(2)}`);
    },
    60 * 60 * 1000,
  );
});
