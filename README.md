# Street View Drive Sim

Pick a start and end, get Google driving routes, choose one, and "drive" it by stepping through Street View panoramas matched to that route. The camera faces the route's direction of travel. Map on the left, Street View on the right.

## Usage

1. Click the map to drop pin **A** (start) and **B** (end), drag to adjust, or type addresses. The map starts at your current location if you allow it.
2. Press **Get routes**. All candidate routes are drawn; click one (or use the **Route** dropdown) to preview its first Street View.
3. Choose **Jump distance** (how far each view jump moves you, 10/25/50 m; applies on "Drive this route", shorter = smoother but more API calls) and **Jumps per second** (applies instantly). The `~ km/h` readout is jump distance x rate.
4. Press **Drive this route**, then Play/Pause, Prev/Next or the slider. Keyboard: Space, Left/Right arrows.

## Setup

```
npm install
copy .env.example .env   # then set VITE_GOOGLE_MAPS_API_KEY
npm run dev
```

In Google Cloud (billing enabled), enable **Maps JavaScript API** and **Routes API**. Restrict the key by HTTP referrer (`http://localhost:5173/*`) and to those two APIs. The key is used client-side (no backend), so never reuse an unrestricted key. `.env` is git-ignored; never commit a real key.

Stack: Vite, plain JavaScript, Tailwind CSS v4.

## Architecture

- `src/geo.js` – distance, bearing, polyline decoding.
- `src/matcher.js` – route → panorama sequence. Pure; the panorama lookup is injected, so it can be unit-tested.
- `src/google.js` – Maps loader, Routes API `computeRoutes` call, `StreetViewService` lookup.
- `src/playback.js` – play/pause/seek/speed state.
- `src/main.js` – DOM wiring.

### Matching algorithm
1. Sample the route at the chosen jump distance (interval widens so a route has at most 1500 samples).
2. Look up the nearest outdoor panorama near each sample (6 parallel requests).
3. Reject panoramas >25 m from the route, drop duplicate IDs, and require strictly increasing progress along the route (projection is limited to a window near the expected position).
4. Heading = bearing of the route from ~8 m behind to ~15 m ahead of the panorama's projected point.
5. Stretches with no accepted panorama are reported as gaps and skipped (never replaced with unrelated panoramas).

## Known limitations
- Origin/destination can be typed addresses or map pins; no Places Autocomplete yet.
- Panorama links are not used to validate transitions; parallel roads/opposite carriageways are only filtered by distance + monotonic progress.
- Panoramas are looked up for the whole route up front (many API calls on long routes); no lazy/windowed loading.
- Playback jumps between panoramas; no interpolation.
- Panoramas can be older imagery or user-contributed; the OUTDOOR source filter reduces but doesn't eliminate that.
- Don't persist/cache panorama data beyond the session (Maps Platform terms).


## Screenshot

![Street View Drive Sim](./ss.png)
