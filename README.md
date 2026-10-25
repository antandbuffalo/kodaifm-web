# Kodai FM web

Browser version of the Kodai FM radio, live at https://antandbuffalo.github.io/kodaifm-web/.
Plain ES modules, no build step. Preview locally with `python3 -m http.server 8765` (modules don't load from `file://`).

## stations.json — the Android app depends on it

The installed Android apps fetch https://antandbuffalo.github.io/kodaifm-web/stations.json to find the stream.
Changing this file changes what every listener's app plays, with no Play release.

```json
{
  "stations": [
    { "id": "kodai", "url": "https://.../playlist.m3u8" }
  ]
}
```

- **Never rename, move or delete the file**, and never change an `id`. The app looks for the station with `id` `kodai`.
- `url` must be an `https://` HLS (`.m3u8`) stream. Check it plays before pushing.
- Keep it valid JSON. A broken file is ignored, and apps keep using the last address they saved.
- Extra fields and stations are fine; the app ignores what it doesn't know.

**When the stream moves:** update `url`, check the new address plays, then push. Apps pick it up on their next start, or straight away if the old stream fails. Also update the built-in fallback in the app's `StationList.kt` in the next release.

The web app itself still uses the address in `js/station.js`.
