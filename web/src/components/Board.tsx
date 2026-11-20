import { useMemo, useState } from "react";
import { Chess, type Square } from "chess.js";
import { CLASS_META, type Classification } from "../lib/classify";
import { ClassIcon } from "./ClassIcon";

export interface Arrow {
  from: string;
  to: string;
  color: string;
}

interface Props {
  fen: string;
  orientation: "white" | "black";
  lastMove?: { from: string; to: string } | null;
  arrows?: Arrow[];
  badge?: { square: string; cls: Classification } | null;
  /** When set, the board is interactive (click a piece, then a target square). */
  onMove?: (from: string, to: string, promotion?: string) => void;
}

const FILES = "abcdefgh";

function squareAt(row: number, col: number, orientation: "white" | "black") {
  const file = orientation === "white" ? col : 7 - col;
  const rank = orientation === "white" ? 8 - row : row + 1;
  return `${FILES[file]}${rank}`;
}

function center(sq: string, orientation: "white" | "black") {
  const f = FILES.indexOf(sq[0]);
  const r = Number(sq[1]);
  const x = orientation === "white" ? f : 7 - f;
  const y = orientation === "white" ? 8 - r : r - 1;
  return { x: x + 0.5, y: y + 0.5 };
}

export function Board({ fen, orientation, lastMove, arrows = [], badge, onMove }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  }, [fen]);

  const targets = useMemo(() => {
    if (!selected) return new Set<string>();
    return new Set(chess.moves({ square: selected as Square, verbose: true }).map((m) => m.to));
  }, [chess, selected]);

  const checkSq = useMemo(() => {
    if (!chess.inCheck()) return null;
    for (const row of chess.board()) for (const p of row) if (p && p.type === "k" && p.color === chess.turn()) return p.square;
    return null;
  }, [chess]);

  const click = (sq: string) => {
    if (!onMove) return;
    const piece = chess.get(sq as Square);
    if (selected && targets.has(sq)) {
      const moving = chess.get(selected as Square);
      const promo = moving?.type === "p" && (sq[1] === "8" || sq[1] === "1") ? "q" : undefined;
      onMove(selected, sq, promo);
      setSelected(null);
      return;
    }
    if (piece && piece.color === chess.turn()) setSelected(sq === selected ? null : sq);
    else setSelected(null);
  };

  const cells = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = squareAt(row, col, orientation);
      const p = chess.get(sq as Square);
      const light = (row + col) % 2 === 0;
      const hl = lastMove && (lastMove.from === sq || lastMove.to === sq);
      cells.push(
        <div
          key={sq}
          className={`sq ${light ? "light" : "dark"}${hl ? " hl" : ""}${selected === sq ? " sel" : ""}${checkSq === sq ? " check" : ""}`}
          onClick={() => click(sq)}
          data-square={sq}
        >
          {col === 0 && <span className="coord r">{sq[1]}</span>}
          {row === 7 && <span className="coord f">{sq[0]}</span>}
          {p && <img src={`/pieces/${p.color}${p.type.toUpperCase()}.svg`} alt="" draggable={false} />}
          {targets.has(sq) && <span className="dot-target" />}
          {badge?.square === sq && (
            <span className="cls-badge" title={CLASS_META[badge.cls].label}>
              <ClassIcon cls={badge.cls} size="100%" />
            </span>
          )}
        </div>,
      );
    }
  }

  return (
    <div className="board" aria-label="Chess board">
      {cells}
      <svg className="overlay" viewBox="0 0 8 8">
        <defs>
          {arrows.map((a, i) => (
            <marker key={i} id={`ah-${i}`} markerWidth="3" markerHeight="3" refX="1.6" refY="1.5" orient="auto">
              <path d="M0,0 L3,1.5 L0,3 z" fill={a.color} />
            </marker>
          ))}
        </defs>
        {arrows.map((a, i) => {
          const s = center(a.from, orientation);
          const e = center(a.to, orientation);
          const dx = e.x - s.x;
          const dy = e.y - s.y;
          const len = Math.hypot(dx, dy) || 1;
          const ex = e.x - (dx / len) * 0.35;
          const ey = e.y - (dy / len) * 0.35;
          return (
            <line
              key={i}
              x1={s.x}
              y1={s.y}
              x2={ex}
              y2={ey}
              stroke={a.color}
              strokeWidth={0.17}
              strokeLinecap="round"
              opacity={0.85}
              markerEnd={`url(#ah-${i})`}
            />
          );
        })}
      </svg>
    </div>
  );
}
