import { useId, useState } from "react";

// One-series column chart in plain SVG. Bars are capped at 24px and round only at the top;
// a turmeric dot above a bar marks a flagged day (sold out). Hover or focus shows the
// exact value, and a table view carries everything for screen readers and printouts.
// Rounds the top of the scale up to 1, 2, 2.5 or 5 times a power of ten, so gridlines land on round numbers.
const niceCeil = (value) => {
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map((m) => m * power).find((step) => step >= value);
};

export default function Bars({ data, height = 160, format = String, title, compact = false, tickEvery = 1, markLabel = "Sold out" }) {
  const id = useId();
  const [hover, setHover] = useState(null);
  const [table, setTable] = useState(false);
  const max = niceCeil(Math.max(1, ...data.map((d) => d.value)));
  const band = 100 / Math.max(1, data.length);
  const top = compact ? 4 : 14;
  const bottom = compact ? 0 : 20;
  const plot = height - top - bottom;
  const grid = compact ? [] : [0.5, 1].map((f) => Math.round(max * f));

  const bar = (d, i) => {
    const h = (d.value / max) * plot;
    const w = Math.min(band * 0.62, 24);
    const x = i * band + (band - w) / 2;
    const y = top + plot - h;
    const r = Math.min(4, w / 2, h);
    // Square at the baseline, rounded at the data end.
    return h <= 0 ? null : `M${x},${top + plot} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${top + plot} Z`;
  };

  if (table && !compact) {
    return (
      <figure className="chart">
        <figcaption className="chart-head">{title}<button type="button" className="link-btn" onClick={() => setTable(false)}>Show chart</button></figcaption>
        <table className="data-table">
          <thead><tr><th scope="col">When</th><th scope="col">Value</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.key}><td>{d.label}</td><td>{format(d.value)}{d.marked ? `, ${markLabel.toLowerCase()}` : ""}</td></tr>)}</tbody>
        </table>
      </figure>
    );
  }

  const active = hover === null ? null : data[hover];
  return (
    <figure className={`chart${compact ? " compact" : ""}`} onMouseLeave={() => setHover(null)}>
      {!compact && title && (
        <figcaption className="chart-head" id={id}>{title}<button type="button" className="link-btn" onClick={() => setTable(true)}>Show table</button></figcaption>
      )}
      <div className="chart-body">
        <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" height={height} width="100%" role="img" aria-labelledby={compact ? undefined : id} aria-label={compact ? title : undefined}>
          {grid.map((g) => {
            const y = top + plot - (g / max) * plot;
            return <line key={g} x1="0" x2="100" y1={y} y2={y} className="grid" vectorEffect="non-scaling-stroke" />;
          })}
          <line x1="0" x2="100" y1={top + plot} y2={top + plot} className="baseline" vectorEffect="non-scaling-stroke" />
          {data.map((d, i) => (
            <g key={d.key}>
              <rect
                x={i * band} y="0" width={band} height={height}
                className="hit"
                tabIndex={compact ? -1 : 0}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              >
                {compact && <title>{`${d.label}: ${format(d.value)}${d.marked ? `, ${markLabel.toLowerCase()}` : ""}`}</title>}
              </rect>
              <path d={bar(d, i) ?? ""} className={`bar${hover === i ? " on" : ""}`} />
            </g>
          ))}
        </svg>
        {/* Markers and labels live in HTML so they keep their shape when the SVG stretches. */}
        {data.map((d, i) => d.marked && (
          <span key={d.key} className="mark-dot" style={{ left: `${(i + 0.5) * band}%`, top: top + plot - (d.value / max) * plot - 9 }} aria-hidden="true" />
        ))}
        {!compact && grid.map((g) => (
          <span key={g} className="grid-label" style={{ top: top + plot - (g / max) * plot - 8 }}>{format(g)}</span>
        ))}
        {!compact && (
          <div className="ticks" aria-hidden="true">
            {data.map((d, i) => (i % tickEvery === 0 ? <span key={d.key} style={{ left: `${(i + 0.5) * band}%` }}>{d.tick ?? d.label}</span> : null))}
          </div>
        )}
        {active && !compact && (
          <div className="tip" style={{ left: `${Math.min(85, Math.max(15, (hover + 0.5) * band))}%` }} role="status">
            <strong>{format(active.value)}</strong>
            <span>{active.label}{active.marked ? `, ${markLabel.toLowerCase()}` : ""}</span>
            {active.note && <span>{active.note}</span>}
          </div>
        )}
      </div>
    </figure>
  );
}
