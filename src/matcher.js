import { bearing, distance } from "./geo.js";

// Pure route -> panorama matching. `lookup(point, radiusM)` is injected and must
// resolve to { id, position: {lat, lng} } or null, so this has no Google dependency.

export const defaultMatchOptions = {
  sampleIntervalM: 25,
  searchRadiusM: 20,
  maxRouteOffsetM: 25,
  concurrency: 6,
  maxSamples: 600,
  // onProgress(done, total), signal: AbortSignal
};

class Route {
  constructor(pts) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + distance(pts[i - 1], pts[i]));
  }

  get total() { return this.cum[this.cum.length - 1]; }

  pointAt(d) {
    d = Math.max(0, Math.min(this.total, d));
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < d) i++;
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const t = (d - this.cum[i - 1]) / seg;
    const a = this.pts[i - 1], b = this.pts[i];
    return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  }

  /** Travel heading at distance d, from slightly behind to slightly ahead. */
  headingAt(d) {
    return bearing(this.pointAt(d - 8), this.pointAt(d + 15));
  }

  /** Project p onto the route, only considering distances in [fromM, toM] so a parallel/returning pass can't match. */
  project(p, fromM, toM) {
    const k = Math.cos((p.lat * Math.PI) / 180);
    let best = { distAlongM: fromM, offsetM: Infinity };
    for (let i = 1; i < this.pts.length; i++) {
      if (this.cum[i] < fromM || this.cum[i - 1] > toM) continue;
      const a = this.pts[i - 1], b = this.pts[i];
      const bx = (b.lng - a.lng) * k, by = b.lat - a.lat;
      const px = (p.lng - a.lng) * k, py = p.lat - a.lat;
      const len2 = bx * bx + by * by || 1e-18;
      const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
      const proj = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
      const off = distance(p, proj);
      if (off < best.offsetM) best = { distAlongM: this.cum[i - 1] + t * (this.cum[i] - this.cum[i - 1]), offsetM: off };
    }
    return best;
  }
}

/**
 * @returns {Promise<{steps: {panoId, position, heading, routeDistanceM}[], gaps: {fromM, toM}[], totalM: number, truncated: boolean}>}
 */
export async function matchRoute(path, lookup, opts = {}) {
  const o = { ...defaultMatchOptions, ...opts };
  const route = new Route(path);

  // Sample along the route (interval widens for very long routes).
  const interval = Math.max(o.sampleIntervalM, route.total / o.maxSamples);
  const truncated = interval > o.sampleIntervalM;
  const sampleDists = [];
  for (let d = 0; d < route.total; d += interval) sampleDists.push(d);
  sampleDists.push(route.total);

  // Look up panoramas with limited concurrency.
  const found = new Array(sampleDists.length).fill(null);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < sampleDists.length) {
      if (o.signal?.aborted) return;
      const i = next++;
      try { found[i] = await lookup(route.pointAt(sampleDists[i]), o.searchRadiusM); } catch { found[i] = null; }
      o.onProgress?.(++done, sampleDists.length);
    }
  };
  await Promise.all(Array.from({ length: o.concurrency }, worker));
  if (o.signal?.aborted) throw new DOMException("Aborted", "AbortError");

  // Reject far-off panos, dedupe, and enforce strictly forward progress.
  const steps = [];
  const seen = new Set();
  const gaps = [];
  let lastD = 0;
  let gapStart = null;

  for (let i = 0; i < sampleDists.length; i++) {
    const pano = found[i];
    let covered = false;
    if (pano) {
      if (seen.has(pano.id)) {
        covered = true; // sparse coverage, not a gap
      } else {
        const proj = route.project(pano.position, Math.max(0, lastD - interval), sampleDists[i] + 2 * interval);
        if (proj.offsetM <= o.maxRouteOffsetM && proj.distAlongM > lastD) {
          seen.add(pano.id);
          lastD = proj.distAlongM;
          steps.push({ panoId: pano.id, position: pano.position, heading: route.headingAt(proj.distAlongM), routeDistanceM: proj.distAlongM });
          covered = true;
        }
      }
    }
    if (!covered && gapStart === null) gapStart = sampleDists[i];
    if (covered && gapStart !== null) { gaps.push({ fromM: gapStart, toM: sampleDists[i] }); gapStart = null; }
  }
  if (gapStart !== null) gaps.push({ fromM: gapStart, toM: route.total });

  return { steps, gaps, totalM: route.total, truncated };
}

const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Link-following matcher: starts at the first panorama and repeatedly moves to a linked
 * neighbour whose direction best matches the route's heading, so consecutive steps are
 * real Street View neighbours (smooth transitions, no hopping to parallel roads).
 * Falls back to a location lookup ahead on the route when no valid link exists (a gap).
 *
 * lookup(point, radiusM) -> { id, position } | null
 * getPano(id) -> { id, position, links: [{ id, heading }] } | null
 * opts.jumpM > 0 thins the chain so kept steps are at least that far apart.
 *
 * Lazy: returns immediately; call extend(n) to walk further. Nothing is fetched until asked.
 */
export function createWalker(path, lookup, getPano, opts = {}) {
  const o = { searchRadiusM: 30, maxRouteOffsetM: 25, maxHeadingDiff: 60, maxChain: 5000, jumpM: 0, ...opts };
  const route = new Route(path);
  const steps = []; // kept steps, grows as the walker extends
  const gaps = [];
  const seen = new Set();
  let chainCount = 0, lastChain = null, cur = null, d = 0;
  let started = false, done = false, busy = null;

  const check = () => { if (o.signal?.aborted) throw new DOMException("Aborted", "AbortError"); };
  const safe = async (fn) => { try { return await fn(); } catch (e) { if (e.name === "AbortError") throw e; return null; } };
  const accept = (info, fromD) => {
    if (!info || seen.has(info.id)) return null;
    const proj = route.project(info.position, Math.max(0, fromD - 5), fromD + 150);
    return proj.offsetM <= o.maxRouteOffsetM && proj.distAlongM > fromD ? proj : null;
  };

  // Probe ahead along the route for any panorama to (re)start from.
  const findAhead = async (fromD) => {
    for (let probe = Math.max(0, fromD); probe <= Math.min(route.total, fromD + 200); probe += 20) {
      check();
      const base = await safe(() => lookup(route.pointAt(probe), o.searchRadiusM));
      if (!base) continue;
      const info = await safe(() => getPano(base.id));
      const proj = accept(info, fromD);
      if (proj) return { info, proj };
    }
    return null;
  };

  const push = (info, proj) => {
    seen.add(info.id);
    chainCount++;
    const step = { panoId: info.id, position: info.position, heading: route.headingAt(proj.distAlongM), routeDistanceM: proj.distAlongM };
    lastChain = step;
    if (!steps.length || step.routeDistanceM - steps[steps.length - 1].routeDistanceM >= o.jumpM) steps.push(step);
  };

  const finish = () => {
    done = true;
    if (lastChain && steps[steps.length - 1] !== lastChain) steps.push(lastChain);
  };

  const advance = async () => {
    if (!started) {
      started = true;
      const first = await findAhead(-1);
      if (!first) { gaps.push({ fromM: 0, toM: route.total }); return finish(); }
      push(first.info, first.proj);
      cur = first.info;
      d = first.proj.distAlongM;
      return;
    }
    if (chainCount >= o.maxChain || d >= route.total - 15) return finish();
    check();
    const want = route.headingAt(d);
    const links = (cur.links ?? [])
      .filter((l) => angleDiff(l.heading, want) <= o.maxHeadingDiff && !seen.has(l.id))
      .sort((a, b) => angleDiff(a.heading, want) - angleDiff(b.heading, want));

    let next = null;
    for (const link of links) {
      const info = await safe(() => getPano(link.id));
      const proj = accept(info, d);
      if (proj) { next = { info, proj }; break; }
    }

    if (!next) {
      next = await findAhead(d + 1);
      if (!next) { gaps.push({ fromM: d, toM: route.total }); return finish(); }
      gaps.push({ fromM: d, toM: next.proj.distAlongM });
    }
    push(next.info, next.proj);
    cur = next.info;
    d = next.proj.distAlongM;
  };

  return {
    steps,
    gaps,
    totalM: route.total,
    get done() { return done; },
    /** Walk further until `count` more steps exist (or the route ends). Concurrent calls share one run. */
    extend(count) {
      if (busy) return busy;
      const target = steps.length + count;
      busy = (async () => {
        try {
          while (!done && steps.length < target) await advance();
        } finally { busy = null; }
      })();
      return busy;
    },
  };
}
