// Minimal, robust PGN helpers (headers, SAN move list, clock comments).

export function parseHeaders(pgn: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const re = /^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pgn))) headers[m[1]] = m[2].replace(/\\"/g, '"');
  return headers;
}

function movetext(pgn: string): string {
  return pgn
    .replace(/^\s*\[[^\]]*\]\s*$/gm, "")
    .replace(/\r/g, "");
}

/** Strips comments, variations, NAGs, move numbers and results; returns SAN tokens. */
export function extractSanMoves(pgn: string): string[] {
  let text = movetext(pgn).replace(/\{[^}]*\}/g, " ").replace(/;[^\n]*/g, " ");
  // Remove (nested) variations.
  let prev;
  do {
    prev = text;
    text = text.replace(/\([^()]*\)/g, " ");
  } while (text !== prev);
  return text
    .replace(/\$\d+/g, " ")
    .replace(/\d+\.(\.\.)?/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/[!?]+$/, ""))
    .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
}

/** Remaining clock (seconds) after each ply, from `[%clk h:mm:ss.s]` comments. */
export function extractClocks(pgn: string): number[] {
  const out: number[] = [];
  const re = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pgn))) out.push(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
  return out;
}

/** "Kings-Indian-Defense-Fianchetto-Variation-8.d5-Nb8" -> "Kings Indian Defense Fianchetto Variation" */
export function openingFromEcoUrl(ecoUrl?: string): string {
  const slug = ecoUrl?.match(/\/openings\/([^?#]+)/i)?.[1];
  if (!slug) return "";
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    /* keep raw */
  }
  const words: string[] = [];
  for (const w of decoded.split("-")) {
    if (/^\d+\./.test(w) || /^\d+\.\.\./.test(w)) break;
    words.push(w);
  }
  return words.join(" ").replace(/\s+/g, " ").trim();
}

function parseUtc(date?: string, time?: string): number | null {
  if (!date || !time || date.includes("?")) return null;
  const t = Date.parse(`${date.replace(/\./g, "-")}T${time}Z`);
  return Number.isNaN(t) ? null : t;
}

/** Wall-clock duration of a live game in seconds, from chess.com PGN headers. */
export function gameDurationSec(headers: Record<string, string>): number | null {
  const start = parseUtc(headers.UTCDate || headers.Date, headers.StartTime || headers.UTCTime);
  const end = parseUtc(headers.EndDate, headers.EndTime);
  if (start === null || end === null) return null;
  let d = (end - start) / 1000;
  if (d < 0) d += 86400;
  return d >= 0 && d < 6 * 3600 ? d : null;
}
