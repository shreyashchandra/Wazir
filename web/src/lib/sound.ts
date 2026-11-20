// Board sounds, synthesized with the Web Audio API (no audio files, no licensing).
// A "move" is a short wooden knock: a filtered noise transient over a low body thump.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const listeners = new Set<(on: boolean) => void>();

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export function sharedAudio() {
  const c = audio();
  return c && master ? { ctx: c, out: master } : null;
}

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem("wazir:sound") !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem("wazir:sound", on ? "on" : "off");
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(on));
}

export function onSoundChange(l: (on: boolean) => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

let noiseBuf: AudioBuffer | null = null;
function noise(c: AudioContext) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.25, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function knock(c: AudioContext, t: number, { pitch = 1, gain = 1 } = {}) {
  // Transient: band-passed noise, very short.
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1900 * pitch;
  bp.Q.value = 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.55 * gain, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  src.connect(bp).connect(g).connect(master!);
  src.start(t);
  src.stop(t + 0.06);
  // Body: short low sine thump (the board resonating).
  const o = c.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(260 * pitch, t);
  o.frequency.exponentialRampToValueAtTime(120 * pitch, t + 0.06);
  const og = c.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(0.5 * gain, t + 0.004);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  o.connect(og).connect(master!);
  o.start(t);
  o.stop(t + 0.1);
}

function tone(c: AudioContext, t: number, freq: number, dur: number, gain = 0.18, type: OscillatorType = "triangle") {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export type SoundKind = "move" | "capture" | "castle" | "check" | "promote" | "end" | "illegal" | "notify";

export function play(kind: SoundKind) {
  if (!soundEnabled()) return;
  const c = audio();
  if (!c || !master) return;
  const t = c.currentTime + 0.005;
  switch (kind) {
    case "move":
      knock(c, t);
      break;
    case "capture":
      knock(c, t, { pitch: 0.85, gain: 1.15 });
      knock(c, t + 0.035, { pitch: 1.25, gain: 0.7 });
      break;
    case "castle":
      knock(c, t);
      knock(c, t + 0.09, { pitch: 1.1, gain: 0.85 });
      break;
    case "check":
      knock(c, t, { gain: 0.9 });
      tone(c, t + 0.01, 880, 0.18, 0.12, "sine");
      tone(c, t + 0.01, 1320, 0.14, 0.05, "sine");
      break;
    case "promote":
      knock(c, t);
      tone(c, t + 0.03, 660, 0.12, 0.1);
      tone(c, t + 0.1, 990, 0.18, 0.1);
      break;
    case "end":
      [523.25, 659.25, 783.99].forEach((f, i) => tone(c, t + i * 0.07, f, 0.7, 0.09));
      break;
    case "illegal":
      tone(c, t, 180, 0.12, 0.12, "square");
      break;
    case "notify":
      tone(c, t, 988, 0.12, 0.08, "sine");
      tone(c, t + 0.09, 1319, 0.2, 0.08, "sine");
      break;
  }
}

/** Picks the right sound for a SAN move (+ optional "game over" flag). */
export function playForSan(san: string, gameOver = false) {
  if (gameOver || san.includes("#")) {
    play(san.includes("x") ? "capture" : "move");
    setTimeout(() => play("end"), 140);
    return;
  }
  if (san.includes("+")) return play("check");
  if (san.startsWith("O-O")) return play("castle");
  if (san.includes("=")) return play("promote");
  if (san.includes("x")) return play("capture");
  return play("move");
}
