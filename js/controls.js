import { clamp } from './draw.js';
import { VOLUME_MAX } from './volume.js';

/** Wires a physical control (knob, tape key): `onPress(down)` follows the finger, `onClick` fires with a haptic tick. */
export function pressable(el, onPress, onClick) {
  el.addEventListener('pointerdown', () => onPress(true));
  for (const e of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(e, () => onPress(false));
  el.addEventListener('click', () => {
    navigator.vibrate?.(8);
    onClick();
  });
}

/**
 * Makes `el` the volume slider. A touch anywhere on it jumps to that point along `track` (whose ends
 * are inset by `pad` px, where the thumb's centre stops), then follows the finger, ticking at each
 * step. Arrow keys step it while focused.
 */
export function volumeSlider(el, track, pad, volume) {
  // Measured once per drag, not on every move.
  let span = null;
  const levelAt = (x) => clamp(Math.round(((x - span.left) / span.width) * VOLUME_MAX), 0, VOLUME_MAX);
  const setTo = (level) => volume.set(level) && navigator.vibrate?.(4);
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    const r = track.getBoundingClientRect();
    span = { left: r.left + pad, width: r.width - pad * 2 };
    setTo(levelAt(e.clientX));
  });
  // Only moves that cross a step count; the rest of a drag changes nothing.
  el.addEventListener('pointermove', (e) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    const level = levelAt(e.clientX);
    if (level !== volume.level) setTo(level);
  });
  const keys = {
    ArrowRight: (l) => l + 1,
    ArrowUp: (l) => l + 1,
    ArrowLeft: (l) => l - 1,
    ArrowDown: (l) => l - 1,
    PageUp: (l) => l + 3,
    PageDown: (l) => l - 3,
    Home: () => 0,
    End: () => VOLUME_MAX,
  };
  el.addEventListener('keydown', (e) => {
    const to = keys[e.key];
    if (!to) return;
    // Keeps the arrows from also switching radios.
    e.preventDefault();
    e.stopPropagation();
    volume.set(to(volume.level));
  });
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', String(VOLUME_MAX));
  const sync = () => {
    el.setAttribute('aria-valuenow', String(volume.level));
    el.setAttribute('aria-valuetext', volume.level ? `${volume.level} of ${VOLUME_MAX}` : 'Muted');
  };
  volume.addEventListener('input', sync);
  sync();
}
