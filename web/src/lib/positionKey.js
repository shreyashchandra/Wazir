// Compact, stable key for a chess position: placement + side to move + castling
// (en-passant and move counters are ignored so transpositions match), hashed
// with cyrb53 to a short base-36 string. Shared by the build script and the app.
export function positionKey(fen) {
  return hashString(fen.split(" ").slice(0, 3).join(" "));
}

/** cyrb53 string hash, base 36. */
export function hashString(epd) {
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < epd.length; i++) {
    const ch = epd.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
