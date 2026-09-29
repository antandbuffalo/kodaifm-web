import Hls from '../vendor/hls.light.min.mjs';
import { STREAM_URL } from './station.js';

// iPhone and iPad: play HLS natively so audio keeps going with the screen locked. Routing it
// through Web Audio for the analyser would stop it in the background there.
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * The live stream behind both radio designs. `phase` is 'off' | 'tuning' | 'live' | 'error', and a
 * 'phase' event fires when it changes. Every play opens a fresh connection, so it always starts at
 * the live edge and doubles as the retry after an error.
 */
export class RadioPlayer extends EventTarget {
  phase = 'off';
  /** Web Audio analyser on the output, or null where the stream can't be analysed. */
  analyser = null;
  #audio;
  #hls = null;
  #context = null;
  #wanted = false;
  #native = IOS || !Hls.isSupported();

  constructor(audio) {
    super();
    this.#audio = audio;
    audio.crossOrigin = 'anonymous';
    audio.addEventListener('playing', () => this.#wanted && this.#set('live'));
    audio.addEventListener('waiting', () => this.#wanted && this.#set('tuning'));
    // Paused from outside the page: headphones unplugged, a call, another app taking the audio.
    audio.addEventListener('pause', () => this.#wanted && this.pause());
    audio.addEventListener('error', () => this.#wanted && this.#fail());
  }

  play() {
    if (this.#wanted) return;
    this.#wanted = true;
    this.#set('tuning');
    this.#connectAnalyser();
    if (this.#native) {
      this.#audio.src = STREAM_URL;
    } else {
      const hls = new Hls();
      hls.on(Hls.Events.ERROR, (_, data) => data.fatal && this.#hls === hls && this.#fail());
      hls.loadSource(STREAM_URL);
      hls.attachMedia(this.#audio);
      this.#hls = hls;
    }
    this.#audio.play().catch((e) => e.name !== 'AbortError' && this.#wanted && this.#fail());
  }

  toggle() {
    if (this.#wanted) this.pause();
    else this.play();
  }

  pause() {
    if (!this.#wanted) return;
    this.#stop();
    this.#set('off');
  }

  #fail() {
    this.#stop();
    this.#set('error');
  }

  #stop() {
    this.#wanted = false;
    this.#audio.pause();
    this.#hls?.destroy();
    this.#hls = null;
    this.#audio.removeAttribute('src');
    this.#audio.load();
    this.#context?.suspend();
  }

  #connectAnalyser() {
    if (this.#native) return;
    try {
      if (!this.#context) {
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        context.createMediaElementSource(this.#audio).connect(analyser);
        analyser.connect(context.destination);
        this.#context = context;
        this.analyser = analyser;
      }
      this.#context.resume();
    } catch {
      // No analyser: the designs fall back to simulated motion.
    }
  }

  #set(phase) {
    if (phase === this.phase) return;
    this.phase = phase;
    this.dispatchEvent(new Event('phase'));
  }
}
