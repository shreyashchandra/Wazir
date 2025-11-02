import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
mkdirSync("icons", { recursive: true });
const svg = readFileSync("icons/pawn.svg");
for (const s of [16, 32, 48, 128]) {
  const png = await sharp(svg).resize(s, s).png().toBuffer();
  writeFileSync(`icons/pawn-${s}.png`, png);
  console.log("made icons/pawn-%d.png", s);
}
