import { bearing, distance } from "./geo.js";
import { fetchRoutes, getKey, loadGoogle, setKey, makePanoGetter, makePanoLookup } from "./google.js";
import { createWalker } from "./matcher.js";
import { Playback } from "./playback.js";

const $ = (id) => document.getElementById(id);
const form = $("route-form");
const originEl = $("origin");
const destEl = $("destination");
const routeSelect = $("route-select");
const driveBtn = $("drive");
const controls = $("controls");
const playBtn = $("play");
const speedEl = $("speed");
const progressEl = $("progress");
const progressLabel = $("progress-label");
const statusEl = $("status");

let map, pano, marker, lookup, getPano, abort, walker;
const LOOKAHEAD = 20;
let polylines = [];
let routes = [];
let currentPano = "";
let needZoom = false;
let pendingRoute = null;
let carIcon;
const DEFAULT_VIEW = { center: { lat: 40.7579747, lng: -73.9881175 }, zoom: 14 }; // Times Square
let homeView = DEFAULT_VIEW;
const pins = { origin: null, dest: null }; // google.maps.Marker or null

function fmt(ll) { return `${ll.lat().toFixed(5)}, ${ll.lng().toFixed(5)}`; }

/** Keep the URL hash in sync (#a=...&b=...&route=NAME) so the current setup can be shared. */
function updateUrl() {
  const enc = (s) => encodeURIComponent(s.replace(/\s+/g, "")).replace(/%2C/g, ",");
  const parts = [];
  const a = originEl.value.trim(), b = destEl.value.trim();
  if (a) parts.push(`a=${COORDS.test(a) ? enc(a) : encodeURIComponent(a)}`);
  if (b) parts.push(`b=${COORDS.test(b) ? enc(b) : encodeURIComponent(b)}`);
  const route = routes[selectedRoute];
  if (route) parts.push(route.name ? `route=${encodeURIComponent(route.name)}` : `r=${selectedRoute + 1}`);
  history.replaceState(null, "", parts.length ? `#${parts.join("&")}` : location.pathname + location.search);
  $("copy-link").hidden = !(a && b);
}

$("copy-link").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    status("Link copied.");
  } catch {
    status("Could not copy. Copy the link from the address bar instead.", true);
  }
});

const COORDS = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

/** Fill the inputs (and pins, for coordinates) from the URL hash and fetch the routes. */
function restoreFromUrl() {
  const p = new URLSearchParams(location.hash.slice(1));
  const a = p.get("a"), b = p.get("b");
  if (!a || !b) return;
  for (const [kind, text] of [["origin", a], ["dest", b]]) {
    const m = COORDS.exec(text);
    if (m) setPin(kind, new google.maps.LatLng(Number(m[1]), Number(m[2])));
    else (kind === "origin" ? originEl : destEl).value = text;
  }
  pendingRoute = { name: p.get("route"), index: Number(p.get("r")) - 1 };
  form.requestSubmit();
}

function setPin(kind, latLng) {
  const input = kind === "origin" ? originEl : destEl;
  if (!pins[kind]) {
    pins[kind] = new google.maps.Marker({ map, position: latLng, draggable: true, label: kind === "origin" ? "A" : "B", zIndex: 5 });
    pins[kind].addListener("dragend", (e) => { input.value = fmt(e.latLng); updateUrl(); });
  } else {
    pins[kind].setPosition(latLng);
  }
  input.value = fmt(latLng);
  updateUrl();
}

/** Return the app to its initial state: pins, routes, playback, panorama and map marker. */
function resetAll() {
  abort?.abort();
  previewToken++;
  playback.load([]);
  walker = null;
  currentPano = "";
  needZoom = false;
  for (const k of ["origin", "dest"]) { pins[k]?.setMap(null); pins[k] = null; }
  originEl.value = destEl.value = "";
  polylines.forEach((p) => p.setMap(null));
  polylines = [];
  routes = [];
  selectedRoute = 0;
  routeSelect.innerHTML = "";
  routeSelect.parentElement.hidden = true;
  driveBtn.hidden = true;
  setReady(false);
  playBtn.textContent = "Play";
  progressEl.max = "0";
  progressEl.value = "0";
  progressLabel.textContent = "";
  marker.setPosition(null);
  map.setCenter(homeView.center);
  map.setZoom(homeView.zoom);
  pano.setVisible(false);
  $("pano-placeholder").hidden = false;
  status("Click the map to drop start (A) and end (B) pins, or type addresses.");
  updateUrl();
}

/** A typed address overrides a pin; otherwise the pin's current position is used. */
function waypoint(kind, text) {
  const pin = pins[kind];
  if (pin && text === fmt(pin.getPosition())) return { lat: pin.getPosition().lat(), lng: pin.getPosition().lng() };
  return text;
}

function showPano() {
  pano.setVisible(true);
  $("pano-placeholder").hidden = true;
}

function setReady(ready) {
  for (const id of ["prev", "play", "next", "progress"]) $(id).disabled = !ready;
  $("speed-info").hidden = !ready;
}

function updateSpeedInfo() {
  const mps = (Number($("density").value) || 10) * Number(speedEl.value) / 1000;
  $("speed-info").textContent = `~ ${Math.round(mps * 3.6)} km/h`;
}

const playback = new Playback((i, step, playing) => {
  if (step.panoId !== currentPano) {
    currentPano = step.panoId;
    lastJumpAt = performance.now();
    pano.setPano(step.panoId);
  }
  pano.setPov({ heading: step.heading, pitch: 0 });
  marker.setPosition(step.position);
  marker.setIcon({ ...carIcon, rotation: step.heading });
  if (needZoom) { map.setZoom(17); needZoom = false; }
  map.panTo(step.position);
  playBtn.textContent = playing ? "Pause" : "Play";
  progressEl.value = String(i);
  progressLabel.textContent = `${Math.round(step.routeDistanceM)}/${Math.round(walker.totalM)} m`;
  topUp(i);
}, turnInPlace);

const TURN_MIN_DEG = 25;
const TRANSITION_SETTLE_MS = 1000; // Street View exposes no "transition finished" event, so wait a fixed time
let lastJumpAt = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Rotate the camera inside the current panorama to the next step's heading, so the jump keeps the same view direction. Never overlaps a transition. */
async function turnInPlace(from, to, cancelled) {
  const start = pano.getPov();
  const diff = ((to.heading - start.heading + 540) % 360) - 180;
  if (Math.abs(diff) < TURN_MIN_DEG) return;
  const wait = TRANSITION_SETTLE_MS - (performance.now() - lastJumpAt);
  if (wait > 0) await sleep(wait);
  if (cancelled()) return;
  const duration = Math.min(1000, Math.max(300, Math.abs(diff) * 6));
  await new Promise((resolve) => {
    const t0 = performance.now();
    const frame = (now) => {
      if (cancelled()) return resolve();
      const k = Math.min(1, (now - t0) / duration);
      const eased = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
      pano.setPov({ heading: (start.heading + diff * eased + 360) % 360, pitch: start.pitch });
      if (k < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

function status(msg, error = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("text-red-400", error);
  statusEl.classList.toggle("text-slate-400", !error);
}

const keyEl = $("api-key");
keyEl.value = getKey();
$("delete-key").hidden = !getKey();
$("key-form").addEventListener("submit", (e) => {
  e.preventDefault();
  setKey(keyEl.value.trim());
  location.reload(); // the Maps script can only be loaded once per page
});
$("delete-key").addEventListener("click", () => {
  setKey("");
  location.reload();
});
window.gm_authFailure = () => status("Google rejected the API key. Check the key, billing, enabled APIs and referrer restrictions.", true);

async function init() {
  try {
    await loadGoogle();
  } catch (e) {
    status(e.message, true);
    return;
  }
  map = new google.maps.Map($("map"), { ...homeView, disableDefaultUI: true, zoomControl: true });
  pano = new google.maps.StreetViewPanorama($("pano"), { addressControl: false, motionTracking: false, zoom: 1, visible: false });
  carIcon = { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 6, fillColor: "#d93025", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 };
  marker = new google.maps.Marker({ map, icon: carIcon });
  lookup = makePanoLookup();
  getPano = makePanoGetter();
  map.addListener("click", (e) => {
    if (!pins.origin) setPin("origin", e.latLng);
    else if (!pins.dest) setPin("dest", e.latLng);
    else status("Both pins placed. Drag A or B to move them, or press Reset.");
    if (pins.origin && pins.dest) status("Press Get route.");
  });
  status("Click the map to drop start (A) and end (B) pins, or type addresses.");
  restoreFromUrl();
}

$("find-me").addEventListener("change", (e) => {
  const box = e.target;
  if (!box.checked) {
    homeView = DEFAULT_VIEW;
    if (map && !routes.length) { map.setCenter(homeView.center); map.setZoom(homeView.zoom); }
    return;
  }
  if (!navigator.geolocation) { box.checked = false; status("Geolocation is not available in this browser.", true); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      homeView = { center: { lat: pos.coords.latitude, lng: pos.coords.longitude }, zoom: 14 };
      if (map && !routes.length) { map.setCenter(homeView.center); map.setZoom(homeView.zoom); }
    },
    () => { box.checked = false; status("Could not get your location. Check the browser's location permission.", true); },
    { timeout: 8000 }
  );
});

const ROUTE_COLORS = ["#1a73e8", "#e8710a", "#188038", "#a142f4", "#d93025"];
let selectedRoute = 0;

let previewToken = 0;

/** Show the first panorama of the route as a preview, facing along the route. */
async function previewStart(index) {
  const token = ++previewToken;
  const path = routes[index].path;
  const ahead = path.find((p) => distance(path[0], p) > 20) ?? path[path.length - 1];
  let found = null;
  try { found = await lookup(path[0], 50); } catch { /* preview is best-effort */ }
  if (token !== previewToken || !found) return;
  currentPano = found.id;
  showPano();
  pano.setPano(found.id);
  pano.setPov({ heading: bearing(path[0], ahead), pitch: 0 });
}

function selectRoute(selected) {
  selectedRoute = selected;
  updateUrl();
  routeSelect.value = String(selected);
  polylines.forEach((p, i) => p.setOptions({ strokeWeight: i === selected ? 8 : 4, strokeOpacity: i === selected ? 1 : 0.6, zIndex: i === selected ? 2 : 1 }));
  playback.pause();
  setReady(false);
  abort?.abort();
  previewStart(selected);
}

/** Show all candidate routes; the user picks one, then presses "Drive this route". */
function drawRoutes(selected = 0) {
  polylines.forEach((p) => p.setMap(null));
  polylines = routes.map((r, i) => {
    const line = new google.maps.Polyline({ map, path: r.path, strokeColor: ROUTE_COLORS[i % ROUTE_COLORS.length], clickable: true });
    line.addListener("click", () => selectRoute(i));
    return line;
  });
  const bounds = new google.maps.LatLngBounds();
  routes.forEach((r) => r.path.forEach((p) => bounds.extend(p)));
  map.fitBounds(bounds);
  selectRoute(selected);
}

async function prepare(index) {
  abort?.abort();
  playback.pause();
  setReady(false);
  const ctrl = (abort = new AbortController());
  previewToken++;
  try {
    walker = createWalker(routes[index].path, lookup, getPano, {
      jumpM: Number($("density").value),
      signal: ctrl.signal,
    });
    status("Finding the start of the route...");
    await walker.extend(LOOKAHEAD);
    if (walker.steps.length < 2) return status("Not enough Street View coverage along this route.", true);
    updateRouteStatus();
    progressEl.max = String(walker.steps.length - 1);
    setReady(true);
    currentPano = "";
    needZoom = true;
    showPano();
    playback.load(walker.steps, () => !walker.done);
  } catch (e) {
    if (e.name !== "AbortError") status(`Panorama lookup failed: ${e.message}`, true);
  }
}

/** Load more steps in the background when playback gets close to the end of what's loaded. */
function topUp(i) {
  const w = walker;
  if (!w || w.done || i < w.steps.length - LOOKAHEAD) return;
  w.extend(LOOKAHEAD)
    .then(() => {
      if (w !== walker) return;
      progressEl.max = String(w.steps.length - 1);
      updateRouteStatus();
    })
    .catch((e) => { if (e.name !== "AbortError") status(`Panorama lookup failed: ${e.message}`, true); });
}

function updateRouteStatus() {
  const w = walker;
  const gapM = w.gaps.reduce((s, g) => s + g.toM - g.fromM, 0);
  status(
    `${(w.totalM / 1000).toFixed(1)} km route` +
    (gapM ? `, ${w.gaps.length} coverage gap(s) (~${Math.round(gapM)} m skipped)` : "") +
    (w.done ? "" : ", loading ahead as you drive")
  );
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!map) return;
  const origin = originEl.value.trim(), dest = destEl.value.trim();
  if (!origin || !dest) return status("Please enter both an origin and a destination.", true);
  abort?.abort();
  playback.pause();
  setReady(false);
  routeSelect.parentElement.hidden = true;
  driveBtn.hidden = true;
  status("Requesting routes...");
  try {
    routes = await fetchRoutes(waypoint("origin", origin), waypoint("dest", dest));
  } catch (e) {
    return status(e.message, true);
  }
  routeSelect.innerHTML = routes
    .map((r, i) => `<option value="${i}">Route ${i + 1}: ${(r.distanceM / 1000).toFixed(1)} km, ${Math.round(r.durationS / 60)} min</option>`)
    .join("");
  routeSelect.parentElement.hidden = false;
  driveBtn.hidden = false;
  let pick = 0;
  if (pendingRoute) {
    const byName = pendingRoute.name ? routes.findIndex((r) => r.name === pendingRoute.name) : -1;
    pick = byName >= 0 ? byName : pendingRoute.index >= 0 && pendingRoute.index < routes.length ? pendingRoute.index : 0;
    pendingRoute = null;
  }
  drawRoutes(pick);
  status(`${routes.length} route${routes.length > 1 ? "s" : ""} found. Click a route on the map or pick one, then press "Drive this route".`);
});

routeSelect.addEventListener("change", () => selectRoute(Number(routeSelect.value)));
driveBtn.addEventListener("click", () => prepare(selectedRoute));
$("clear-pins").addEventListener("click", resetAll);
playBtn.addEventListener("click", () => playback.toggle());
$("prev").addEventListener("click", () => { playback.pause(); playback.step(-1); });
$("next").addEventListener("click", () => { playback.pause(); playback.step(1); });
speedEl.addEventListener("change", () => { playback.intervalMs = 1e6 / Number(speedEl.value); updateSpeedInfo(); });
$("density").addEventListener("change", updateSpeedInfo);
originEl.addEventListener("input", updateUrl);
destEl.addEventListener("input", updateUrl);
playback.intervalMs = 1e6 / Number(speedEl.value);
progressEl.addEventListener("input", () => playback.seek(Number(progressEl.value)));
window.addEventListener("keydown", (e) => {
  if (e.target.matches("input, select")) return;
  if (e.code === "Space") { e.preventDefault(); playback.toggle(); }
  else if (e.code === "ArrowRight") playback.step(1);
  else if (e.code === "ArrowLeft") playback.step(-1);
});

setReady(false);
updateSpeedInfo();
init();


