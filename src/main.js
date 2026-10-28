import { fetchRoutes, getKey, loadGoogle, setKey, makePanoGetter, makePanoLookup } from "./google.js";
import { applyStatic, getLang, setLang, t } from "./i18n.js";
import { createWalker, Route } from "./matcher.js";
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
let jumpToken = 0;
let rotateMap = false; // keep the direction of travel pointing up on the map
let lastHeading = 0;
let positionM = 0; // metres along the selected route, shared via the URL
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
  if (route && positionM > 0) parts.push(`d=${Math.round(positionM)}`);
  try {
    history.replaceState(null, "", parts.length ? `#${parts.join("&")}` : location.pathname + location.search);
  } catch { /* browsers rate-limit history updates */ }
  $("copy-link").hidden = !(a && b);
}

$("copy-link").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    status("st.copied");
  } catch {
    status("st.copyFail", true);
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
  pendingRoute = { name: p.get("route"), index: Number(p.get("r")) - 1, atM: Math.max(0, Number(p.get("d")) || 0) };
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
  playBtn.textContent = t("play");
  progressEl.max = "0";
  progressEl.value = "0";
  progressLabel.textContent = "";
  marker.setPosition(null);
  map.setHeading(0);
  map.setCenter(homeView.center);
  map.setZoom(homeView.zoom);
  pano.setVisible(false);
  $("pano-placeholder").hidden = false;
  status("st.hint");
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
  marker.setIcon({ ...carIcon, rotation: rotateMap ? 0 : step.heading });
  lastHeading = step.heading;
  if (rotateMap) map.setHeading(step.heading);
  if (needZoom) { map.setZoom(17); needZoom = false; }
  map.panTo(step.position);
  playBtn.textContent = playing ? t("pause") : t("play");
  progressEl.value = String(i);
  progressLabel.textContent = `${Math.round(step.routeDistanceM)}/${Math.round(walker.totalM)} m (${Math.round((step.routeDistanceM / walker.totalM) * 100)}%)`;
  positionM = step.routeDistanceM;
  if (!playing) updateUrl();
  topUp(i);
}, turnInPlace);
playback.onWait = () => topUp(playback.index);

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

let lastStatus = { msg: "", error: false, params: {} };

/** msg is an i18n key, plain text (passed through), or a function returning text so it can be re-rendered on language change. */
function status(msg, error = false, params = {}) {
  lastStatus = { msg, error, params };
  renderStatus();
}

function renderStatus() {
  const { msg, error, params } = lastStatus;
  statusEl.textContent = typeof msg === "function" ? msg() : t(msg, params);
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
window.gm_authFailure = () => status("st.authFail", true);

async function init() {
  try {
    await loadGoogle();
  } catch (e) {
    status(e.message, true);
    return;
  }
  map = new google.maps.Map($("map"), { ...homeView, disableDefaultUI: true, zoomControl: true, mapId: "DEMO_MAP_ID", renderingType: google.maps.RenderingType.VECTOR });
  pano = new google.maps.StreetViewPanorama($("pano"), { addressControl: false, motionTracking: false, zoom: 1, visible: false });
  carIcon = { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 6, fillColor: "#d93025", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 };
  marker = new google.maps.Marker({ map, icon: carIcon });
  lookup = makePanoLookup();
  getPano = makePanoGetter();
  map.addListener("click", (e) => {
    if (!pins.origin) setPin("origin", e.latLng);
    else if (!pins.dest) setPin("dest", e.latLng);
    else status("st.bothPins");
    if (pins.origin && pins.dest) status("st.pressGet");
  });
  status("st.hint");
  restoreFromUrl();
}

$("find-me").addEventListener("change", (e) => {
  const box = e.target;
  if (!box.checked) {
    homeView = DEFAULT_VIEW;
    if (map && !routes.length) { map.setCenter(homeView.center); map.setZoom(homeView.zoom); }
    return;
  }
  if (!navigator.geolocation) { box.checked = false; status("st.geoNone", true); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      homeView = { center: { lat: pos.coords.latitude, lng: pos.coords.longitude }, zoom: 14 };
      if (map && !routes.length) { map.setCenter(homeView.center); map.setZoom(homeView.zoom); }
    },
    () => { box.checked = false; status("st.geoFail", true); },
    { timeout: 8000 }
  );
});

const ROUTE_COLORS = ["#1a73e8", "#e8710a", "#188038", "#a142f4", "#d93025"];
let selectedRoute = 0;

let previewToken = 0;

/** Show a panorama at distance atM along the route (default: the start) as a preview, facing along the route. */
async function previewStart(index, atM = 0) {
  const token = ++previewToken;
  const route = new Route(routes[index].path);
  const at = route.pointAt(atM);
  const heading = route.headingAt(atM);
  if (atM > 0) {
    marker.setPosition(at);
    marker.setIcon({ ...carIcon, rotation: rotateMap ? 0 : heading });
    lastHeading = heading;
    if (rotateMap) map.setHeading(heading);
  }
  let found = null;
  try { found = await lookup(at, 50); } catch { /* preview is best-effort */ }
  if (token !== previewToken || !found) return;
  currentPano = found.id;
  showPano();
  pano.setPano(found.id);
  pano.setPov({ heading, pitch: 0 });
}

function selectRoute(selected, atM = 0) {
  selectedRoute = selected;
  positionM = atM;
  updateUrl();
  routeSelect.value = String(selected);
  polylines.forEach((p, i) => p.setOptions({ strokeWeight: i === selected ? 8 : 4, strokeOpacity: i === selected ? 1 : 0.6, zIndex: i === selected ? 2 : 1 }));
  playback.pause();
  setReady(false);
  abort?.abort();
  marker.setPosition(null);
  previewStart(selected, atM);
}

/** While driving, jump to the loaded step nearest to a point clicked on the driven route (loading ahead if needed). */
async function jumpTo(latLng) {
  const w = walker;
  const spinner = $("jump-spinner");
  const target = new Route(routes[selectedRoute].path).project({ lat: latLng.lat(), lng: latLng.lng() }, 0, Infinity).distAlongM;
  const token = ++jumpToken;
  spinner.hidden = false;
  try {
    while (!w.done && w.steps[w.steps.length - 1].routeDistanceM < target) {
      await w.extend(LOOKAHEAD);
      if (w !== walker || token !== jumpToken) return;
      progressEl.max = String(w.steps.length - 1);
    }
  } catch (e) {
    if (e.name !== "AbortError") status("st.lookupFail", true, { msg: e.message });
    return;
  } finally {
    if (token === jumpToken) spinner.hidden = true;
  }
  let best = 0;
  w.steps.forEach((s, i) => { if (Math.abs(s.routeDistanceM - target) < Math.abs(w.steps[best].routeDistanceM - target)) best = i; });
  playback.seek(best);
}

/** Show all candidate routes; the user picks one, then presses "Drive this route". */
function drawRoutes(selected = 0, atM = 0) {
  polylines.forEach((p) => p.setMap(null));
  polylines = routes.map((r, i) => {
    const line = new google.maps.Polyline({ map, path: r.path, strokeColor: ROUTE_COLORS[i % ROUTE_COLORS.length], clickable: true });
    line.addListener("click", (e) => (i === selectedRoute && walker && playback.steps.length ? jumpTo(e.latLng) : selectRoute(i)));
    return line;
  });
  const bounds = new google.maps.LatLngBounds();
  routes.forEach((r) => r.path.forEach((p) => bounds.extend(p)));
  map.fitBounds(bounds);
  selectRoute(selected, atM);
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
    status("st.finding");
    await walker.extend(LOOKAHEAD);
    if (walker.steps.length < 2) return status("st.noCoverage", true);
    updateRouteStatus();
    progressEl.max = String(walker.steps.length - 1);
    setReady(true);
    currentPano = "";
    needZoom = true;
    showPano();
    playback.load(walker.steps, () => !walker.done);
  } catch (e) {
    if (e.name !== "AbortError") status("st.lookupFail", true, { msg: e.message });
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
    .catch((e) => { if (e.name !== "AbortError") status("st.lookupFail", true, { msg: e.message }); });
}

function updateRouteStatus() {
  const w = walker;
  const gapM = w.gaps.reduce((s, g) => s + g.toM - g.fromM, 0);
  status(() =>
    t("st.routeKm", { km: (w.totalM / 1000).toFixed(1) }) +
    (gapM ? t("st.gaps", { n: w.gaps.length, m: Math.round(gapM) }) : "") +
    (w.done ? "" : t("st.loading"))
  );
}

function renderRouteOptions() {
  const sel = routeSelect.value;
  routeSelect.innerHTML = routes
    .map((r, i) => `<option value="${i}">${t("routeOption", { n: i + 1, km: (r.distanceM / 1000).toFixed(1), min: Math.round(r.durationS / 60) })}</option>`)
    .join("");
  routeSelect.value = sel;
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!map) return;
  const origin = originEl.value.trim(), dest = destEl.value.trim();
  if (!origin || !dest) return status("st.enterBoth", true);
  abort?.abort();
  playback.pause();
  setReady(false);
  routeSelect.parentElement.hidden = true;
  driveBtn.hidden = true;
  status("st.requesting");
  try {
    routes = await fetchRoutes(waypoint("origin", origin), waypoint("dest", dest));
  } catch (e) {
    return status(e.message, true);
  }
  renderRouteOptions();
  routeSelect.parentElement.hidden = false;
  driveBtn.hidden = false;
  let pick = 0, atM = 0;
  if (pendingRoute) {
    const byName = pendingRoute.name ? routes.findIndex((r) => r.name === pendingRoute.name) : -1;
    pick = byName >= 0 ? byName : pendingRoute.index >= 0 && pendingRoute.index < routes.length ? pendingRoute.index : 0;
    atM = pendingRoute.atM;
    pendingRoute = null;
  }
  drawRoutes(pick, atM);
  status(routes.length > 1 ? "st.routesMany" : "st.routesOne", false, { n: routes.length });
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

$("rotate-map").addEventListener("change", (e) => {
  rotateMap = e.target.checked;
  if (!map) return;
  map.setHeading(rotateMap ? lastHeading : 0);
  if (marker.getPosition()) marker.setIcon({ ...carIcon, rotation: rotateMap ? 0 : lastHeading });
});

const splitRoot = $("split-root");
const splitter = $("splitter");
function setSplit(pct) {
  pct = Math.max(15, Math.min(85, pct));
  splitRoot.style.setProperty("--split", `${pct}%`);
  splitter.setAttribute("aria-valuenow", String(Math.round(pct)));
  if (map) google.maps.event.trigger(map, "resize");
  if (pano) google.maps.event.trigger(pano, "resize");
}
splitter.addEventListener("pointerdown", (e) => {
  splitter.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const r = splitRoot.getBoundingClientRect();
    setSplit(((ev.clientX - r.left) / r.width) * 100);
  };
  const stop = () => {
    splitter.removeEventListener("pointermove", move);
    splitter.removeEventListener("pointerup", stop);
    splitter.removeEventListener("pointercancel", stop);
  };
  splitter.addEventListener("pointermove", move);
  splitter.addEventListener("pointerup", stop);
  splitter.addEventListener("pointercancel", stop);
});
splitter.addEventListener("dblclick", () => setSplit(50));
splitter.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  const cur = parseFloat(splitRoot.style.getPropertyValue("--split")) || 50;
  setSplit(cur + (e.key === "ArrowRight" ? 2 : -2));
});

setReady(false);
updateSpeedInfo();
const langEl = $("lang");
langEl.value = getLang();
applyStatic();
playBtn.textContent = t("play");
langEl.addEventListener("change", () => {
  setLang(langEl.value);
  playBtn.textContent = playback.playing ? t("pause") : t("play");
  if (routes.length) renderRouteOptions();
  renderStatus();
});
init();


