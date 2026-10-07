import { clamp } from './draw.js';
import { load, save } from './storage.js';

const KEY = 'volume_level';

/** Volume steps, as many as an Android phone's media volume has. */
export const VOLUME_MAX = 15;

/** iPhone and iPad ignore a page's volume: only the side buttons set it. */
function canSetVolume() {
  const probe = new Audio();
  probe.volume = 0.5;
  return probe.volume === 0.5;
}

/**
 * The radio's volume in steps from 0 to VOLUME_MAX, shared by both designs and remembered between
 * visits. An 'input' event fires on every `set`, even one already at an end, so a design can show
 * the level whenever someone reaches for the volume.
 */
export class Volume extends EventTarget {
  adjustable = canSetVolume();
  level = VOLUME_MAX;
  #radio;

  constructor(radio) {
    super();
    this.#radio = radio;
    const saved = load(KEY);
    const n = Number(saved);
    if (saved !== null && Number.isInteger(n)) this.level = clamp(n, 0, VOLUME_MAX);
    if (this.adjustable) radio.setVolume(this.#gain());
  }

  /** Moves to `level`, clamped to the scale. True if it changed. */
  set(level) {
    if (!this.adjustable) return false;
    const target = clamp(Math.round(level), 0, VOLUME_MAX);
    const changed = target !== this.level;
    if (changed) {
      this.level = target;
      this.#radio.setVolume(this.#gain());
      save(KEY, String(target));
    }
    this.dispatchEvent(new Event('input'));
    return changed;
  }

  /** The level as a fraction of the scale, 0 to 1. */
  get fraction() {
    return this.level / VOLUME_MAX;
  }

  step(delta) {
    return this.set(this.level + delta);
  }

  // Squared, so each step sounds about as big as the last, like a phone's volume steps.
  #gain() {
    return this.fraction ** 2;
  }
}
