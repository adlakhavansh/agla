import { useEffect, useRef } from "react";

// A scrolling LED shop sign, drawn dot by dot. The text is rendered once into a hidden canvas
// at ROWS dots tall, each dot cell is sampled (lit if enough ink falls in it), and the visible
// window slides one column at a time, the way the real signs above shop shutters do.
const ROWS = 9;
const CELL = 4; // pixels per dot cell in the hidden raster
const LIT = "#ff3b1f";

const rasterize = (text) => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const font = `800 ${ROWS * CELL * 1.18}px "Baloo 2", system-ui, sans-serif`;
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width) + CELL * 4;
  canvas.width = width;
  canvas.height = ROWS * CELL;
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#000";
  ctx.fillText(text, CELL * 2, (ROWS * CELL) / 2 + CELL * 0.6);

  const { data } = ctx.getImageData(0, 0, width, ROWS * CELL);
  const cols = Math.floor(width / CELL);
  const lit = Array.from({ length: cols }, () => new Uint8Array(ROWS));
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < ROWS; row++) {
      let ink = 0;
      for (let y = 0; y < CELL; y++) {
        for (let x = 0; x < CELL; x++) ink += data[((row * CELL + y) * width + col * CELL + x) * 4 + 3];
      }
      lit[col][row] = ink / (CELL * CELL) > 96 ? 1 : 0;
    }
  }
  return lit;
};

// Two pre-drawn dots (lit with a glow, and unlit) so each frame is just image copies.
const sprite = (pitch, dpr, on) => {
  const size = Math.ceil(pitch * dpr);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const c = size / 2;
  if (on) {
    const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
    glow.addColorStop(0, "rgb(255 59 31 / 0.55)");
    glow.addColorStop(1, "rgb(255 59 31 / 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.beginPath();
  ctx.arc(c, c, size * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = on ? LIT : "rgb(255 59 31 / 0.09)";
  ctx.fill();
  return canvas;
};

export default function DotMatrix({ text, pitch = 6, speed = 26, className = "", label }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !text) return undefined;
    let frame;
    let alive = true;

    const start = async () => {
      await document.fonts?.ready;
      if (!alive) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // A gap of blank columns between repeats, like the sign looping round.
      const message = rasterize(`${text}     `);
      const on = sprite(pitch, dpr, true);
      const off = sprite(pitch, dpr, false);
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let last = -1;

      const draw = (now) => {
        const width = canvas.clientWidth;
        const cols = Math.ceil(width / pitch);
        if (canvas.width !== Math.round(width * dpr)) {
          canvas.width = Math.round(width * dpr);
          canvas.height = Math.round(ROWS * pitch * dpr);
          last = -1;
        }
        const shift = still ? 0 : Math.floor((now / 1000) * speed) % message.length;
        if (shift !== last) {
          last = shift;
          const ctx = canvas.getContext("2d");
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const step = pitch * dpr;
          for (let col = 0; col < cols; col++) {
            const column = message[(col + shift) % message.length];
            for (let row = 0; row < ROWS; row++) ctx.drawImage(column[row] ? on : off, col * step, row * step);
          }
        }
        if (!still) frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
    };

    start();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  }, [text, pitch, speed]);

  return (
    <div className={`dotmatrix ${className}`} role="marquee" aria-label={label ?? text}>
      <canvas ref={ref} style={{ height: ROWS * pitch }} aria-hidden="true" />
    </div>
  );
}
