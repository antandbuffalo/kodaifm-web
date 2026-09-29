import { clamp } from './draw.js';

export const BANDS = 14;

// Same analysis as the Android app: 2048-point FFT, 14 log-spaced bands from 60 Hz to 16 kHz.
const FFT_SIZE = 2048;
const MIN_HZ = 60;
const MAX_HZ = 16000;
const FLOOR_DB = -66;
const CEILING_DB = -12;
/** Standard analyser tilt: real audio loses energy with frequency, so lift highs per octave. */
const TILT_DB_PER_OCTAVE = 3;
const TILT_PIVOT_HZ = 1000;
/**
 * Web Audio scales bins by 1/N under a Blackman window (coherent gain 0.42), so a full-scale sine
 * reads about -13.6 dB. The Android scale puts it at 0 dB; this lines the two up.
 */
const WEB_AUDIO_GAIN_DB = 20 * Math.log10(1 / (0.5 * 0.42));

const bandIndexOf = (hz) =>
  clamp(Math.floor((Math.log(hz / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ)) * BANDS), 0, BANDS - 1);
const normalizeDb = (db) => clamp((db - FLOOR_DB) / (CEILING_DB - FLOOR_DB));

/** Reads the playing audio's bands and loudness from a Web Audio AnalyserNode. */
export class AnalyserFeed {
  constructor(analyser) {
    const { sampleRate } = analyser.context;
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    this.analyser = analyser;
    this.freq = new Float32Array(analyser.frequencyBinCount);
    this.wave = new Float32Array(FFT_SIZE);
    const binHz = sampleRate / FFT_SIZE;
    const top = Math.min(MAX_HZ, sampleRate / 2);
    this.edges = Array.from({ length: BANDS + 1 }, (_, i) =>
      clamp(Math.floor((MIN_HZ * (top / MIN_HZ) ** (i / BANDS)) / binHz), 1, FFT_SIZE / 2),
    );
    this.tilt = Array.from(
      { length: BANDS },
      (_, b) => TILT_DB_PER_OCTAVE * Math.log2((Math.sqrt(this.edges[b] * this.edges[b + 1]) * binHz) / TILT_PIVOT_HZ),
    );
    this.frame = { bands: new Float32Array(BANDS), level: 0 };
  }

  read() {
    this.analyser.getFloatFrequencyData(this.freq);
    this.analyser.getFloatTimeDomainData(this.wave);
    for (let b = 0; b < BANDS; b++) {
      const from = this.edges[b];
      const to = Math.max(this.edges[b + 1], from + 1);
      let peak = -Infinity;
      for (let k = from; k < to; k++) peak = Math.max(peak, this.freq[k]);
      this.frame.bands[b] = normalizeDb(peak + WEB_AUDIO_GAIN_DB + this.tilt[b]);
    }
    let energy = 0;
    for (const s of this.wave) energy += s * s;
    this.frame.level = normalizeDb(20 * Math.log10(Math.sqrt(energy / FFT_SIZE) + 1e-9) + 3);
    return this.frame;
  }
}

/** Stand-in motion for browsers that can't analyse the stream (iPhone and iPad Safari). */
export class SimulatedFeed {
  frame = { bands: new Float32Array(BANDS), level: 0 };

  read(now) {
    const t = now / 1000;
    const beat = Math.max(0, Math.sin(t * Math.PI * 2 * 1.9)) ** 8;
    let sum = 0;
    for (let i = 0; i < BANDS; i++) {
      const wobble = Math.sin(t * (1.1 + i * 0.43) + i * 1.7) * Math.sin(t * (0.37 + i * 0.11));
      const v = clamp(0.6 - i * 0.022 + 0.18 * wobble + (i < 6 ? 0.3 * beat : 0) + 0.05 * (Math.random() - 0.5));
      this.frame.bands[i] = v;
      sum += v;
    }
    this.frame.level = clamp(sum / BANDS);
    return this.frame;
  }
}

/** Bands covering roughly 60-650 Hz: bass notes and the body of voices. */
const LOW_END_BANDS = bandIndexOf(650) + 1;

function approach(current, target, dt, release) {
  return target >= current ? current + (target - current) * Math.min(1, dt * 40) : Math.max(target, current - release * dt);
}

/** The playing audio's spectrum, smoothed for display like a real meter: fast attack, slow release. */
export class AudioSpectrum {
  bands = new Float32Array(BANDS);
  /** Overall loudness, 0..1. */
  level = 0;
  /** 0..1 spike on low-end hits (bass and voice) relative to the recent average, for speaker cones. */
  kick = 0;
  #bassAverage = 0;

  get isSilent() {
    return this.level === 0 && this.kick === 0 && this.bands.every((v) => v === 0);
  }

  /** Moves toward `frame` ({bands, level}), or toward silence when it is null. */
  update(frame, dt) {
    for (let i = 0; i < BANDS; i++) this.bands[i] = approach(this.bands[i], frame?.bands[i] ?? 0, dt, 1.6);
    this.level = approach(this.level, frame?.level ?? 0, dt, 2);
    let bass = 0;
    if (frame) {
      for (let i = 0; i < LOW_END_BANDS; i++) bass += frame.bands[i];
      bass /= LOW_END_BANDS;
    }
    this.#bassAverage += (bass - this.#bassAverage) * Math.min(1, dt * 2);
    this.kick = approach(this.kick, clamp((bass - this.#bassAverage) * 5), dt, 5);
  }
}
