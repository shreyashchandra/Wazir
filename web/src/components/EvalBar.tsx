import type { Score } from "../lib/engine";
import { formatScore, whiteWinFromWhiteScore } from "../lib/analyze";

export function EvalBar({ score, orientation }: { score: Score | null; orientation: "white" | "black" }) {
  const win = score ? whiteWinFromWhiteScore(score) : 50;
  const text = score ? formatScore(score).replace("+", "") : "";
  const whiteAhead = win >= 50;
  const flipped = orientation === "black";
  return (
    <div className="evalbar" style={{ transform: flipped ? "rotate(180deg)" : undefined }} aria-label={`Evaluation ${text}`}>
      <div className="white" style={{ height: `${win}%` }} />
      <div
        className="label"
        style={{
          bottom: whiteAhead ? 4 : undefined,
          top: whiteAhead ? undefined : 4,
          color: whiteAhead ? "#333" : "#eee",
          transform: flipped ? "rotate(180deg)" : undefined,
        }}
      >
        {text}
      </div>
    </div>
  );
}
