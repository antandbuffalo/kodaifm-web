/** Wires a physical control (knob, tape key): `onPress(down)` follows the finger, `onClick` fires with a haptic tick. */
export function pressable(el, onPress, onClick) {
  el.addEventListener('pointerdown', () => onPress(true));
  for (const e of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(e, () => onPress(false));
  el.addEventListener('click', () => {
    navigator.vibrate?.(8);
    onClick();
  });
}
