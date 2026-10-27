// The counter's LED token display, drawn as real seven-segment digits.
// Unlit segments stay faintly visible, like on the actual board.
const T = 9; // segment thickness
const G = 2.5; // gap where segments meet
const L = 6;
const R = 50;
const TOP = 6;
const MID = 50;
const BOT = 94;

const h = (x0, x1, y) =>
  `${x0},${y} ${x0 + T / 2},${y - T / 2} ${x1 - T / 2},${y - T / 2} ${x1},${y} ${x1 - T / 2},${y + T / 2} ${x0 + T / 2},${y + T / 2}`;
const v = (x, y0, y1) =>
  `${x},${y0} ${x + T / 2},${y0 + T / 2} ${x + T / 2},${y1 - T / 2} ${x},${y1} ${x - T / 2},${y1 - T / 2} ${x - T / 2},${y0 + T / 2}`;

const SEGMENTS = {
  a: h(L + G, R - G, TOP),
  b: v(R, TOP + G, MID - G),
  c: v(R, MID + G, BOT - G),
  d: h(L + G, R - G, BOT),
  e: v(L, MID + G, BOT - G),
  f: v(L, TOP + G, MID - G),
  g: h(L + G, R - G, MID),
};

const LIT = {
  0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd",
  6: "afgedc", 7: "abc", 8: "abcdefg", 9: "abfgcd", "-": "g", " ": "",
};

const ADVANCE = 62;

export default function Segments({ value, digits = 3, height = 64, className = "", label }) {
  const count = Math.max(digits, String(value ?? "").trim().length);
  const text = String(value ?? "").trim().padStart(count, " ");
  return (
    <svg
      className={`segments ${className}`}
      viewBox={`-4 0 ${count * ADVANCE + 4} 100`}
      height={height}
      width={(height * (count * ADVANCE + 4)) / 100}
      role="img"
      aria-label={label ?? `Token ${String(value ?? "").trim()}`}
    >
      {[...text].map((char, i) => (
        <g key={i} transform={`translate(${i * ADVANCE + 4} 0) skewX(-6)`}>
          {Object.entries(SEGMENTS).map(([name, points]) => (
            <polygon key={name} points={points} className={(LIT[char] ?? "").includes(name) ? "on" : "off"} />
          ))}
        </g>
      ))}
    </svg>
  );
}
