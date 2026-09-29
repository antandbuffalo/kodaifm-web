function cubicBezier(x1, y1, x2, y2) {
  const curve = (a, b) => (t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  const x = curve(x1, x2);
  const y = curve(y1, y2);
  return (progress) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let t = progress;
    for (let i = 0; i < 20; i++) {
      t = (lo + hi) / 2;
      if (x(t) < progress) lo = t;
      else hi = t;
    }
    return y(t);
  };
}

// Material easing curves, as used by the Android app.
const FastOutSlowIn = cubicBezier(0.4, 0, 0.2, 1);
export const LinearOutSlowIn = cubicBezier(0, 0, 0.2, 1);

/** Eases to a target over a fixed duration, restarting from the current value when retargeted. */
export class Tween {
  constructor(value, durationMs, easing = FastOutSlowIn) {
    Object.assign(this, { value, from: value, to: value, start: 0, durationMs, easing });
  }

  set(to, now) {
    if (to === this.to) return;
    this.from = this.value;
    this.to = to;
    this.start = now;
  }

  /** Advances to `now`; true while still moving. */
  step(now) {
    if (this.value === this.to) return false;
    const t = Math.min(1, (now - this.start) / this.durationMs);
    this.value = t >= 1 ? this.to : this.from + (this.to - this.from) * this.easing(t);
    return t < 1;
  }
}

/** A damped spring (unit mass), like Compose's spring(). */
export class Spring {
  constructor(value, { stiffness = 1500, dampingRatio = 1, threshold = 0.001 } = {}) {
    Object.assign(this, { value, target: value, velocity: 0, stiffness, dampingRatio, threshold });
  }

  set(target) {
    this.target = target;
  }

  /** Advances by `dt` seconds; true while still moving. */
  step(dt) {
    if (this.value === this.target && this.velocity === 0) return false;
    const damping = 2 * this.dampingRatio * Math.sqrt(this.stiffness);
    const n = Math.max(1, Math.ceil(dt / 0.002));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.velocity += (-this.stiffness * (this.value - this.target) - damping * this.velocity) * h;
      this.value += this.velocity * h;
    }
    if (Math.abs(this.value - this.target) < this.threshold && Math.abs(this.velocity) < this.threshold * 10) {
      this.value = this.target;
      this.velocity = 0;
      return false;
    }
    return true;
  }
}

/**
 * A repeating wave that reads 0 while inactive. 'reverse' swings -1..1 and back with
 * FastOutSlowIn easing each way; 'restart' is a 0..1 sawtooth.
 */
export class Wave {
  constructor(periodMs, mode) {
    Object.assign(this, { periodMs, mode, active: false, start: 0 });
  }

  setActive(active, now) {
    if (active && !this.active) this.start = now;
    this.active = active;
  }

  at(now) {
    if (!this.active) return 0;
    const cycles = Math.max(0, now - this.start) / this.periodMs;
    if (this.mode === 'restart') return cycles % 1;
    const k = cycles % 2;
    return -1 + 2 * FastOutSlowIn(k <= 1 ? k : 2 - k);
  }
}
