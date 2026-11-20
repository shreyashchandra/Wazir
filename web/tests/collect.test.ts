// Collects per-move engine data for games chess.com has reviewed, to fit the
// accuracy model. Opt-in and slow:
//   COLLECT=1 OUT=/path/data.json GAMES=40 DEPTH=16 THREADS=8 FLAVOR=full npx vitest run tests/collect.test.ts
import { describe, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { analyzeGame, PRESETS, whiteWinFromWhiteScore } from "../src/lib/analyze";
import { createNodeEngine } from "./nodeEngine";

const UA = { headers: { "User-Agent": "Mozilla/5.0 (Wazir calibration)" } };
const getJson = async (u: string) => {
  const r = await fetch(u, UA);
  return r.ok ? r.json() : null;
};

describe.skipIf(process.env.COLLECT !== "1")("collect calibration data", () => {
  it(
    "collects",
    async () => {
      const target = Number(process.env.GAMES || 40);
      const cacheFile = process.env.OUT!.replace(/\.json$/, "") + ".picked.json";
      let picked: any[] = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : [];
      if (!picked.length) {
      const club = await getJson("https://api.chess.com/pub/club/chess-com-developer-community/members");
      const members: string[] = [...club.all_time, ...club.monthly, ...club.weekly].map((m: { username: string }) => m.username);
      const users = ["hikaru", ...Array.from({ length: 400 }, (_, i) => members[(i * 7919) % members.length])];
      const pickFrom = async (u: string) => {
        const found: any[] = [];
        const arch = await getJson(`https://api.chess.com/pub/player/${u}/games/archives`);
        for (const url of (arch?.archives?.slice(-2) ?? []).reverse()) {
          const month = await getJson(url);
          for (const g of month?.games ?? []) {
            if (g.accuracies && g.rules === "chess" && g.pgn && found.length < (u === "hikaru" ? 6 : 2)) found.push(g);
          }
          if (found.length) break;
        }
        return found;
      };
      for (let i = 0; i < users.length && picked.length < target; i += 8) {
        const batch = await Promise.all(users.slice(i, i + 8).map((u) => pickFrom(u).catch(() => [])));
        for (const g of batch.flat()) if (!picked.some((p) => p.uuid === g.uuid) && picked.length < target) picked.push(g);
      }
        writeFileSync(cacheFile, JSON.stringify(picked));
      }
      if (process.env.PICK_ONLY === "1") return;
      const shards = Number(process.env.SHARDS || 1), shard = Number(process.env.SHARD || 0);
      picked = picked.filter((_, i) => i % shards === shard);
      PRESETS.fast.depth = Number(process.env.DEPTH || 16);
      PRESETS.fast.multipv = 2;
      const engine = await createNodeEngine(process.env.FLAVOR || "single");
      const out: any[] = [];
      for (const g of picked) {
        try {
          const r = await analyzeGame(g.pgn, g.uuid, engine, "fast");
          out.push({
            uuid: g.uuid,
            tc: g.time_class,
            ratings: [g.white.rating, g.black.rating],
            cc: g.accuracies,
            ours: [r.white.accuracy, r.black.accuracy],
            start: whiteWinFromWhiteScore(r.startEval),
            moves: r.moves.map((m) => ({ c: m.color, b: +m.winBefore.toFixed(2), a: +m.winAfter.toFixed(2), w: +whiteWinFromWhiteScore(m.evalAfter).toFixed(2), cls: m.classification })),
          });
          writeFileSync(process.env.OUT!.replace(/\.json$/, `.${shard}.json`), JSON.stringify(out));
        } catch {
          /* skip broken game */
        }
      }
      engine.quit();
    },
    4 * 60 * 60 * 1000,
  );
});
