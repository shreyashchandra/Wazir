// Wrapped soundtrack: original music generated live with the Web Audio API
// (drums, bass, pads, arpeggios and an algorithmic melody), so there is nothing
// to license. You can also add your own licensed tracks: put MP3s in
// public/music/ and list them in public/music/tracks.json as
//   [{ "id": "my-song", "title": "My Song", "artist": "Someone", "src": "/music/my-song.mp3" }]

export interface SynthTrack {
  kind: "synth";
  id: string;
  title: string;
  mood: string;
  bpm: number;
  swing: number; // 0..0.3 delays every second 16th
  chords: number[][]; // MIDI notes, one chord per bar
  kick: string; // 16 steps, x = hit
  snare: string;
  hat: string;
  arp: "up" | "updown" | "off";
  arpRate: 8 | 16;
  lead: boolean;
  leadWave: OscillatorType;
  padCutoff: number;
  crackle?: boolean;
  seed: number;
}

export interface FileTrack {
  kind: "file";
  id: string;
  title: string;
  mood: string;
  src: string;
}

export type Track = SynthTrack | FileTrack;

const n = (name: string) => {
  const m = name.match(/^([A-G])(#|b)?(\d)$/)!;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as "C"]!;
  return 12 * (Number(m[3]) + 1) + base + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
};
const chord = (...names: string[]) => names.map(n);

export const SYNTH_TRACKS: SynthTrack[] = [
  {
    kind: "synth",
    id: "opening-theory",
    title: "Opening Theory",
    mood: "Bright synthwave",
    bpm: 112,
    swing: 0,
    chords: [chord("A3", "C4", "E4"), chord("F3", "A3", "C4"), chord("C4", "E4", "G4"), chord("G3", "B3", "D4")],
    kick: "x...x...x...x...",
    snare: "....x.......x...",
    hat: "..x...x...x...x.",
    arp: "up",
    arpRate: 16,
    lead: true,
    leadWave: "square",
    padCutoff: 1600,
    seed: 7,
  },
  {
    kind: "synth",
    id: "midnight-blitz",
    title: "Midnight Blitz",
    mood: "Late-night lo-fi",
    bpm: 78,
    swing: 0.18,
    chords: [chord("D3", "F3", "A3", "C4", "E4"), chord("G3", "B3", "D4", "F4"), chord("C3", "E3", "G3", "B3", "D4"), chord("A2", "C3", "E3", "G3")],
    kick: "x......x..x.....",
    snare: "....x.......x...",
    hat: "x.x.x.x.x.x.x.x.",
    arp: "off",
    arpRate: 8,
    lead: true,
    leadWave: "triangle",
    padCutoff: 900,
    crackle: true,
    seed: 21,
  },
  {
    kind: "synth",
    id: "bullet-time",
    title: "Bullet Time",
    mood: "Fast and furious",
    bpm: 150,
    swing: 0,
    chords: [chord("E3", "G3", "B3"), chord("C3", "E3", "G3"), chord("D3", "F#3", "A3"), chord("B2", "D#3", "F#3")],
    kick: "x.....x...x.....",
    snare: "....x.......x..x",
    hat: "xxxxxxxxxxxxxxxx",
    arp: "updown",
    arpRate: 16,
    lead: false,
    leadWave: "sawtooth",
    padCutoff: 2200,
    seed: 3,
  },
  {
    kind: "synth",
    id: "long-endgame",
    title: "The Long Endgame",
    mood: "Cinematic and calm",
    bpm: 70,
    swing: 0,
    chords: [chord("C3", "G3", "E4"), chord("A2", "E3", "C4"), chord("F2", "C3", "A3"), chord("G2", "D3", "B3")],
    kick: "x...............",
    snare: "................",
    hat: "................",
    arp: "up",
    arpRate: 8,
    lead: true,
    leadWave: "sine",
    padCutoff: 1100,
    seed: 11,
  },
  {
    kind: "synth",
    id: "victory-lap",
    title: "Victory Lap",
    mood: "Feel-good pop",
    bpm: 120,
    swing: 0,
    chords: [chord("C4", "E4", "G4"), chord("G3", "B3", "D4"), chord("A3", "C4", "E4"), chord("F3", "A3", "C4")],
    kick: "x...x...x...x...",
    snare: "....x.......x...",
    hat: "..x.x.x...x.x.xx",
    arp: "updown",
    arpRate: 8,
    lead: true,
    leadWave: "triangle",
    padCutoff: 2000,
    seed: 42,
  },
];

/** Persona title -> fitting soundtrack. */
export function trackForPersona(title: string): string {
  if (/Night Owl/.test(title)) return "midnight-blitz";
  if (/Speed Demon|Clock Assassin|Machine/.test(title)) return "bullet-time";
  if (/Correspondent|Diplomat|Resilient|Surgeon/.test(title)) return "long-endgame";
  if (/Climber|Unstoppable|Executioner/.test(title)) return "victory-lap";
  return "opening-theory";
}

export async function loadFileTracks(): Promise<FileTrack[]> {
  try {
    const res = await fetch("/music/tracks.json", { cache: "no-cache" });
    if (!res.ok) return [];
    const list = (await res.json()) as { id: string; title: string; artist?: string; src: string }[];
    return list
      .filter((t) => t.id && t.src)
      .map((t) => ({ kind: "file", id: t.id, title: t.title || t.id, mood: t.artist || "Your track", src: t.src }));
  } catch {
    return [];
  }
}

const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A 4-bar melody (8 eighths per bar) built from chord tones and pentatonic passing notes. */
function makeMelody(t: SynthTrack): (number | null)[][] {
  const r = rng(t.seed);
  const root = t.chords[0][0];
  const scale = [0, 2, 3, 5, 7, 8, 10].map((x) => x + root + 12);
  return t.chords.map((c) => {
    const tones = c.map((x) => x + 12 + (x + 12 < root + 12 ? 12 : 0));
    const bar: (number | null)[] = [];
    let last = tones[0];
    for (let i = 0; i < 8; i++) {
      const strong = i % 2 === 0;
      if (r() < (strong ? 0.2 : 0.45)) {
        bar.push(null);
        continue;
      }
      const pool = strong ? tones : scale.filter((s) => Math.abs(s - last) <= 4);
      last = pool[Math.floor(r() * pool.length)] ?? last;
      bar.push(last);
    }
    return bar;
  });
}

export class MusicPlayer {
  private ctx: AudioContext;
  private out: GainNode;
  private bus: GainNode;
  private delay: DelayNode;
  private reverb: ConvolverNode;
  private noiseBuf: AudioBuffer;
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private track: Track | null = null;
  private melody: (number | null)[][] = [];
  private audioEl: HTMLAudioElement | null = null;
  private crackleSrc: AudioBufferSourceNode | null = null;
  volume = 0.55;

  constructor() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.out = this.ctx.createGain();
    this.out.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.out.connect(comp).connect(this.ctx.destination);
    this.bus = this.ctx.createGain();
    this.bus.connect(this.out);

    // Space: a feedback delay and a generated reverb impulse.
    this.delay = this.ctx.createDelay(1.5);
    const fb = this.ctx.createGain();
    fb.gain.value = 0.32;
    const dlp = this.ctx.createBiquadFilter();
    dlp.type = "lowpass";
    dlp.frequency.value = 2500;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    const dOut = this.ctx.createGain();
    dOut.gain.value = 0.35;
    this.delay.connect(dOut).connect(this.out);

    this.reverb = this.ctx.createConvolver();
    const len = this.ctx.sampleRate * 2.4;
    const imp = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = imp.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
    }
    this.reverb.buffer = imp;
    const rOut = this.ctx.createGain();
    rOut.gain.value = 0.3;
    this.reverb.connect(rOut).connect(this.out);

    this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  get current() {
    return this.track;
  }

  setVolume(v: number) {
    this.volume = v;
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    if (this.audioEl) this.audioEl.volume = v;
  }

  async play(track: Track) {
    this.stop();
    this.track = track;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (track.kind === "file") {
      this.audioEl = new Audio(track.src);
      this.audioEl.loop = true;
      this.audioEl.volume = this.volume;
      await this.audioEl.play().catch(() => {});
      return;
    }
    this.melody = makeMelody(track);
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    // Gentle fade-in.
    this.out.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    this.out.gain.exponentialRampToValueAtTime(this.volume, this.ctx.currentTime + 1.5);
    if (track.crackle) this.startCrackle();
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.audioEl?.pause();
    this.audioEl = null;
    this.crackleSrc?.stop();
    this.crackleSrc = null;
    this.track = null;
  }

  dispose() {
    this.stop();
    this.ctx.close().catch(() => {});
  }

  private schedule() {
    const t = this.track;
    if (!t || t.kind !== "synth") return;
    const sixteenth = 60 / t.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      const s = this.step % 16;
      const bar = Math.floor(this.step / 16);
      const time = this.nextTime + (s % 2 === 1 ? t.swing * sixteenth : 0);
      this.playStep(t, s, bar, time, sixteenth);
      this.nextTime += sixteenth;
      this.step++;
    }
  }

  private playStep(t: SynthTrack, s: number, bar: number, time: number, sixteenth: number) {
    const ch = t.chords[bar % t.chords.length];
    const section = Math.floor(bar / 8) % 4; // simple arrangement: intro, build, full, breakdown
    const drumsOn = bar >= 2 && section !== 3;
    if (drumsOn && t.kick[s] === "x") this.kick(time);
    if (drumsOn && t.snare[s] === "x") this.snare(time);
    if (bar >= 1 && t.hat[s] === "x") this.hat(time, s % 4 === 2 ? 0.07 : 0.045);
    if (s === 0) this.pad(ch, time, sixteenth * 16, t.padCutoff);
    if (bar >= 1 && (s === 0 || s === 8 || (t.bpm < 100 && s === 10) || (t.bpm >= 100 && (s === 6 || s === 14)))) {
      this.bass(ch[0] - 12, time, sixteenth * (s === 0 ? 4 : 2));
    }
    if (t.arp !== "off" && section !== 0) {
      const every = t.arpRate === 16 ? 1 : 2;
      if (s % every === 0) {
        const idx = s / every;
        const tones = [...ch, ...ch.map((x) => x + 12)];
        const seq = t.arp === "up" ? tones : [...tones, ...tones.slice(1, -1).reverse()];
        this.pluck(seq[idx % seq.length] + 12, time, sixteenth * every * 0.9);
      }
    }
    if (t.lead && (section === 2 || section === 1) && s % 2 === 0) {
      const note = this.melody[bar % this.melody.length][s / 2];
      if (note) this.lead(note, time, sixteenth * 2 * 0.95, t.leadWave);
    }
  }

  private env(g: GainNode, time: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
  }

  private kick(time: number) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(150, time);
    o.frequency.exponentialRampToValueAtTime(42, time + 0.18);
    const g = this.ctx.createGain();
    this.env(g, time, 0.9, 0.003, 0.35);
    o.connect(g).connect(this.bus);
    o.start(time);
    o.stop(time + 0.4);
  }

  private noiseHit(time: number, type: BiquadFilterType, f: number, peak: number, decay: number, toReverb = false) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const flt = this.ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    const g = this.ctx.createGain();
    this.env(g, time, peak, 0.002, decay);
    src.connect(flt).connect(g).connect(this.bus);
    if (toReverb) g.connect(this.reverb);
    src.start(time, Math.random() * 0.5);
    src.stop(time + decay + 0.05);
  }

  private snare(time: number) {
    this.noiseHit(time, "highpass", 1400, 0.38, 0.16, true);
    const o = this.ctx.createOscillator();
    o.frequency.value = 190;
    const g = this.ctx.createGain();
    this.env(g, time, 0.25, 0.002, 0.09);
    o.connect(g).connect(this.bus);
    o.start(time);
    o.stop(time + 0.12);
  }

  private hat(time: number, peak: number) {
    this.noiseHit(time, "highpass", 7500, peak, 0.04);
  }

  private bass(midi: number, time: number, dur: number) {
    const o = this.ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq(midi);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(700, time);
    lp.frequency.exponentialRampToValueAtTime(220, time + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.3, time + 0.01);
    g.gain.setValueAtTime(0.3, time + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(lp).connect(g).connect(this.bus);
    o.start(time);
    o.stop(time + dur + 0.02);
  }

  private pad(notes: number[], time: number, dur: number, cutoff: number) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.07, time + dur * 0.25);
    g.gain.setValueAtTime(0.07, time + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur * 1.05);
    lp.connect(g);
    g.connect(this.bus);
    g.connect(this.reverb);
    for (const midi of notes) {
      for (const detune of [-7, 7]) {
        const o = this.ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = freq(midi);
        o.detune.value = detune;
        o.connect(lp);
        o.start(time);
        o.stop(time + dur * 1.1);
      }
    }
  }

  private pluck(midi: number, time: number, dur: number) {
    const o = this.ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = freq(midi);
    const g = this.ctx.createGain();
    this.env(g, time, 0.12, 0.004, Math.max(0.08, dur));
    o.connect(g);
    g.connect(this.bus);
    g.connect(this.delay);
    o.start(time);
    o.stop(time + dur + 0.1);
  }

  private lead(midi: number, time: number, dur: number, wave: OscillatorType) {
    const o = this.ctx.createOscillator();
    o.type = wave;
    o.frequency.value = freq(midi);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vg = this.ctx.createGain();
    vg.gain.value = 4;
    vib.connect(vg).connect(o.detune);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600;
    const g = this.ctx.createGain();
    this.env(g, time, wave === "square" || wave === "sawtooth" ? 0.05 : 0.11, 0.02, dur);
    o.connect(lp).connect(g);
    g.connect(this.bus);
    g.connect(this.delay);
    o.start(time);
    vib.start(time);
    o.stop(time + dur + 0.05);
    vib.stop(time + dur + 0.05);
  }

  private startCrackle() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() < 0.0008 ? (Math.random() * 2 - 1) * 0.8 : (Math.random() * 2 - 1) * 0.01;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0.25;
    src.connect(g).connect(this.out);
    src.start();
    this.crackleSrc = src;
  }
}
