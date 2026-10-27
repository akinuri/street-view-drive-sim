import { bearing, distance } from "./geo.js";
import { fetchRoutes, loadGoogle, makePanoLookup } from "./google.js";
import { matchRoute } from "./matcher.js";
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

let map, pano, marker, lookup, abort;
let polylines = [];
let routes = [];
let currentPano = "";
let needZoom = false;
let carIcon;
const pins = { origin: null, dest: null }; // google.maps.Marker or null

function fmt(ll) { return `${ll.lat().toFixed(5)}, ${ll.lng().toFixed(5)}`; }

function setPin(kind, latLng) {
  const input = kind === "origin" ? originEl : destEl;
  if (!pins[kind]) {
    pins[kind] = new google.maps.Marker({ map, position: latLng, draggable: true, label: kind === "origin" ? "A" : "B", zIndex: 5 });
    pins[kind].addListener("dragend", (e) => { input.value = fmt(e.latLng); });
  } else {
    pins[kind].setPosition(latLng);
  }
  input.value = fmt(latLng);
}

function clearPins() {
  for (const k of ["origin", "dest"]) { pins[k]?.setMap(null); pins[k] = null; }
  originEl.value = destEl.value = "";
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
  controls.classList.toggle("opacity-50", !ready);
  for (const id of ["prev", "play", "next", "progress"]) $(id).disabled = !ready;
}

function updateSpeedInfo() {
  const mps = Number($("density").value) * Number(speedEl.value) / 1000;
  $("speed-info").textContent = `~ ${Math.round(mps * 3.6)} km/h`;
}

const playback = new Playback((i, step, playing) => {
  if (step.panoId !== currentPano) {
    currentPano = step.panoId;
    pano.setPano(step.panoId);
  }
  pano.setPov({ heading: step.heading, pitch: 0 });
  marker.setPosition(step.position);
  marker.setIcon({ ...carIcon, rotation: step.heading });
  if (needZoom) { map.setZoom(17); needZoom = false; }
  map.panTo(step.position);
  playBtn.textContent = playing ? "Pause" : "Play";
  progressEl.value = String(i);
  progressLabel.textContent = `${i + 1}/${playback.length}`;
});

function status(msg, error = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("text-red-400", error);
  statusEl.classList.toggle("text-slate-400", !error);
}

async function init() {
  try {
    await loadGoogle();
  } catch (e) {
    status(e.message, true);
    return;
  }
  map = new google.maps.Map($("map"), { center: { lat: 0, lng: 0 }, zoom: 2, disableDefaultUI: true, zoomControl: true });
  pano = new google.maps.StreetViewPanorama($("pano"), { addressControl: false, motionTracking: false, zoom: 1, visible: false });
  carIcon = { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 6, fillColor: "#d93025", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 };
  marker = new google.maps.Marker({ map, icon: carIcon });
  lookup = makePanoLookup();
  map.addListener("click", (e) => {
    if (!pins.origin) setPin("origin", e.latLng);
    else if (!pins.dest) setPin("dest", e.latLng);
    else status("Both pins placed. Drag A or B to move them, or press Clear pins.");
    if (pins.origin && pins.dest) status("Press Get route.");
  });
  status("Click the map to drop start (A) and end (B) pins, or type addresses.");
  navigator.geolocation?.getCurrentPosition(
    (pos) => {
      if (routes.length) return;
      map.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      map.setZoom(14);
    },
    () => {},
    { timeout: 8000 }
  );
}

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
  routeSelect.value = String(selected);
  polylines.forEach((p, i) => p.setOptions({ strokeWeight: i === selected ? 8 : 4, strokeOpacity: i === selected ? 1 : 0.6, zIndex: i === selected ? 2 : 1 }));
  playback.pause();
  setReady(false);
  abort?.abort();
  previewStart(selected);
}

/** Show all candidate routes; the user picks one, then presses "Drive this route". */
function drawRoutes() {
  polylines.forEach((p) => p.setMap(null));
  polylines = routes.map((r, i) => {
    const line = new google.maps.Polyline({ map, path: r.path, strokeColor: ROUTE_COLORS[i % ROUTE_COLORS.length], clickable: true });
    line.addListener("click", () => selectRoute(i));
    return line;
  });
  const bounds = new google.maps.LatLngBounds();
  routes.forEach((r) => r.path.forEach((p) => bounds.extend(p)));
  map.fitBounds(bounds);
  selectRoute(0);
}

async function prepare(index) {
  abort?.abort();
  playback.pause();
  setReady(false);
  const ctrl = (abort = new AbortController());
  previewToken++;
  try {
    const result = await matchRoute(routes[index].path, lookup, {
      sampleIntervalM: Number($("density").value),
      searchRadiusM: Math.max(15, Number($("density").value)),
      maxSamples: 1500,
      signal: ctrl.signal,
      onProgress: (d, t) => status(`Finding Street View panoramas... ${d}/${t}`),
    });
    if (result.steps.length < 2) return status("Not enough Street View coverage along this route.", true);
    const gapM = result.gaps.reduce((s, g) => s + g.toM - g.fromM, 0);
    status(
      `${(result.totalM / 1000).toFixed(1)} km, ${result.steps.length} panoramas` +
      (gapM ? `, ${result.gaps.length} coverage gap(s) (~${Math.round(gapM)} m skipped)` : "") +
      (result.truncated ? ", sampled sparsely (long route)" : "")
    );
    progressEl.max = String(result.steps.length - 1);
    setReady(true);
    currentPano = "";
    needZoom = true;
    showPano();
    playback.load(result.steps);
  } catch (e) {
    if (e.name !== "AbortError") status(`Panorama lookup failed: ${e.message}`, true);
  }
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
  drawRoutes();
  status(`${routes.length} route${routes.length > 1 ? "s" : ""} found. Click a route on the map or pick one, then press "Drive this route".`);
});

routeSelect.addEventListener("change", () => selectRoute(Number(routeSelect.value)));
driveBtn.addEventListener("click", () => prepare(selectedRoute));
$("clear-pins").addEventListener("click", clearPins);
playBtn.addEventListener("click", () => playback.toggle());
$("prev").addEventListener("click", () => { playback.pause(); playback.step(-1); });
$("next").addEventListener("click", () => { playback.pause(); playback.step(1); });
speedEl.addEventListener("change", () => { playback.intervalMs = 1e6 / Number(speedEl.value); updateSpeedInfo(); });
$("density").addEventListener("change", updateSpeedInfo);
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


