import { Spring, Tween, Wave, LinearOutSlowIn } from './anim.js';
import {
  BLACK, PX, SERIF, TRANSPARENT, WHITE, circle, clamp, css, font, layer, line, lineHeight, linear, mix,
  rad, radial, rgb, roundRect, seeded, strokeCircle, strokePath, strokeRoundRect, sweep, text,
} from './draw.js';
import { pressable, volumeSlider } from './controls.js';
import { STATION_FREQ_MHZ, isOn } from './station.js';
import { VOLUME_MAX } from './volume.js';

const FREQ_MIN = 88;
const FREQ_MAX = 108;

const P = {
  walnutDark: rgb(0x3a2112),
  walnut: rgb(0x6a3d20),
  walnutLight: rgb(0x8e5a33),
  grain: rgb(0x261307),
  brassLight: rgb(0xf3da9a),
  brass: rgb(0xc9a45c),
  brassDark: rgb(0x7d5e25),
  dialLit: rgb(0xffebb8),
  dialLitDeep: rgb(0xf2c46e),
  dialUnlit: rgb(0x5e533f),
  dialUnlitDeep: rgb(0x3f372a),
  glow: rgb(0xffb24a),
  ink: rgb(0x3b2a18),
  needle: rgb(0xc62828),
  cloth: rgb(0xbfa878),
  clothDark: rgb(0x7f6b45),
  bakeliteLight: rgb(0x6b4630),
  bakelite: rgb(0x22140b),
  eyeGreen: rgb(0x6bff9a),
  eyeDark: rgb(0x0a1f12),
  unlitLamp: rgb(0x3d2c18),
};

const VOLUME_THUMB_W = 34;
/** How far in from each end of the volume bar the lamps start, leaving room for the speaker icons. */
const VOLUME_BAR_PAD = 36;

const STATUS = {
  off: 'Turn the knob to listen',
  tuning: 'Warming up…',
  live: '● On air',
  error: 'No signal · turn to retry',
};

/** Polished brass trim running corner to corner. */
const brassBezel = (ctx, w, h) =>
  linear(ctx, 0, 0, w, h, [css(P.brassLight), css(P.brassDark), css(P.brass), css(P.brassDark)]);

/** A 1960s walnut valve radio. The bakelite knob is play/pause; the brass slider is the volume. */
export function createVintage(page, { radio, volume, wake }) {
  const $ = (sel) => page.querySelector(sel);
  // Valves take a moment to warm up, so the dial light fades in slowly.
  const glow = new Tween(0, 1400, LinearOutSlowIn);
  const eyeShadow = new Tween(140, 900);
  const flicker = new Wave(360, 'reverse');
  const drift = new Wave(1100, 'reverse');
  const rotation = new Spring(-50, { stiffness: 400, dampingRatio: 0.6, threshold: 0.01 });
  const press = new Spring(1);
  const thumbAt = new Tween(volume.fraction, 120);

  layer($('.wood'), drawWood, { prepare: prepareWood });
  layer($('.grille'), drawGrille, { prepare: prepareGrille });
  const dial = layer($('.dial'), drawDial, { prepare: prepareDial });
  const eye = layer($('.eye canvas'), drawEye, { prepare: prepareEye, bleed: 8 });
  const knob = layer($('.knob canvas'), drawKnob, { prepare: prepareKnob });
  const bar = layer($('.volume-bar canvas'), drawVolumeBar, { prepare: prepareVolumeBar, bleed: 4 });

  // The label and the gaps around the bar take touches too, so a slightly missed thumb moves the
  // volume rather than swiping to the other radio.
  volumeSlider($('.volume'), $('.volume-bar'), VOLUME_BAR_PAD, volume);
  const levelLabel = $('.volume-level');
  const showLevel = () => (levelLabel.textContent = String(volume.level));
  volume.addEventListener('input', () => {
    thumbAt.set(volume.fraction, performance.now());
    showLevel();
    wake();
  });
  showLevel();

  const knobButton = $('.knob');
  pressable(
    knobButton,
    (down) => {
      press.set(down ? 0.94 : 1);
      wake();
    },
    () => radio.toggle(),
  );

  return {
    setPhase(now) {
      const { phase } = radio;
      glow.set({ live: 1, tuning: 0.7 }[phase] ?? 0, now);
      eyeShadow.set({ live: 16, tuning: 80 }[phase] ?? 140, now);
      flicker.setActive(phase === 'tuning', now);
      drift.setActive(phase === 'tuning', now);
      rotation.set(isOn(phase) ? 50 : -50);
      $('.plaque').textContent = STATUS[phase];
      knobButton.setAttribute('aria-label', isOn(phase) ? 'Pause' : 'Play');
      $('.knob-label.off').classList.toggle('active', !isOn(phase));
      $('.knob-label.on').classList.toggle('active', isOn(phase));
    },

    /** Advances animations; redraws when `visible`. True while something is still moving. */
    frame(now, dt, spectrum, visible) {
      const moving = [glow.step(now), eyeShadow.step(now), rotation.step(dt), press.step(dt), thumbAt.step(now)].some(Boolean);
      if (!visible) return moving;
      const d = drift.at(now);
      dial.update({ glow: glow.value * (1 - 0.25 * Math.abs(flicker.at(now))), drift: d });
      // Louder audio narrows the wedge, like a real tuning eye on a strong signal.
      const loudness = radio.phase === 'live' ? (0.5 - spectrum.level) * 24 : 0;
      // Half-degree steps: finer movement is invisible at this size, so it needn't redraw.
      const sweep = Math.round(clamp(eyeShadow.value + d * 25 + loudness, 4, 360) * 2) / 2;
      eye.update({ glow: glow.value, sweep });
      knob.update({ rotation: rotation.value, scale: press.value });
      bar.update({ at: thumbAt.value, lit: volume.level });
      return moving;
    },
  };
}

function prepareWood(ctx, w, h) {
  const random = seeded(1960);
  const grain = Array.from({ length: 90 }, () => {
    const y0 = random() * h;
    const amp = (2 + random() * 10) * PX;
    const freq = (0.004 + random() * 0.01) / PX;
    const phase = random() * 2 * Math.PI;
    const path = new Path2D();
    path.moveTo(0, y0);
    for (let x = 0; x <= w + 3; x += 3) {
      path.lineTo(x, y0 + amp * Math.sin(x * freq + phase) + amp * 0.4 * Math.sin(x * freq * 3.1));
    }
    return { path, color: css(P.grain, 0.06 + random() * 0.22), width: (0.6 + random() * 2.4) * PX };
  });
  return {
    grain,
    base: linear(ctx, 0, 0, 0, h, [css(P.walnutLight), css(P.walnut), css(P.walnutDark)]),
    sheen: linear(ctx, 0, 0, w, 0, [TRANSPARENT, css(WHITE, 0.07), TRANSPARENT]),
    bevel: linear(ctx, 0, 0, 0, h, [css(WHITE, 0.3), css(BLACK, 0.5)]),
  };
}

function drawWood(ctx, w, h, c) {
  ctx.fillStyle = c.base;
  ctx.fillRect(0, 0, w, h);
  for (const g of c.grain) strokePath(ctx, g.path, g.color, g.width);
  ctx.fillStyle = c.sheen;
  ctx.fillRect(0, 0, w, h);
  strokeRoundRect(ctx, 0, 0, w, h, 28, c.bevel, 3);
}

function prepareDial(ctx, w, h, scale) {
  const fonts = {
    label: font(13 * scale, { weight: 700, family: SERIF }),
    small: font(10 * scale, { family: SERIF, spacing: 2 * scale }),
    station: font(10 * scale, { weight: 700, family: SERIF, spacing: 2 * scale }),
  };
  const inset = 6;
  const glass = { x: inset, y: inset, w: w - inset * 2, h: h - inset * 2 };
  const scaleStart = inset + glass.w * 0.07;
  const scaleEnd = inset + glass.w * 0.93;
  return {
    fonts,
    inset,
    glass,
    scaleStart,
    scaleEnd,
    xOf: (freq) => scaleStart + ((freq - FREQ_MIN) / (FREQ_MAX - FREQ_MIN)) * (scaleEnd - scaleStart),
    tickTop: h * 0.36,
    bezel: brassBezel(ctx, w, h),
    topShade: linear(ctx, 0, inset, 0, inset + glass.h * 0.18, [css(BLACK, 0.35), TRANSPARENT]),
    reflection: linear(ctx, inset, inset, w * 0.45, h * 0.8, [css(WHITE, 0.22), TRANSPARENT]),
  };
}

/** Backlit glass dial with the needle parked on 100.5 MHz. */
function drawDial(ctx, w, h, c, { glow = 0, drift = 0 }) {
  const { glass, xOf, tickTop, inset } = c;
  const { label, small, station } = c.fonts;
  const g = glow;
  const inkAlpha = 0.35 + 0.65 * g;
  const ink = css(P.ink, inkAlpha);
  const needleX = xOf(STATION_FREQ_MHZ + drift * 0.9);
  const glassRect = (fill) => roundRect(ctx, glass.x, glass.y, glass.w, glass.h, 10, fill);

  roundRect(ctx, 0, 0, w, h, 14, c.bezel);
  glassRect(
    linear(ctx, 0, inset, 0, h - inset, [
      css(mix(P.dialUnlit, P.dialLit, g)),
      css(mix(P.dialUnlitDeep, P.dialLitDeep, g)),
    ]),
  );
  if (g > 0.01) glassRect(radial(ctx, needleX, h / 2, w * 0.45, [css(P.glow, 0.55 * g), TRANSPARENT]));

  line(ctx, c.scaleStart, tickTop, c.scaleEnd, tickTop, ink, 1.5);
  for (let i = 0; i <= 40; i++) {
    const x = xOf(FREQ_MIN + i * 0.5);
    const length = h * (i % 8 === 0 ? 0.26 : i % 2 === 0 ? 0.15 : 0.08);
    line(ctx, x, tickTop, x, tickTop + length, ink, i % 8 === 0 ? 2 : 1);
  }
  for (let f = FREQ_MIN; f <= FREQ_MAX; f += 4) {
    text(ctx, String(f), xOf(f), tickTop - lineHeight(label) - 4, label, ink, 'center');
  }

  const stationX = xOf(STATION_FREQ_MHZ);
  const markerY = tickTop + h * 0.34;
  circle(ctx, stationX, markerY, 3, css(P.needle, inkAlpha));
  // Sits just left of the marker so the needle never crosses it.
  text(ctx, 'KODAIKANAL', stationX - 8, markerY - lineHeight(station) / 2, station, css(P.needle, inkAlpha), 'right');
  const bottom = h - inset - 6 - lineHeight(small);
  text(ctx, 'FM', c.scaleStart, bottom, small, ink);
  text(ctx, 'MHz', c.scaleEnd, bottom, small, ink, 'right');

  const needleTop = inset + 8;
  const needleBottom = h - inset - 8;
  line(ctx, needleX + 2, needleTop, needleX + 2, needleBottom, css(BLACK, 0.3), 3);
  line(ctx, needleX, needleTop, needleX, needleBottom, css(P.needle), 2.5, 'round');

  glassRect(c.topShade);
  glassRect(c.reflection);
}

function prepareEye(ctx, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2;
  const inner = r * 0.78;
  return {
    cx,
    cy,
    r,
    inner,
    bezel: linear(ctx, 0, 0, w, h, [css(P.brassLight), css(P.brassDark)]),
    glow: radial(ctx, cx, cy, inner, [css(P.eyeGreen, 0.3), css(P.eyeGreen)]),
  };
}

// The eye redraws with the audio, so its fixed colours are built once.
const EYE = { shadow: css(BLACK, 0.5), dark: css(P.eyeDark), highlight: css(WHITE, 0.3) };

/** The green "magic eye" tuning tube: the dark wedge narrows as the station locks in. */
function drawEye(ctx, w, h, c, { glow = 0, sweep = 140 }) {
  const { cx, cy, r, inner } = c;
  circle(ctx, cx, cy + 2, r, EYE.shadow);
  circle(ctx, cx, cy, r, c.bezel);
  circle(ctx, cx, cy, inner, EYE.dark);
  if (glow > 0.01) {
    ctx.globalAlpha = glow;
    circle(ctx, cx, cy, inner, c.glow);
    ctx.globalAlpha = 1;
    const start = -90 - sweep / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, inner, rad(start), rad(start + sweep));
    ctx.closePath();
    ctx.fillStyle = EYE.dark;
    ctx.fill();
  }
  circle(ctx, cx, cy, inner * 0.3, '#111111');
  ctx.beginPath();
  ctx.arc(cx, cy, inner - 4, rad(200), rad(270));
  ctx.strokeStyle = EYE.highlight;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function prepareGrille(ctx, w, h, scale) {
  const inset = 6;
  const cloth = { x: inset, y: inset, w: w - inset * 2, h: h - inset * 2 };
  const right = cloth.x + cloth.w;
  const bottom = cloth.y + cloth.h;
  const clip = new Path2D();
  clip.roundRect(cloth.x, cloth.y, cloth.w, cloth.h, 11);
  const warp = new Path2D();
  const weft = new Path2D();
  const threads = new Path2D();
  for (let x = cloth.x; x < right; x += 3) {
    warp.moveTo(x, cloth.y);
    warp.lineTo(x, bottom);
  }
  for (let y = cloth.y; y < bottom; y += 3) {
    weft.moveTo(cloth.x, y);
    weft.lineTo(right, y);
  }
  for (let x = cloth.x + 9; x < right; x += 18) {
    threads.moveTo(x, cloth.y);
    threads.lineTo(x, bottom);
  }
  const cx = cloth.x + cloth.w / 2;
  const cy = cloth.y + cloth.h / 2;
  return {
    badge: font(18 * scale, { weight: 700, italic: true, family: SERIF }),
    cloth,
    clip,
    warp,
    weft,
    threads,
    frame: brassBezel(ctx, w, h),
    cone: radial(ctx, cx, cy, Math.min(cloth.w, cloth.h) * 0.48, [css(BLACK, 0.28), css(BLACK, 0.1), TRANSPARENT]),
    vignette: radial(ctx, cx, cy, Math.max(cloth.w, cloth.h) * 0.7, [TRANSPARENT, css(BLACK, 0.4)]),
  };
}

function drawGrille(ctx, w, h, c) {
  const { cloth } = c;
  if (cloth.w <= 0 || cloth.h <= 0) return;
  roundRect(ctx, 0, 0, w, h, 16, c.frame);
  ctx.save();
  ctx.clip(c.clip);
  ctx.fillStyle = css(P.cloth);
  ctx.fillRect(cloth.x, cloth.y, cloth.w, cloth.h);
  strokePath(ctx, c.warp, css(P.clothDark, 0.45), PX);
  strokePath(ctx, c.weft, css(P.clothDark, 0.3), PX);
  strokePath(ctx, c.threads, css(P.brass, 0.55), 1.5);
  ctx.fillStyle = c.cone;
  ctx.fillRect(cloth.x, cloth.y, cloth.w, cloth.h);
  ctx.fillStyle = c.vignette;
  ctx.fillRect(cloth.x, cloth.y, cloth.w, cloth.h);
  ctx.restore();

  const { badge } = c;
  if (cloth.h < lineHeight(badge) + 16) return;
  ctx.shadowColor = css(BLACK, 0.5);
  ctx.shadowOffsetY = 2 * PX;
  ctx.shadowBlur = 3 * PX;
  text(ctx, 'Hi-Fi', cloth.x + cloth.w - 12, cloth.y + cloth.h - lineHeight(badge) - 8, badge, css(P.brassLight), 'right');
}

function prepareKnob(ctx, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2;
  const hx = cx - r * 0.2;
  const hy = cy - r * 0.26;
  const { brassLight: l, brassDark: d, brass: b } = P;
  return {
    cx,
    cy,
    r,
    hx,
    hy,
    skirt: sweep(ctx, cx, cy, [l, d, b, l, d, b, l].map((c) => css(c))),
    body: radial(ctx, cx - r * 0.3, cy - r * 0.35, r * 0.9, [css(P.bakeliteLight), css(P.bakelite)]),
    face: radial(ctx, cx - r * 0.25, cy - r * 0.3, r * 0.7, [css(P.bakeliteLight), css(P.bakelite)]),
    highlight: radial(ctx, hx, hy, r * 0.32, [css(WHITE, 0.16), TRANSPARENT]),
  };
}

/** Bakelite knob with a brass skirt; turns clockwise to switch on. */
function drawKnob(ctx, w, h, c, { rotation = -50, scale = 1 }) {
  const { cx, cy, r } = c;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);
  circle(ctx, cx, cy + r * 0.08, r * 0.92, css(BLACK, 0.5));
  circle(ctx, cx, cy, r * 0.92, c.skirt);
  strokeCircle(ctx, cx, cy, r * 0.92, css(BLACK, 0.35), 1);
  circle(ctx, cx, cy, r * 0.74, c.body);
  circle(ctx, cx, cy, r * 0.6, c.face);
  // Only the knurling and pointer turn; the light source stays put.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rad(rotation));
  const ridge = css(BLACK, 0.45);
  for (let i = 0; i < 48; i++) {
    const a = (i * 2 * Math.PI) / 48;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    line(ctx, dx * r * 0.62, dy * r * 0.62, dx * r * 0.74, dy * r * 0.74, ridge, 1.5);
  }
  line(ctx, 0, -r * 0.18, 0, -r * 0.55, css(P.brassLight), 4, 'round');
  ctx.restore();
  circle(ctx, c.hx, c.hy, r * 0.32, c.highlight);
}

/** A speaker glyph `size` wide, vertically centred on `y` with its left edge at `x`; `waves` are to be stroked. */
function speakerIcon(x, y, size) {
  const u = size / 24;
  const at = (px, py) => [x + px * u, y + (py - 12) * u];
  const body = new Path2D();
  body.moveTo(...at(3, 9));
  for (const [px, py] of [[7, 9], [12, 4], [12, 20], [7, 15], [3, 15]]) body.lineTo(...at(px, py));
  body.closePath();
  const waves = new Path2D();
  for (const [cx, r] of [[13.5, 4.5], [14.5, 7.5]]) {
    const [ax, ay] = at(cx, 12);
    waves.moveTo(ax + r * u * Math.cos(rad(-60)), ay + r * u * Math.sin(rad(-60)));
    waves.arc(ax, ay, r * u, rad(-60), rad(60));
  }
  return { body, waves };
}

function prepareVolumeBar(ctx, w, h) {
  const frame = 5;
  const well = { x: frame, y: frame, w: w - frame * 2, h: h - frame * 2 };
  const lampH = 14;
  const lampTop = h / 2 - lampH / 2;
  const thumbH = h - frame * 2 - 6;
  const icon = 16;
  const loudX = well.x + well.w - 8 - icon;
  return {
    well,
    lampH,
    lampTop,
    thumbH,
    quiet: speakerIcon(well.x + 8, h / 2, icon).body,
    loud: speakerIcon(loudX, h / 2, icon),
    bezel: brassBezel(ctx, w, h),
    wellFill: linear(ctx, 0, well.y, 0, well.y + well.h, ['#120A05', '#2A1A0E', '#1A0F07']),
    wellShade: linear(ctx, 0, well.y, 0, well.y + 8, [css(BLACK, 0.6), TRANSPARENT]),
    lampLit: linear(ctx, 0, lampTop, 0, lampTop + lampH, [css(P.dialLit), css(P.glow)]),
    thumbFill: radial(ctx, VOLUME_THUMB_W * 0.35, thumbH * 0.25, thumbH * 0.8, [css(P.bakeliteLight), css(P.bakelite)]),
  };
}

/**
 * Brass-framed slot for the volume: a row of amber lamps lit up to the level (`lit`), and a bakelite
 * slider at `at` (0 to 1).
 */
function drawVolumeBar(ctx, w, h, c, { at = 0, lit = 0 }) {
  const { well, lampH, lampTop, thumbH } = c;
  roundRect(ctx, 0, 3, w, h, 12, css(BLACK, 0.45));
  roundRect(ctx, 0, 0, w, h, 12, c.bezel);
  roundRect(ctx, well.x, well.y, well.w, well.h, 8, c.wellFill);
  roundRect(ctx, well.x, well.y, well.w, well.h, 8, c.wellShade);
  const brass = css(P.brass);
  ctx.fillStyle = brass;
  ctx.fill(c.quiet);
  ctx.fill(c.loud.body);
  ctx.lineCap = 'round';
  strokePath(ctx, c.loud.waves, brass, 1.5);

  const pad = VOLUME_BAR_PAD;
  const gap = 3;
  const lampW = (w - pad * 2 - gap * (VOLUME_MAX - 1)) / VOLUME_MAX;
  for (let i = 0; i < VOLUME_MAX; i++) {
    const x = pad + i * (lampW + gap);
    if (i < lit) {
      roundRect(ctx, x - 2, lampTop - 2, lampW + 4, lampH + 4, 4, css(P.glow, 0.3));
      roundRect(ctx, x, lampTop, lampW, lampH, 2, c.lampLit);
    } else {
      roundRect(ctx, x, lampTop, lampW, lampH, 2, css(P.unlitLamp));
    }
  }

  const x = pad + (w - pad * 2) * at;
  ctx.translate(x - VOLUME_THUMB_W / 2, h / 2 - thumbH / 2);
  roundRect(ctx, 0, 3, VOLUME_THUMB_W, thumbH, 8, css(BLACK, 0.6));
  roundRect(ctx, 0, 0, VOLUME_THUMB_W, thumbH, 8, c.thumbFill);
  strokeRoundRect(ctx, 0, 0, VOLUME_THUMB_W, thumbH, 8, css(P.brassDark), 2);
  const mid = VOLUME_THUMB_W / 2;
  for (let k = -2; k <= 2; k++) line(ctx, mid + k * 4, thumbH * 0.2, mid + k * 4, thumbH * 0.8, css(BLACK, 0.4), 1);
  line(ctx, mid, 0, mid, thumbH, css(P.brassLight, 0.85), 2);
}
