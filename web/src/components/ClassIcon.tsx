import { CLASS_META, type Classification } from "../lib/classify";

export function ClassIcon({ cls, size = 18 }: { cls: Classification; size?: number | string }) {
  const m = CLASS_META[cls];
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} role="img" aria-label={m.label} style={{ flex: "none", display: "block" }}>
      <circle cx="10" cy="10" r="9.5" fill={m.color} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
      <text
        x="10"
        y="10.5"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={m.glyph.length > 1 ? 9 : 11}
        fontWeight="900"
        fill="#fff"
        fontFamily="system-ui, sans-serif"
      >
        {m.glyph}
      </text>
    </svg>
  );
}
