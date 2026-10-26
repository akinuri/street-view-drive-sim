import { decodePolyline } from "./geo.js";

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

export async function loadGoogle() {
  if (!KEY || KEY === "your_key_here") throw new Error("Missing VITE_GOOGLE_MAPS_API_KEY. Copy .env.example to .env and set your key.");
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
      "X-Goog-Api-Key": KEY,
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
