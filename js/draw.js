/** Colours are [r, g, b] triples so they can be blended per frame. */
export const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
export const WHITE = rgb(0xffffff);
export const BLACK = rgb(0x000000);
export const TRANSPARENT = 'rgba(0,0,0,0)';

export const css = ([r, g, b], a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const rad = (deg) => (deg * Math.PI) / 180;

/** The Android designs sized some hairlines in raw pixels; this is one of those pixels in CSS px on a ~420 dpi phone. */
export const PX = 1 / 2.625;

export const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const LINE = 1.3;

/** Deterministic random numbers, so textures look the same on every resize. */
export function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stops are evenly spaced colour strings, or [offset, colour] pairs. */
function withStops(gradient, stops) {
  stops.forEach((s, i) =>
    typeof s === 'string' ? gradient.addColorStop(i / (stops.length - 1), s) : gradient.addColorStop(s[0], s[1]),
  );
  return gradient;
}
export const linear = (ctx, x0, y0, x1, y1, stops) => withStops(ctx.createLinearGradient(x0, y0, x1, y1), stops);
export const radial = (ctx, cx, cy, r, stops) => withStops(ctx.createRadialGradient(cx, cy, 0, cx, cy, r), stops);
export const sweep = (ctx, cx, cy, stops) => withStops(ctx.createConicGradient(0, cx, cy), stops);

export function circle(ctx, cx, cy, r, fill) {
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0, r), 0, 2 * Math.PI);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function roundRect(ctx, x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function strokeCircle(ctx, cx, cy, r, stroke, width) {
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0, r), 0, 2 * Math.PI);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

export function strokePath(ctx, path, stroke, width) {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke(path);
}

export function strokeRoundRect(ctx, x, y, w, h, r, stroke, width) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

export function line(ctx, x0, y0, x1, y1, stroke, width, cap = 'butt') {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineCap = cap;
  ctx.stroke();
}

export const font = (size, { weight = 400, italic = false, family = SANS, spacing = 0 } = {}) => ({
  size,
  spacing,
  css: `${italic ? 'italic ' : ''}${weight} ${size}px ${family}`,
});
export const lineHeight = (f) => f.size * LINE;

function applyFont(ctx, f) {
  ctx.font = f.css;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${f.spacing}px`;
}

export function measure(ctx, str, f) {
  applyFont(ctx, f);
  return ctx.measureText(str).width;
}

/** Draws one line of text whose line box starts at `top`; `x` is its left, centre or right edge per `align`. */
export function text(ctx, str, x, top, f, color, align = 'left') {
  applyFont(ctx, f);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(str, x, top + lineHeight(f) / 2);
}

/**
 * Paints into a canvas at its laid-out CSS size, sharp on high-DPI screens.
 * - `prepare(ctx, w, h, scale)` builds size-dependent resources (paths, gradients) once per resize.
 *   `scale` is the CSS `--canvas-scale`, so canvas lettering steps up with the page's own text.
 * - `draw(ctx, w, h, cache, props)` paints a frame from the props last given to `update`.
 * - `bleed` lets shadows and glows spill past the element's box: the canvas is that much larger.
 */
export function layer(canvas, draw, { prepare = () => null, bleed = 0 } = {}) {
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  let cache = null;
  let props = {};
  let drawn = false;
  if (bleed) {
    Object.assign(canvas.style, {
      position: 'absolute',
      left: `${-bleed}px`,
      top: `${-bleed}px`,
      width: `calc(100% + ${bleed * 2}px)`,
      height: `calc(100% + ${bleed * 2}px)`,
    });
  }

  function redraw() {
    if (w <= 0 || h <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, bleed * dpr, bleed * dpr);
    ctx.save();
    draw(ctx, w, h, cache, props);
    ctx.restore();
  }

  new ResizeObserver(([entry]) => {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = entry.contentRect;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    w = width - bleed * 2;
    h = height - bleed * 2;
    if (w <= 0 || h <= 0) return;
    const scale = parseFloat(getComputedStyle(canvas).getPropertyValue('--canvas-scale')) || 1;
    cache = prepare(ctx, w, h, scale);
    redraw();
  }).observe(canvas);

  return {
    /** Sets the props `draw` paints with, redrawing only when one of them moved. */
    update(next) {
      if (drawn && Object.keys(next).every((k) => same(next[k], props[k]))) return;
      props = next;
      drawn = true;
      redraw();
    },
  };
}

const same = (a, b) =>
  Array.isArray(a) ? a.length === b?.length && a.every((v, i) => same(v, b[i])) : Math.abs(a - b) < 1e-4;
