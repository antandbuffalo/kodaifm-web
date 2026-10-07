import { createBoombox } from './boombox.js';
import { clamp } from './draw.js';
import { RadioPlayer } from './player.js';
import { AnalyserFeed, AudioSpectrum, SimulatedFeed } from './spectrum.js';
import { isOn } from './station.js';
import { createVintage } from './vintage.js';
import { load, save } from './storage.js';
import { Volume, VOLUME_MAX } from './volume.js';

// Saved by name, so reordering or adding styles keeps each listener's choice.
const DESIGN_KEY = 'design_name';
const BANNER_KEY = 'app_banner_closed';
/** How long the device-volume tip stays up; longer than the readout, since it's a sentence. */
const VOLUME_TIP_MS = 2500;
const SHARE_URL = 'https://antandbuffalo.github.io/kodaifm-web/';
const SHARE_TEXT = 'Listen to AIR Kodaikanal 100.5 FM live on Kodai FM';

const radio = new RadioPlayer(document.querySelector('audio'));
// One for the whole screen: both designs' volume controls drive it.
const volume = new Volume(radio);
document.documentElement.classList.toggle('fixed-volume', !volume.adjustable);
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

const creators = { boombox: createBoombox, vintage: createVintage };
const designs = pages.map((page) => creators[page.dataset.design](page, { radio, volume, wake }));

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
let current = Math.max(0, pages.findIndex((p) => p.dataset.design === load(DESIGN_KEY)));
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
    save(DESIGN_KEY, pages[i].dataset.design);
  },
  { passive: true },
);
dots.forEach((dot, i) => dot.addEventListener('click', () => showPage(i)));
prev.addEventListener('click', () => showPage(current - 1));
next.addEventListener('click', () => showPage(current + 1));
document.addEventListener('keydown', (e) => {
  if (about.open) return;
  if (e.key === 'ArrowRight') showPage(current + 1);
  if (e.key === 'ArrowLeft') showPage(current - 1);
  // Up and down work the volume, like a phone's side buttons.
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    volume.step(e.key === 'ArrowUp' ? 1 : -1);
  }
  // Space switches the radio on and off, except on a focused button, which handles it itself.
  if (e.key === ' ' && !e.target.closest?.('button')) {
    e.preventDefault();
    radio.toggle();
  }
});
// At the top of the scale, a tip points to the device's own volume.
const volumeTip = document.querySelector('.volume-tip');
let volumeTipTimer = 0;
volume.addEventListener('input', () => {
  if (volume.level !== VOLUME_MAX) return;
  volumeTip.textContent = 'Still low? Turn up your device volume.';
  volumeTip.classList.add('shown');
  clearTimeout(volumeTipTimer);
  volumeTipTimer = setTimeout(() => volumeTip.classList.remove('shown'), VOLUME_TIP_MS);
});

// About slides up from the link under the disclaimer.
const about = document.querySelector('dialog.about');
document.querySelector('.about-link').addEventListener('click', () => about.showModal());
// A tap on the dimmed backdrop lands on the dialog itself, outside the sheet.
about.addEventListener('click', (e) => {
  if (e.target === about) about.close();
});
const shareButton = about.querySelector('.share');
shareButton.addEventListener('click', async () => {
  if (navigator.share) {
    // Cancelling the share sheet rejects; nothing to do.
    await navigator.share({ title: 'Kodai FM', text: SHARE_TEXT, url: SHARE_URL }).catch(() => {});
    return;
  }
  try {
    await navigator.clipboard.writeText(`${SHARE_TEXT}: ${SHARE_URL}`);
    const label = shareButton.textContent;
    shareButton.textContent = 'Link copied';
    setTimeout(() => (shareButton.textContent = label), 2000);
  } catch {
    // No clipboard access (insecure origin or denied): leave the button as it is.
  }
});

// Android phones get a banner for the Play Store app, until they close it.
const banner = document.querySelector('.app-banner');
banner.hidden = !/Android/i.test(navigator.userAgent) || load(BANNER_KEY) === '1';
banner.querySelector('.app-banner-close').addEventListener('click', () => {
  banner.hidden = true;
  save(BANNER_KEY, '1');
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
