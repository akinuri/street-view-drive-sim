# Street View Drive Sim

Pick a start and end, get Google driving routes, choose one, and "drive" it by stepping through Street View panoramas matched to that route. The camera faces the route's direction of travel. Map on the left, Street View on the right.

## Usage

1. Click the map to drop pin **A** (start) and **B** (end), drag to adjust, or type addresses. The map starts at your current location if you allow it.
2. Press **Get routes**. All candidate routes are drawn. Click one (or use the **Route** dropdown) to preview its first Street View.
3. Set **Jump distance** (every panorama, or 10/25/50 m) and **Jumps per second**. "Every panorama" gives the smoothest transitions. Jump distance takes effect when you press **Drive this route**; speed changes apply immediately. The `~ km/h` readout is jump distance x rate.
4. Press **Drive this route**, then use Play/Pause, Prev/Next or the slider. Keyboard: Space, Left/Right arrows.
5. **Reset** clears pins, routes and the Street View, and returns the map to its starting view.

## Setup

```
npm install
copy .env.example .env   # then set VITE_GOOGLE_MAPS_API_KEY
npm run dev
```

In Google Cloud (billing enabled), enable **Maps JavaScript API** and **Routes API**. The key is used client-side (there is no backend), so restrict it by HTTP referrer (e.g. `http://localhost:5173/*`) and to those two APIs. `.env` is git-ignored.

Stack: Vite, plain JavaScript, Tailwind CSS v4.

## Architecture

- `src/geo.js` – distance, bearing, polyline decoding.
- `src/matcher.js` – route → panorama sequence, independent of the UI (panorama lookup is injected).
- `src/google.js` – Maps loader, Routes API `computeRoutes` call, `StreetViewService` lookup.
- `src/playback.js` – play/pause/seek/speed state.
- `src/main.js` – DOM wiring.

### Matching algorithm
1. Find the first panorama near the route start and read its links to neighbouring panoramas. Nothing else is fetched up front.
2. Repeatedly move to the linked neighbour whose heading best matches the route's direction (within 60 degrees), so each step is a real neighbour and Street View can animate the transition.
3. Reject neighbours >25 m from the route, already-visited IDs, and any that don't make forward progress along the route.
4. Heading = bearing of the route from ~8 m behind to ~15 m ahead of the panorama's projected point.
5. If no valid link exists, probe ahead on the route (up to 200 m) for a panorama; the skipped stretch is reported as a gap (never replaced with unrelated panoramas). Those jumps are hard cuts.
6. Jump distance thins the chain; "Every panorama" keeps all of it. Thinned steps are no longer neighbours, so expect more hard cuts.

The route is walked lazily: about 20 steps are loaded to start, and more load in the background as playback nears the end of what's loaded. API calls are therefore only spent on the part you actually drive. The slider covers only what's loaded so far.

Before a sharp turn, the camera rotates in place before moving to the next panorama, so the turn and the Street View transition don't overlap.

## Known limitations
- Origin/destination can be typed addresses or map pins; no Places Autocomplete yet.
- Links are followed greedily by heading; at complex intersections or with opposite carriageways close together it can still pick a wrong branch.
- Following links is sequential (about one API call per panorama driven); panoramas ahead of the playhead are loaded in small batches.
- Playback jumps between panoramas; no interpolation.
- Panoramas can be older imagery or user-contributed; the OUTDOOR source filter reduces but doesn't eliminate that.
- Panorama data is not stored beyond the session, in line with Maps Platform terms.

## Screenshot

![Street View Drive Sim](./ss.png)
