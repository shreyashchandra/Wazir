import { useRef, useState } from "react";
import type { MoveReview } from "../lib/analyze";
import type { Score } from "../lib/engine";
import { formatScore, whiteWinFromWhiteScore } from "../lib/analyze";
import { CLASS_META } from "../lib/classify";

interface Props {
  startEval: Score;
  moves: MoveReview[];
  total: number;
  ply: number;
  onSelect: (ply: number) => void;
}

const MARKED = new Set(["brilliant", "great", "mistake", "miss", "blunder"]);

/** White's win% over the game: white area from the bottom, dark above. Click to jump. */
export function EvalGraph({ startEval, moves, total, ply, onSelect }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = 110;
  const n = Math.max(1, total);
  const x = (i: number) => (i / n) * W;
  const y = (win: number) => H - (win / 100) * H;
  const wins = [whiteWinFromWhiteScore(startEval), ...moves.map((m) => whiteWinFromWhiteScore(m.evalAfter))];
  const pts = wins.map((w, i) => `${x(i).toFixed(1)},${y(w).toFixed(1)}`).join(" ");
  const area = `0,${H} ${pts} ${x(wins.length - 1).toFixed(1)},${H}`;

  const plyAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(moves.length, Math.round(((clientX - r.left) / r.width) * n)));
  };
  const hm = hover !== null && hover > 0 ? moves[hover - 1] : null;

  return (
    <div style={{ position: "relative" }}>
      <svg
        ref={ref}
        className="graph"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onClick={(e) => onSelect(plyAt(e.clientX))}
        onMouseMove={(e) => setHover(plyAt(e.clientX))}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Evaluation graph"
      >
        <polygon points={area} fill="#f3f3f3" />
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="#8a8781" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        <line x1={x(ply)} x2={x(ply)} y1="0" y2={H} stroke="#81b64c" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {hover !== null && hover !== ply && (
          <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke="#5c9ced" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {/* Markers are HTML so they stay round under the stretched SVG. */}
      {moves.map((m, i) =>
        MARKED.has(m.classification) ? (
          <span
            key={i}
            title={`${m.moveNumber}${m.color === "w" ? "." : "..."} ${m.san} — ${CLASS_META[m.classification].label}`}
            onClick={() => onSelect(i + 1)}
            style={{
              position: "absolute",
              left: `calc(${(x(i + 1) / W) * 100}% - 5px)`,
              top: `calc(${(y(wins[i + 1]) / H) * 100}% - 5px)`,
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: CLASS_META[m.classification].color,
              border: "2px solid #262421",
              cursor: "pointer",
            }}
          />
        ) : null,
      )}
      {hm && (
        <div className="chart-tip" style={{ position: "absolute", top: -42, left: `min(calc(${(x(hover!) / W) * 100}% ), calc(100% - 150px))`, pointerEvents: "none", whiteSpace: "nowrap" }}>
          {hm.moveNumber}
          {hm.color === "w" ? "." : "..."} {hm.san} · <b>{formatScore(hm.evalAfter)}</b>
        </div>
      )}
    </div>
  );
}
