import { createBoombox } from './boombox.js';
import { clamp } from './draw.js';
import { RadioPlayer } from './player.js';
import { AnalyserFeed, AudioSpectrum, SimulatedFeed } from './spectrum.js';
import { isOn } from './station.js';
import { createVintage } from './vintage.js';

const DESIGN_KEY = 'design';

const radio = new RadioPlayer(document.querySelector('audio'));
const spectrum = new AudioSpectrum();
let feed = null;

const pager = document.getElementById('pager');
const pages = [...pager.querySelectorAll('.page')];
const dots = [...document.querySelectorAll('.dot')];
const visible = new Set();

// One animation loop for the whole screen, running only while something moves.
let raf = 0;
let last = 0;
function wake() {
  if (raf) return;
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

const designs = [createVintage, createBoombox].map((create, i) => create(pages[i], { radio, wake }));

function frame(now) {
  raf = 0;
  const dt = Math.min(0.05, Math.max(0, now - last) / 1000);
  last = now;
  const live = radio.phase === 'live';
  if (live && !feed) feed = radio.analyser ? new AnalyserFeed(radio.analyser) : new SimulatedFeed();
  spectrum.update(live ? feed.read(now) : null, dt);
  let moving = isOn(radio.phase) || !spectrum.isSilent;
  designs.forEach((d, i) => {
    moving = d.frame(now, dt, spectrum, visible.has(pages[i])) || moving;
  });
  if (moving) raf = requestAnimationFrame(frame);
}

function onPhase() {
  const now = performance.now();
  designs.forEach((d) => d.setPhase(now));
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = isOn(radio.phase) ? 'playing' : 'paused';
  wake();
}
radio.addEventListener('phase', onPhase);

// Swipeable radio styles; the last one used is remembered.
function readSaved() {
  try {
    return clamp(parseInt(localStorage.getItem(DESIGN_KEY), 10) || 0, 0, pages.length - 1);
  } catch {
    return 0;
  }
}
let current = readSaved();
const showPage = (i, behavior = 'smooth') =>
  pager.scrollTo({ left: clamp(i, 0, pages.length - 1) * pager.clientWidth, behavior });
const prev = document.querySelector('.nav.prev');
const next = document.querySelector('.nav.next');
function markCurrent() {
  dots.forEach((dot, i) => dot.setAttribute('aria-current', String(i === current)));
  prev.hidden = current === 0;
  next.hidden = current === pages.length - 1;
}
pager.addEventListener(
  'scroll',
  () => {
    const i = clamp(Math.round(pager.scrollLeft / pager.clientWidth), 0, pages.length - 1);
    if (i === current) return;
    current = i;
    markCurrent();
    try {
      localStorage.setItem(DESIGN_KEY, String(i));
    } catch {
      // Private mode or blocked storage: the style just isn't remembered.
    }
  },
  { passive: true },
);
dots.forEach((dot, i) => dot.addEventListener('click', () => showPage(i)));
prev.addEventListener('click', () => showPage(current - 1));
next.addEventListener('click', () => showPage(current + 1));
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') showPage(current + 1);
  if (e.key === 'ArrowLeft') showPage(current - 1);
  // Space switches the radio on and off, except on a focused button, which handles it itself.
  if (e.key === ' ' && !e.target.closest?.('button')) {
    e.preventDefault();
    radio.toggle();
  }
});
// Only styles on screen redraw.
const observer = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) visible.add(e.target);
      else visible.delete(e.target);
    }
    wake();
  },
  { root: pager },
);
pages.forEach((p) => observer.observe(p));

if ('mediaSession' in navigator) {
  navigator.mediaSession.metadata = new MediaMetadata({
    title: 'Kodai FM',
    artist: 'AIR Kodaikanal · 100.5 MHz',
    artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
  });
  navigator.mediaSession.setActionHandler('play', () => radio.play());
  navigator.mediaSession.setActionHandler('pause', () => radio.pause());
  navigator.mediaSession.setActionHandler('stop', () => radio.pause());
}

markCurrent();
showPage(current, 'instant');
onPhase();
