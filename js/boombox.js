import { Spring, Tween, Wave } from './anim.js';
import {
  BLACK, MONO, PX, TRANSPARENT, WHITE, circle, clamp, css, font, layer, line, lineHeight, linear, measure, mix,
  radial, rgb, roundRect, seeded, strokeCircle, strokePath, strokeRoundRect, sweep, text,
} from './draw.js';
import { pressable, volumeSlider } from './controls.js';
import { BANDS } from './spectrum.js';
import { STATION_FREQ_MHZ, isOn } from './station.js';
import { VOLUME_MAX } from './volume.js';

const B = {
  skyTop: rgb(0x0d0628),
  skyMid: rgb(0x3a0f4f),
  skyBottom: rgb(0x12051e),
  neon: rgb(0xff3ea5),
  silverLight: rgb(0xf1f3f5),
  silver: rgb(0xc4c9cf),
  silverDark: rgb(0x8a9098),
  chromeDark: rgb(0x5a6068),
  panel: rgb(0x161616),
  ink: rgb(0x24282c),
  mesh: rgb(0x383838),
  vfd: rgb(0x41f5e3),
  vfdGhost: rgb(0x0b1e1e),
  vfdGlass: rgb(0x040a0a),
  amber: rgb(0xffa030),
  ledOn: rgb(0xff3b30),
  ledOff: rgb(0x4a1512),
  stripes: [rgb(0xe53935), rgb(0xfb8c00), rgb(0xfdd835)],
  keyPlay: rgb(0x2e9e4f),
  keyStop: rgb(0xd32f2f),
};

const STATUS = {
  off: 'Press play',
  tuning: 'Tuning…',
  live: '● On air',
  error: 'No signal · press play',
};

/** The station frequency as the display shows it: digits, with the decimal point after DIAL_DOT_AFTER. */
const DIAL_TEXT = STATION_FREQ_MHZ.toFixed(1);
const DIAL_DIGITS = DIAL_TEXT.replace('.', '');
const DIAL_DOT_AFTER = DIAL_TEXT.indexOf('.') - 1;
const ANALYSER_BLOCKS = 8;
const KEY_TRAVEL = 6;
/** How long the display shows the volume after it last changed. */
const VOLUME_SHOWN_MS = 1400;
const FADER_CAP_W = 30;

const SEVEN_SEGMENT = {
  0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg',
  5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
};

const vfdColor = (level) => css(mix(B.vfdGhost, B.vfd, level));

/** A 1980s silver boombox. PLAY latches down while the radio is on; STOP releases it. */
export function createBoombox(page, { radio, volume, wake }) {
  const $ = (sel) => page.querySelector(sel);
  const $$ = (sel) => [...page.querySelectorAll(sel)];
  const power = new Tween(0, 500);
  const time = new Wave(4000, 'restart');
  const blink = new Wave(300, 'reverse');
  const faderAt = new Tween(volume.fraction, 120);
  const volumeShown = new Tween(0, 150);
  let volumeTimer = 0;

  layer($('.backdrop'), drawBackdrop, { prepare: prepareBackdrop });
  layer($('.handle canvas'), drawHandle, { prepare: prepareHandle });
  layer($('.metal'), drawMetal, { prepare: prepareMetal });
  layer($('.stripes'), drawStripes);
  layer($('.vfd-glass'), drawGlass, { prepare: (ctx, w, h, scale) => vfdLayout(w, h, scale).glass });
  layer($('.mesh'), drawMesh, { prepare: prepareMesh });
  for (const woofer of $$('.woofer')) {
    layer(woofer.querySelector('.frame'), drawWooferFrame, { prepare: prepareWoofer });
    layer(woofer.querySelector('.cone'), drawCone, { prepare: prepareWoofer });
  }
  const face = layer($('.vfd-face'), drawFace, { prepare: prepareFace });
  const meters = layer($('.vfd-meters'), drawMeters, { prepare: (ctx, w, h, scale) => vfdLayout(w, h, scale) });
  const led = layer($('.led canvas'), drawLed, { prepare: prepareLed, bleed: 8 });
  const fader = layer($('.fader canvas'), drawFader, { prepare: prepareFader });
  const cones = $$('.woofer .cone');
  const status = $('.vfd-status');
  let shownKick = 0;
  let shownGlow = -1;

  const keys = [
    { el: $('.key.play'), accent: css(B.keyPlay), latched: () => isOn(radio.phase), onClick: () => radio.play() },
    { el: $('.key.stop'), accent: css(B.keyStop), latched: () => false, onClick: () => radio.pause() },
  ];
  for (const k of keys) {
    Object.assign(k, { pressed: false, depth: new Spring(0, { stiffness: 10000 }), shownDepth: -1 });
    k.label = k.el.querySelector('.key-face');
    k.layer = layer(k.el.querySelector('canvas'), (ctx, w, h, c, { depth = 0 }) => drawKey(ctx, w, h, k.accent, depth));
    pressable(
      k.el,
      (down) => {
        k.pressed = down;
        wake();
      },
      k.onClick,
    );
  }

  // The display shows the level for a moment after each touch of the volume, even at an end.
  volume.addEventListener('input', () => {
    const now = performance.now();
    faderAt.set(volume.fraction, now);
    volumeShown.set(1, now);
    clearTimeout(volumeTimer);
    volumeTimer = setTimeout(() => {
      volumeShown.set(0, performance.now());
      wake();
    }, VOLUME_SHOWN_MS);
    wake();
  });
  // The cap's centre stops half a cap in from each end of the slot.
  volumeSlider($('.fader'), $('.fader-slot'), FADER_CAP_W / 2, volume);

  return {
    setPhase(now) {
      const { phase } = radio;
      power.set(isOn(phase) ? 1 : 0, now);
      time.setActive(isOn(phase), now);
      blink.setActive(phase === 'tuning', now);
    },

    /** Advances animations; redraws when `visible`. True while something is still moving. */
    frame(now, dt, spectrum, visible) {
      let moving = [power.step(now), faderAt.step(now), volumeShown.step(now)].some(Boolean);
      const statusText = volumeShown.to ? (volume.level ? 'Volume' : 'Muted') : STATUS[radio.phase];
      if (status.textContent !== statusText) status.textContent = statusText;
      for (const k of keys) {
        k.depth.set(k.pressed ? 1 : k.latched() ? 0.75 : 0);
        moving = k.depth.step(dt) || moving;
      }
      if (!visible) return moving;

      const live = radio.phase === 'live';
      const tuning = radio.phase === 'tuning';
      const p = power.value;
      const t = time.at(now);
      const b = Math.abs(blink.at(now));
      const v = volumeShown.value;
      face.update({ power: p, digits: p * (tuning ? 0.35 + 0.65 * b : 1), stereo: live ? p : 0, vol: v, level: volume.level });
      const sweepColumn = Math.floor(t * BANDS * 4) % BANDS;
      // The analyser becomes a level meter while the volume shows.
      const filled = volume.fraction * BANDS;
      const levels =
        v > 0
          ? Array.from({ length: BANDS }, (_, col) => clamp(Math.ceil((filled - col) * ANALYSER_BLOCKS), 0, ANALYSER_BLOCKS))
          : Array.from(spectrum.bands, (s, col) =>
              live ? clamp(Math.floor(s * ANALYSER_BLOCKS), 0, ANALYSER_BLOCKS) : tuning && col === sweepColumn ? 3 : 0,
            );
      meters.update({
        power: p,
        vol: v,
        signal: live ? (Math.sin(2 * Math.PI * 3 * t) > 0.8 ? 4 : 5) : tuning ? Math.floor(t * 20) % 6 : 0,
        levels,
      });
      fader.update({ at: faderAt.value });
      led.update({ lit: live ? 1 : tuning ? b : 0 });

      // Cones punch out on real bass hits. A CSS transform, so nothing repaints.
      const kick = Math.round(spectrum.kick * 200) / 200;
      if (kick !== shownKick) {
        shownKick = kick;
        for (const cone of cones) cone.style.transform = kick ? `scale(${1 + 0.04 * kick})` : '';
      }
      for (const k of keys) {
        const d = k.depth.value;
        k.layer.update({ depth: d });
        if (d !== k.shownDepth) {
          k.shownDepth = d;
          k.label.style.transform = `translateY(${d * KEY_TRAVEL}px)`;
        }
      }
      // Standby glow while off so the "press play" hint stays readable.
      const glow = Math.max(p, v);
      if (glow !== shownGlow) {
        shownGlow = glow;
        status.style.opacity = String(0.55 + 0.45 * glow);
      }
      return moving;
    },
  };
}

/** Neon perspective grid under a synthwave sunset. */
function prepareBackdrop(ctx, w, h) {
  const horizon = h * 0.62;
  const grid = new Path2D();
  for (let i = -12; i <= 12; i++) {
    grid.moveTo(w / 2 + i * w * 0.02, horizon);
    grid.lineTo(w / 2 + i * w * 0.18, h);
  }
  for (let k = 1; k <= 12; k++) {
    const y = horizon + (h - horizon) * (k / 12) ** 2;
    grid.moveTo(0, y);
    grid.lineTo(w, y);
  }
  return {
    horizon,
    grid,
    sky: linear(ctx, 0, 0, 0, h, [css(B.skyTop), css(B.skyMid), css(B.skyBottom)]),
    sun: radial(ctx, w / 2, horizon, w * 0.7, [css(B.neon, 0.35), TRANSPARENT]),
  };
}

function drawBackdrop(ctx, w, h, c) {
  ctx.fillStyle = c.sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = c.sun;
  ctx.fillRect(0, 0, w, h);
  line(ctx, 0, c.horizon, w, c.horizon, css(B.neon, 0.6), 1.5);
  strokePath(ctx, c.grid, css(B.neon, 0.28), 1);
}

function prepareMetal(ctx, w, h) {
  const random = seeded(1984);
  const light = new Path2D();
  const dark = new Path2D();
  for (let y = 0; y < h; y += 1.5) {
    const path = random() < 0.5 ? light : dark;
    path.moveTo(0, y);
    path.lineTo(w, y);
  }
  return {
    light,
    dark,
    base: linear(ctx, 0, 0, 0, h, [css(B.silverLight), css(B.silver), css(B.silverDark)]),
    sheen: linear(ctx, 0, 0, w, h, [TRANSPARENT, css(WHITE, 0.25), TRANSPARENT]),
    bevel: linear(ctx, 0, 0, 0, h, [css(WHITE, 0.9), css(BLACK, 0.4)]),
  };
}

function drawMetal(ctx, w, h, c) {
  ctx.fillStyle = c.base;
  ctx.fillRect(0, 0, w, h);
  strokePath(ctx, c.light, css(WHITE, 0.22), PX);
  strokePath(ctx, c.dark, css(BLACK, 0.05), PX);
  ctx.fillStyle = c.sheen;
  ctx.fillRect(0, 0, w, h);
  strokeRoundRect(ctx, 0, 0, w, h, 24, c.bevel, 2);
}

function prepareHandle(ctx, w, h) {
  const barH = h * 0.36;
  const postW = w * 0.08;
  const grip = { x: w * 0.22, y: barH * 0.14, w: w * 0.56, h: barH * 0.72 };
  const ridges = new Path2D();
  for (let x = grip.x + 4; x < grip.x + grip.w - 4; x += 4) {
    ridges.moveTo(x, grip.y);
    ridges.lineTo(x, grip.y + grip.h);
  }
  const post = (x) => linear(ctx, x, 0, x + postW, 0, [css(B.chromeDark), css(B.silverLight), css(B.silverDark)]);
  return {
    barH,
    postW,
    grip,
    ridges,
    posts: [0, w - postW].map((x) => ({ x, fill: post(x) })),
    chrome: linear(ctx, 0, 0, 0, barH, [css(B.silverLight), css(B.silverDark), css(B.silver), css(B.chromeDark)]),
  };
}

function drawHandle(ctx, w, h, c) {
  for (const { x, fill } of c.posts) roundRect(ctx, x, c.barH * 0.5, c.postW, h - c.barH * 0.5, c.postW / 3, fill);
  roundRect(ctx, 0, 0, w, c.barH, c.barH / 2, c.chrome);
  roundRect(ctx, c.grip.x, c.grip.y, c.grip.w, c.grip.h, c.grip.h / 2, '#1C1C1C');
  strokePath(ctx, c.ridges, '#000', 1);
}

/** A chunky cassette-deck piano key that physically travels when pressed or latched. */
function drawKey(ctx, w, h, accent, depth) {
  const side = 2;
  const faceH = h - KEY_TRAVEL;
  const top = depth * KEY_TRAVEL;
  roundRect(ctx, 0, 0, w, h, 6, '#0E0E0E');
  roundRect(ctx, side, top + faceH * 0.5, w - side * 2, h - top - faceH * 0.5 - PX, 6, '#3A3F45');
  roundRect(
    ctx, side, top, w - side * 2, faceH, 6,
    linear(ctx, 0, top, 0, top + faceH, [
      css(mix(B.silverLight, B.silver, depth)),
      css(mix(B.silver, B.silverDark, depth)),
    ]),
  );
  ctx.fillStyle = accent;
  ctx.fillRect(side + 8, top + 4, w - side * 2 - 16, 3);
}

function drawStripes(ctx, w, h) {
  const third = w / 3;
  const slant = h * 0.5;
  B.stripes.forEach((color, i) => {
    ctx.beginPath();
    ctx.moveTo(i * third + slant, 0);
    ctx.lineTo((i + 1) * third + slant * 0.4, 0);
    ctx.lineTo((i + 1) * third - slant * 0.6, h);
    ctx.lineTo(i * third, h);
    ctx.closePath();
    ctx.fillStyle = css(color);
    ctx.fill();
  });
}

function prepareLed(ctx, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2;
  return { cx, cy, r, halo: radial(ctx, cx, cy, r * 1.6, [css(B.ledOn, 0.5), TRANSPARENT]) };
}

function drawLed(ctx, w, h, { cx, cy, r, halo }, { lit = 0 }) {
  if (lit > 0) {
    ctx.globalAlpha = lit;
    circle(ctx, cx, cy, r * 1.6, halo);
    ctx.globalAlpha = 1;
  }
  circle(ctx, cx, cy, r, '#222222');
  circle(ctx, cx, cy, r * 0.78, css(mix(B.ledOff, B.ledOn, lit)));
  circle(ctx, cx - r * 0.25, cy - r * 0.25, r * 0.22, css(WHITE, 0.45));
}

/** Geometry shared by the display's layers, derived from its size. Rects are [x, y, w, h]. */
function vfdLayout(w, h, scale) {
  const inset = 6;
  const glass = { x: inset, y: inset, w: w - inset * 2, h: h - inset * 2 };
  const indicatorTop = glass.y + 6 * scale;
  const digitH = h * 0.38;
  const digitW = digitH * 0.55;
  const digitGap = digitW * 0.32;
  const digitsWidth = digitW * DIAL_DIGITS.length + digitGap * (DIAL_DIGITS.length - 1);
  const barsRight = glass.x + glass.w - 10 * scale;
  const barsBottom = indicatorTop + 12 * scale;
  const analyserBottom = h * 0.8;
  const analyserLeft = glass.x + glass.w * 0.1;
  const columnW = (glass.w * 0.8) / BANDS;
  const blockH = (analyserBottom - h * 0.64) / ANALYSER_BLOCKS;
  return {
    glass,
    small: font(9 * scale, { weight: 700, family: MONO, spacing: scale }),
    unit: font(11 * scale, { weight: 700, family: MONO, spacing: scale }),
    indicatorTop,
    digitH,
    digitW,
    digitGap,
    digitsWidth,
    digitsLeft: (w - digitsWidth) / 2 - digitW * 0.3,
    digitsTop: h * 0.2,
    /** The five signal-strength bars, shortest first. */
    bars: Array.from({ length: 5 }, (_, i) => {
      const barH = (i + 1) * 2.4 * scale;
      return [barsRight - (5 - i) * 6 * scale, barsBottom - barH, 4 * scale, barH];
    }),
    /** Analyser blocks per band, bottom first. */
    blocks: Array.from({ length: BANDS }, (_, col) =>
      Array.from({ length: ANALYSER_BLOCKS }, (_, b) => [
        analyserLeft + col * columnW + 1,
        analyserBottom - (b + 1) * blockH + 1,
        columnW - 2,
        blockH - 1,
      ]),
    ),
  };
}

function addSevenSegment(path, segments, left, top, w, h) {
  const t = w * 0.2;
  const gap = t * 0.18;
  const skew = 0.12;
  const p = (x, y) => [left + x + (h - y) * skew, top + y];
  const polygon = (points) => {
    path.moveTo(...points[0]);
    for (const pt of points.slice(1)) path.lineTo(...pt);
    path.closePath();
  };
  const horizontal = (yc) => {
    const x0 = t / 2 + gap;
    const x1 = w - t / 2 - gap;
    polygon([p(x0, yc), p(x0 + t / 2, yc - t / 2), p(x1 - t / 2, yc - t / 2), p(x1, yc), p(x1 - t / 2, yc + t / 2), p(x0 + t / 2, yc + t / 2)]);
  };
  const vertical = (xc, y0, y1) =>
    polygon([p(xc, y0), p(xc + t / 2, y0 + t / 2), p(xc + t / 2, y1 - t / 2), p(xc, y1), p(xc - t / 2, y1 - t / 2), p(xc - t / 2, y0 + t / 2)]);
  const draw = {
    a: () => horizontal(t / 2),
    g: () => horizontal(h / 2),
    d: () => horizontal(h - t / 2),
    f: () => vertical(t / 2, t / 2 + gap, h / 2 - gap),
    b: () => vertical(w - t / 2, t / 2 + gap, h / 2 - gap),
    e: () => vertical(t / 2, h / 2 + gap, h - t / 2 - gap),
    c: () => vertical(w - t / 2, h / 2 + gap, h - t / 2 - gap),
  };
  for (const segment of segments) draw[segment]();
}

function prepareFace(ctx, w, h, scale) {
  const l = vfdLayout(w, h, scale);
  const lit = new Path2D();
  const ghost = new Path2D();
  [...DIAL_DIGITS].forEach((ch, i) => {
    const left = l.digitsLeft + i * (l.digitW + l.digitGap);
    addSevenSegment(ghost, 'abcdefg', left, l.digitsTop, l.digitW, l.digitH);
    addSevenSegment(lit, SEVEN_SEGMENT[ch], left, l.digitsTop, l.digitW, l.digitH);
  });
  // The level in the two right-hand digits, for every step, built once.
  const volumeDigits = Array.from({ length: VOLUME_MAX + 1 }, (_, level) => {
    const path = new Path2D();
    [...String(level).padStart(2, '0')].forEach((ch, j) => {
      const left = l.digitsLeft + (DIAL_DIGITS.length - 2 + j) * (l.digitW + l.digitGap);
      addSevenSegment(path, SEVEN_SEGMENT[ch], left, l.digitsTop, l.digitW, l.digitH);
    });
    return path;
  });
  const dot = l.digitW * 0.2;
  const dotX = l.digitsLeft + (DIAL_DOT_AFTER + 1) * l.digitW + (DIAL_DOT_AFTER + 0.5) * l.digitGap - dot / 2;
  const dotY = l.digitsTop + l.digitH - dot;
  lit.rect(dotX, dotY, dot, dot);
  ghost.rect(dotX, dotY, dot, dot);
  // Unlit meter segments never change, so they live on this layer as one path.
  for (const r of [...l.bars, ...l.blocks.flat()]) ghost.rect(...r);
  const fmX = l.glass.x + 10;
  return {
    ...l,
    lit,
    ghost,
    volumeDigits,
    fmX,
    stereoX: fmX + measure(ctx, 'FM', l.small) + 8,
    mhzX: l.digitsLeft + l.digitsWidth + l.digitW * 0.45,
    mhzTop: l.digitsTop + l.digitH - lineHeight(l.unit),
  };
}

/** Vacuum-fluorescent display face: digits and indicators. The meters are a separate layer. */
function drawFace(ctx, w, h, c, { power = 0, digits = 0, stereo = 0, vol = 0, level = 0 }) {
  const { glass } = c;
  roundRect(ctx, 0, 0, w, h, 12, '#0A0A0A');
  strokeRoundRect(ctx, 0.75, 0.75, w - 1.5, h - 1.5, 12, css(B.chromeDark), 1.5);
  roundRect(ctx, glass.x, glass.y, glass.w, glass.h, 8, css(B.vfdGlass));
  text(ctx, 'FM', c.fmX, c.indicatorTop, c.small, vfdColor(power));
  text(ctx, 'STEREO', c.stereoX, c.indicatorTop, c.small, vfdColor(stereo));
  ctx.fillStyle = css(B.vfdGhost);
  ctx.fill(c.ghost);
  // While the volume shows, it replaces the frequency, lit even when the radio is off.
  litDigits(ctx, c.lit, digits * (1 - vol));
  // VOL takes the MHz label's place, so the two crossfade instead of overlapping.
  ctx.globalAlpha = 1 - vol;
  text(ctx, 'MHz', c.mhzX, c.mhzTop, c.unit, vfdColor(power));
  ctx.globalAlpha = 1;
  if (vol > 0.01) {
    litDigits(ctx, c.volumeDigits[level], vol);
    ctx.globalAlpha = vol;
    text(ctx, 'VOL', c.mhzX, c.mhzTop, c.unit, vfdColor(vol));
  }
  ctx.globalAlpha = 1;
}

/** Glowing seven-segment digits at `level` brightness. */
function litDigits(ctx, path, level) {
  if (level <= 0.01) return;
  ctx.strokeStyle = css(B.vfd, 0.3 * level);
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.stroke(path);
  ctx.fillStyle = vfdColor(level);
  ctx.fill(path);
}

/**
 * Lit signal bars and analyser blocks, batched into a few fills. The top two rows glow amber,
 * except while the analyser shows the volume (`vol`).
 */
function drawMeters(ctx, w, h, l, { power = 0, signal = 0, levels = [], vol = 0 }) {
  const bars = new Path2D();
  const normal = new Path2D();
  const peak = new Path2D();
  for (let i = 0; i < signal; i++) bars.rect(...l.bars[i]);
  levels.forEach((n, col) => {
    for (let b = 0; b < n; b++) (!vol && b >= ANALYSER_BLOCKS - 2 ? peak : normal).rect(...l.blocks[col][b]);
  });
  ctx.fillStyle = vfdColor(power);
  ctx.fill(bars);
  ctx.fillStyle = vfdColor(vol || power);
  ctx.fill(normal);
  ctx.fillStyle = css(mix(B.vfdGhost, B.amber, power));
  ctx.fill(peak);
}

function drawGlass(ctx, w, h, glass) {
  const reflection = linear(ctx, glass.x, glass.y, glass.x + glass.w / 2, glass.y + glass.h, [css(WHITE, 0.08), TRANSPARENT]);
  roundRect(ctx, glass.x, glass.y, glass.w, glass.h, 8, reflection);
}

/** The fader's slot, tick scale and MIN/MAX labels. */
function prepareFader(ctx, w, h) {
  const capH = 26;
  const pad = FADER_CAP_W / 2;
  const slotY = 14;
  const slotH = 7;
  const tickTop = slotY + capH / 2 + 2;
  const ticks = new Path2D();
  for (let i = 0; i <= VOLUME_MAX; i++) {
    const x = pad + ((w - pad * 2) * i) / VOLUME_MAX;
    const major = i === 0 || i === VOLUME_MAX || i === Math.floor(VOLUME_MAX / 2);
    ticks.moveTo(x, tickTop);
    ticks.lineTo(x, tickTop + (major ? 6 : 3));
  }
  return {
    capH,
    pad,
    slotY,
    slotH,
    ticks,
    labelTop: tickTop + 7,
    label: font(8, { weight: 700, italic: true, spacing: 1 }),
    chrome: linear(ctx, 0, slotY - capH / 2, 0, slotY + capH / 2, [css(WHITE), css(B.silver), css(B.silverDark)]),
  };
}

/** Draws the fader with its chrome cap at `at` (0 to 1). */
function drawFader(ctx, w, h, c, { at = 0 }) {
  const { capH, pad, slotY, slotH } = c;
  const ink = css(B.ink);
  roundRect(ctx, 0, slotY - slotH / 2 + PX, w, slotH, slotH / 2, css(WHITE));
  roundRect(ctx, 0, slotY - slotH / 2, w, slotH, slotH / 2, '#0D0D0D');
  ctx.globalAlpha = 0.7;
  strokePath(ctx, c.ticks, ink, 1);
  ctx.globalAlpha = 1;
  text(ctx, 'MIN', 0, c.labelTop, c.label, ink);
  text(ctx, 'MAX', w, c.labelTop, c.label, ink, 'right');

  const x = pad + (w - pad * 2) * at;
  const left = x - FADER_CAP_W / 2;
  const top = slotY - capH / 2;
  roundRect(ctx, left, top + 3, FADER_CAP_W, capH, 4, css(BLACK, 0.35));
  roundRect(ctx, left, top, FADER_CAP_W, capH, 4, c.chrome);
  strokeRoundRect(ctx, left, top, FADER_CAP_W, capH, 4, css(B.chromeDark), PX);
  // Grip ridges either side of the neon pointer line.
  for (const k of [-3, -2, 2, 3]) {
    const rx = x + k * 3;
    line(ctx, rx, top + 5, rx, top + capH - 5, css(BLACK, 0.3), 1);
    line(ctx, rx + 1, top + 5, rx + 1, top + capH - 5, css(WHITE, 0.7), 1);
  }
  line(ctx, x, top + 3, x, top + capH - 3, css(B.neon), 2);
}

/** Perforated black panel behind the twin woofers. */
function prepareMesh(ctx, w, h) {
  const step = 6;
  const holes = new Path2D();
  for (let y = step / 2, row = 0; y < h; y += step * 0.87, row++) {
    for (let x = row % 2 === 0 ? step / 2 : step; x < w; x += step) {
      holes.moveTo(x + 1, y);
      holes.arc(x, y, 1, 0, 2 * Math.PI);
    }
  }
  return { holes, bevel: linear(ctx, 0, 0, 0, h, [css(BLACK), css(WHITE, 0.5)]) };
}

function drawMesh(ctx, w, h, c) {
  roundRect(ctx, 0, 0, w, h, 16, css(B.panel));
  ctx.fillStyle = css(B.mesh);
  ctx.fill(c.holes);
  strokeRoundRect(ctx, 0, 0, w, h, 16, c.bevel, 2);
}

/** One woofer, centred in its canvas. CSS places the woofers: side by side on phones, at the ends on desktop. */
function prepareWoofer(ctx, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const r = (Math.min(w, h) / 2) * 0.86;
  const { silverLight: l, silverDark: d, chromeDark: k } = B;
  return {
    cx,
    cy,
    r,
    ring: sweep(ctx, cx, cy, [l, d, l, k, l].map((c) => css(c))),
    surround: radial(ctx, cx, cy, r * 0.86, [[0, '#0C0C0C'], [0.8, '#0C0C0C'], [0.9, '#3A3A3A'], [1, '#0C0C0C']]),
    cone: radial(ctx, cx, cy, r * 0.72, ['#474747', '#151515']),
    cap: radial(ctx, cx - r * 0.06, cy - r * 0.08, r * 0.26, ['#FFFFFF', css(d), css(k)]),
  };
}

/** The fixed part: chrome ring, rubber surround and screws. */
function drawWooferFrame(ctx, w, h, c) {
  const { cx, cy, r } = c;
  circle(ctx, cx, cy + 3, r * 1.02, css(BLACK, 0.6));
  circle(ctx, cx, cy, r, c.ring);
  circle(ctx, cx, cy, r * 0.86, '#0B0B0B');
  circle(ctx, cx, cy, r * 0.84, c.surround);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    circle(ctx, cx + Math.cos(a) * r * 0.93, cy + Math.sin(a) * r * 0.93, 2.5, css(B.chromeDark));
  }
}

/** The moving part: cone, ridges and dust cap, scaled by CSS with the bass. */
function drawCone(ctx, w, h, c) {
  const { cx, cy, r } = c;
  circle(ctx, cx, cy, r * 0.72, c.cone);
  for (const k of [0.38, 0.5, 0.62]) strokeCircle(ctx, cx, cy, r * k, css(WHITE, 0.06), 1);
  circle(ctx, cx, cy, r * 0.24, c.cap);
}
