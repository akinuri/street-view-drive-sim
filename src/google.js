import { decodePolyline } from "./geo.js";

const STORAGE_KEY = "gmaps-api-key";

export const getKey = () => localStorage.getItem(STORAGE_KEY) ?? "";
export const setKey = (k) => (k ? localStorage.setItem(STORAGE_KEY, k) : localStorage.removeItem(STORAGE_KEY));

export async function loadGoogle() {
  const KEY = getKey();
  if (!KEY) throw new Error("Enter your Google Maps API key (top right of the second row) to start.");
  if (!window.google?.maps) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&v=weekly`;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load Google Maps JavaScript API."));
      document.head.appendChild(s);
    });
  }
  if (!google.maps.Map) throw new Error("Google Maps failed to initialise. Check the API key, billing and that Maps JavaScript API is enabled.");
}

function toWaypoint(v) {
  return typeof v === "string" ? { address: v } : { location: { latLng: { latitude: v.lat, longitude: v.lng } } };
}

/** Routes API computeRoutes. origin/destination: address string or {lat, lng}. Returns [{ path, distanceM, durationS }]. */
export async function fetchRoutes(origin, destination, signal) {
  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": getKey(),
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify({
      origin: toWaypoint(origin),
      destination: toWaypoint(destination),
      travelMode: "DRIVE",
      computeAlternativeRoutes: true,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `Routes API error ${res.status}`);
  if (!data.routes?.length) throw new Error("No driving route found between those locations.");
  return data.routes.map((r) => ({
    path: decodePolyline(r.polyline.encodedPolyline),
    distanceM: r.distanceMeters ?? 0,
    durationS: parseInt(r.duration ?? "0", 10),
  }));
}

export function makePanoLookup() {
  const sv = new google.maps.StreetViewService();
  return async (point, radius) => {
    try {
      const { data } = await sv.getPanorama({
        location: point,
        radius,
        preference: google.maps.StreetViewPreference.NEAREST,
        source: google.maps.StreetViewSource.OUTDOOR,
      });
      const loc = data.location;
      if (!loc?.pano || !loc.latLng) return null;
      return { id: loc.pano, position: { lat: loc.latLng.lat(), lng: loc.latLng.lng() } };
    } catch (e) {
      if (e?.code === "ZERO_RESULTS") return null;
      throw e;
    }
  };
}

/** Fetch a panorama by ID, including its links to neighbouring panoramas. Cached for the session only. */
export function makePanoGetter() {
  const sv = new google.maps.StreetViewService();
  const cache = new Map();
  return async (id) => {
    if (cache.has(id)) return cache.get(id);
    try {
      const { data } = await sv.getPanorama({ pano: id });
      const loc = data.location;
      if (!loc?.pano || !loc.latLng) return null;
      const info = {
        id: loc.pano,
        position: { lat: loc.latLng.lat(), lng: loc.latLng.lng() },
        links: (data.links ?? []).filter((l) => l.pano).map((l) => ({ id: l.pano, heading: l.heading })),
      };
      cache.set(id, info);
      return info;
    } catch (e) {
      if (e?.code === "ZERO_RESULTS") return null;
      throw e;
    }
  };
}
