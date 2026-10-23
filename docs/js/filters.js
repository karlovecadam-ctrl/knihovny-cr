// Filtry, hledání a vzdálenosti nad daty knihoven (datový kontrakt v plánu stavby).
import { openOnWeekend, openStatus } from "./status.js";

export function normalize(text) {
  return (text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function matchRank(name, query) {
  const n = normalize(name);
  if (n.startsWith(query)) return 0;
  if (n.split(/[\s,–-]+/).some((word) => word.startsWith(query))) return 1;
  return n.includes(query) ? 2 : -1;
}

export function searchLocal(libs, places, query, limit = 8) {
  const q = normalize(query);
  if (!q) return [];
  const ranked = (items, kind) => items
    .map((item) => ({ kind, item, rank: matchRank(item.name, q) }))
    .filter((r) => r.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name, "cs"));
  return [...ranked(places, "place"), ...ranked(libs, "library")]
    .slice(0, limit)
    .map(({ kind, item }) => ({ kind, item }));
}

// Obce s aspoň jednou knihovnou; stejná jména v různých okresech zůstanou oddělená.
export function buildPlaces(libs) {
  const sums = new Map();
  for (const lib of libs) {
    if (!lib.municipality || lib.lat == null) continue;
    const key = `${lib.municipality}|${lib.district || ""}`;
    const s = sums.get(key) || { name: lib.municipality, district: lib.district || "", lat: 0, lon: 0, n: 0 };
    s.lat += lib.lat;
    s.lon += lib.lon;
    s.n += 1;
    sums.set(key, s);
  }
  return [...sums.values()].map(({ name, district, lat, lon, n }) => ({ name, district, lat: lat / n, lon: lon / n }));
}

export function distanceKm(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// f = {region, district, categories: Set, mainOnly, openNow, weekend, includeUnknown, services: Set}
export function applyFilters(libs, f, date) {
  const matching = [];
  const unknownHours = [];
  for (const lib of libs) {
    if (f.region && lib.region !== f.region) continue;
    if (f.region && f.district && lib.district !== f.district) continue;
    if (f.categories.size && !f.categories.has(lib.category)) continue;
    if (f.mainOnly && lib.parent) continue;
    if ([...f.services].some((key) => !lib.serviceKeys.includes(key))) continue;

    const state = openStatus(lib.hours, date).state;
    if (state === "unknown") {
      if (!f.includeUnknown) continue;
      (f.openNow || f.weekend ? unknownHours : matching).push(lib);
      continue;
    }
    if (f.openNow && state !== "open") continue;
    if (f.weekend && !openOnWeekend(lib.hours)) continue;
    matching.push(lib);
  }
  return { matching, unknownHours };
}

export function sortForList(libs, point) {
  const list = [...libs];
  if (point) {
    const dist = (lib) => (lib.lat == null ? Infinity : distanceKm(point, lib));
    return list.sort((a, b) => dist(a) - dist(b));
  }
  return list.sort((a, b) => a.name.localeCompare(b.name, "cs"));
}
