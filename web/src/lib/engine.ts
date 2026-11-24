// Stockfish 19 (WASM) wrapper: one Web Worker, UCI over postMessage, a FIFO
// search queue, MultiPV parsing and cancellation.

export type EngineFlavor = "full" | "lite";
export type Score = { type: "cp" | "mate"; value: number };

export interface PvLine {
  multipv: number;
  depth: number;
  seldepth?: number;
  /** Score from the side-to-move's point of view (raw UCI). */
  score: Score;
  pv: string[];
  nodes?: number;
  nps?: number;
}

export interface SearchOptions {
  depth: number;
  multipv: number;
  /** Hard time cap per position in ms (search stops at depth OR time, whichever first). */
  movetime?: number;
}

export interface EngineInfo {
  name: string;
  flavor: EngineFlavor;
  threads: number;
  hashMb: number;
  multiThreaded: boolean;
}

export interface SearchHandle {
  promise: Promise<PvLine[]>;
  cancel: () => void;
}

// import.meta.env is undefined in the extension bundle, hence the optional chaining.
const WASM_BASE = (import.meta.env?.VITE_ENGINE_WASM_BASE as string | undefined)?.trim() || "";

export function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function defaultFlavor(): EngineFlavor {
  try {
    const saved = localStorage.getItem("wazir:engine");
    if (saved === "full" || saved === "lite") return saved;
  } catch {
    /* ignore */
  }
  return isMobileDevice() ? "lite" : "full";
}

export function saveFlavor(f: EngineFlavor) {
  try {
    localStorage.setItem("wazir:engine", f);
  } catch {
    /* ignore */
  }
}

export function parseInfo(line: string): PvLine | null {
  if (!line.startsWith("info ") || !line.includes(" pv ") || !line.includes(" score ")) return null;
  if (line.includes(" lowerbound") || line.includes(" upperbound")) return null;
  const tok = line.split(" ");
  const out: PvLine = { multipv: 1, depth: 0, score: { type: "cp", value: 0 }, pv: [] };
  for (let i = 1; i < tok.length; i++) {
    switch (tok[i]) {
      case "depth":
        out.depth = Number(tok[++i]);
        break;
      case "seldepth":
        out.seldepth = Number(tok[++i]);
        break;
      case "multipv":
        out.multipv = Number(tok[++i]);
        break;
      case "nodes":
        out.nodes = Number(tok[++i]);
        break;
      case "nps":
        out.nps = Number(tok[++i]);
        break;
      case "score":
        out.score = { type: tok[++i] === "mate" ? "mate" : "cp", value: Number(tok[++i]) };
        break;
      case "pv":
        out.pv = tok.slice(i + 1);
        i = tok.length;
        break;
    }
  }
  return out.pv.length ? out : null;
}

type Job = {
  fen: string;
  opts: SearchOptions;
  onUpdate?: (lines: PvLine[]) => void;
  resolve: (l: PvLine[]) => void;
  reject: (e: unknown) => void;
  cancelled: boolean;
};

export class StockfishEngine {
  private worker: Worker;
  private listeners = new Set<(line: string) => void>();
  private queue: Job[] = [];
  private running: Job | null = null;
  private currentMultiPv = 1;
  info: EngineInfo;

  private constructor(worker: Worker, info: EngineInfo) {
    this.worker = worker;
    this.info = info;
    worker.onmessage = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      for (const l of this.listeners) l(e.data);
    };
  }

  /**
   * Boots the worker. The multi-threaded build is used when the page is
   * cross-origin isolated (SharedArrayBuffer available), else the single-threaded one.
   */
  static async create(
    flavor: EngineFlavor,
    onDownload?: (fraction: number) => void,
    /** Where the engine .js/.wasm files live (the extension passes chrome.runtime.getURL("stockfish/")). */
    location_: { scriptBase?: string; wasmBase?: string } = {},
  ): Promise<StockfishEngine> {
    const multiThreaded = typeof SharedArrayBuffer !== "undefined" && self.crossOriginIsolated === true;
    const base = flavor === "full" ? "stockfish-19" : "stockfish-19-lite";
    const file = multiThreaded ? base : `${base}-single`;
    const scriptBase = location_.scriptBase ?? "/engine/";
    const wasmBase = location_.wasmBase ?? (WASM_BASE || new URL(scriptBase, location.href).href);
    const wasmUrl = wasmBase + `${file}.wasm`;
    const worker = new Worker(`${scriptBase}${file}.js#${encodeURIComponent(wasmUrl)}`);

    const cores = navigator.hardwareConcurrency || 4;
    const threads = multiThreaded ? Math.max(1, Math.min(cores - 1, 32)) : 1;
    const deviceMem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const hashMb = flavor === "lite" || deviceMem < 4 ? 64 : deviceMem >= 8 ? 512 : 256;

    const engine = new StockfishEngine(worker, {
      name: flavor === "full" ? "Stockfish 19 NNUE" : "Stockfish 19 Lite",
      flavor,
      threads,
      hashMb,
      multiThreaded,
    });

    worker.addEventListener("message", (e: MessageEvent) => {
      if (e.data && typeof e.data === "object" && typeof e.data.percent === "number") onDownload?.(e.data.percent);
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Engine took too long to start")), 180_000);
      worker.onerror = (err) => {
        clearTimeout(timer);
        reject(new Error(`Engine failed to load: ${err.message || "worker error"}`));
      };
      engine.waitFor("uciok").then(() => {
        clearTimeout(timer);
        resolve();
      });
      engine.send("uci");
    });

    engine.send(`setoption name Threads value ${threads}`);
    engine.send(`setoption name Hash value ${hashMb}`);
    engine.send("setoption name MultiPV value 1");
    await engine.ready();
    onDownload?.(1);
    return engine;
  }

  send(cmd: string) {
    this.worker.postMessage(cmd);
  }

  private waitFor(token: string): Promise<string> {
    return new Promise((resolve) => {
      const l = (line: string) => {
        if (line.startsWith(token)) {
          this.listeners.delete(l);
          resolve(line);
        }
      };
      this.listeners.add(l);
    });
  }

  private async ready() {
    const p = this.waitFor("readyok");
    this.send("isready");
    await p;
  }

  /** Clears the hash table; call between unrelated games. */
  async newGame() {
    await this.stopAll();
    this.send("ucinewgame");
    await this.ready();
  }

  search(fen: string, opts: SearchOptions, onUpdate?: (lines: PvLine[]) => void): SearchHandle {
    let job!: Job;
    const promise = new Promise<PvLine[]>((resolve, reject) => {
      job = { fen, opts, onUpdate, resolve, reject, cancelled: false };
    });
    this.queue.push(job);
    this.pump();
    return {
      promise,
      cancel: () => {
        job.cancelled = true;
        if (this.running === job) this.send("stop");
      },
    };
  }

  /** Cancels everything queued and stops the running search. */
  async stopAll() {
    for (const j of this.queue) {
      j.cancelled = true;
      j.resolve([]);
    }
    this.queue = [];
    if (this.running) {
      const p = this.waitFor("bestmove");
      this.send("stop");
      await p;
    }
  }

  private async pump() {
    if (this.running) return;
    const job = this.queue.shift();
    if (!job) return;
    if (job.cancelled) {
      job.resolve([]);
      this.pump();
      return;
    }
    this.running = job;
    try {
      job.resolve(await this.run(job));
    } catch (e) {
      job.reject(e);
    } finally {
      this.running = null;
      this.pump();
    }
  }

  private async run(job: Job): Promise<PvLine[]> {
    const { fen, opts } = job;
    if (opts.multipv !== this.currentMultiPv) {
      this.send(`setoption name MultiPV value ${opts.multipv}`);
      this.currentMultiPv = opts.multipv;
      await this.ready();
    }
    const lines = new Map<number, PvLine>();
    let lastEmit = 0;
    const done = new Promise<void>((resolve) => {
      const l = (line: string) => {
        if (line.startsWith("bestmove")) {
          this.listeners.delete(l);
          resolve();
          return;
        }
        const info = parseInfo(line);
        if (!info) return;
        lines.set(info.multipv, info);
        if (job.onUpdate && info.multipv === 1 && performance.now() - lastEmit > 120) {
          lastEmit = performance.now();
          job.onUpdate(sorted());
        }
      };
      this.listeners.add(l);
    });
    const sorted = () => {
      const all = [...lines.values()].sort((a, b) => a.multipv - b.multipv);
      const top = all[0]?.depth ?? 0;
      // Drop stale secondary lines left over from shallower iterations.
      return all.filter((x) => x.multipv === 1 || x.depth >= top - 1);
    };
    this.send(`position fen ${fen}`);
    this.send(`go depth ${opts.depth}${opts.movetime ? ` movetime ${opts.movetime}` : ""}`);
    await done;
    const result = sorted();
    job.onUpdate?.(result);
    return result;
  }

  terminate() {
    this.worker.terminate();
    this.listeners.clear();
  }
}

// --- Shared singleton so every page reuses one warm engine -----------------

let shared: Promise<StockfishEngine> | null = null;
let sharedFlavor: EngineFlavor | null = null;
const downloadListeners = new Set<(f: number) => void>();

export function getEngine(flavor: EngineFlavor = defaultFlavor()): Promise<StockfishEngine> {
  if (shared && sharedFlavor === flavor) return shared;
  if (shared) shared.then((e) => e.terminate()).catch(() => {});
  sharedFlavor = flavor;
  shared = StockfishEngine.create(flavor, (f) => downloadListeners.forEach((l) => l(f)));
  shared.catch(() => {
    shared = null;
    sharedFlavor = null;
  });
  return shared;
}

export function onEngineDownload(l: (f: number) => void) {
  downloadListeners.add(l);
  return () => downloadListeners.delete(l);
}
