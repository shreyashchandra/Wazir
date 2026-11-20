// Node adapter that runs the npm Stockfish 19 build behind the EngineLike interface.
import { createRequire } from "node:module";
import { parseInfo, type PvLine, type SearchOptions } from "../src/lib/engine";
import type { EngineLike } from "../src/lib/analyze";

const require = createRequire(import.meta.url);

export async function createNodeEngine(flavor = "single"): Promise<EngineLike & { quit(): void }> {
  const listeners = new Set<(l: string) => void>();
  const sf = await new Promise<{ processCommand(c: string): void; terminate?: () => void }>((resolve) => {
    const e = require("stockfish")(flavor, (line: string) => listeners.forEach((l) => l(line)));
    resolve(e);
  });
  const waitFor = (tok: string) =>
    new Promise<void>((res) => {
      const l = (line: string) => {
        if (line.startsWith(tok)) {
          listeners.delete(l);
          res();
        }
      };
      listeners.add(l);
    });
  const send = (c: string) => sf.processCommand(c);
  let p = waitFor("uciok");
  send("uci");
  await p;
  send("setoption name Hash value 128");
  if (process.env.THREADS) send(`setoption name Threads value ${process.env.THREADS}`);
  p = waitFor("readyok");
  send("isready");
  await p;
  let multipv = 1;
  let chain: Promise<unknown> = Promise.resolve();
  return {
    info: { name: "node-sf19" },
    async newGame() {
      const r = waitFor("readyok");
      send("ucinewgame");
      send("isready");
      await r;
    },
    search(fen: string, opts: SearchOptions) {
      const promise = (chain = chain.then(async () => {
        if (opts.multipv !== multipv) {
          send(`setoption name MultiPV value ${opts.multipv}`);
          multipv = opts.multipv;
        }
        const lines = new Map<number, PvLine>();
        const done = new Promise<void>((res) => {
          const l = (line: string) => {
            if (line.startsWith("bestmove")) {
              listeners.delete(l);
              res();
            }
            const info = parseInfo(line);
            if (info) lines.set(info.multipv, info);
          };
          listeners.add(l);
        });
        send(`position fen ${fen}`);
        send(`go depth ${opts.depth}`);
        await done;
        const all = [...lines.values()].sort((a, b) => a.multipv - b.multipv);
        return all.filter((x) => x.multipv === 1 || x.depth >= all[0].depth - 1);
      })) as Promise<PvLine[]>;
      return { promise, cancel() {} };
    },
    quit() {
      send("quit");
      sf.terminate?.();
    },
  };
}
