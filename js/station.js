export const STREAM_URL = 'https://air.pc.cdn.bitgravity.com/air/live/pbaudio051/playlist.m3u8';

/** AIR Kodaikanal's FM frequency, shown on both designs' dials. */
export const STATION_FREQ_MHZ = 100.5;

/** Radio phases: 'off' | 'tuning' | 'live' | 'error'. On means the user switched it on (it may still be connecting). */
export const isOn = (phase) => phase === 'tuning' || phase === 'live';
