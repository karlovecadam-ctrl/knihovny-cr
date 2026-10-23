// Čistá logika nového rozhraní: řazení, štítky aktivních filtrů, odkaz #id, úvodní obrazovka, stránkování.
import { distanceKm } from "./filters.js";
import { openStatus } from "./status.js";

const STATE_RANK = { open: 0, closed: 1, unknown: 2 };
const byName = (a, b) => a.name.localeCompare(b.name, "cs");

export function defaultSort(point) {
  return point ? "distance" : "name";
}

// mode: "distance" | "name" | "open"
export function sortLibraries(libs, mode, point, date) {
  const dist = (lib) => (point && lib.lat != null ? distanceKm(point, lib) : Infinity);
  const near = point ? (a, b) => dist(a) - dist(b) || byName(a, b) : byName;
  const list = [...libs];
  if (mode === "name") return list.sort(byName);
  if (mode === "distance") return list.sort(near);
  const rank = new Map(list.map((lib) => [lib.id, STATE_RANK[openStatus(lib.hours, date).state]]));
  return list.sort((a, b) => rank.get(a.id) - rank.get(b.id) || near(a, b));
}

// Štítky v pořadí: otevírací doba, oblast, typ, budovy, služby.
export function activeFilterChips(f, categories, services) {
  const chips = [];
  if (f.openNow) chips.push({ key: "openNow", label: "otevřeno teď" });
  if (f.weekend) chips.push({ key: "weekend", label: "o víkendu" });
  if (!f.includeUnknown) chips.push({ key: "unknown", label: "bez neuvedené doby" });
  if (f.region) chips.push({ key: "region", label: f.region });
  if (f.region && f.district) chips.push({ key: "district", label: `okres ${f.district}` });
  if (f.categories.size) {
    for (const [key, label] of categories) {
      if (!f.categories.has(key)) chips.push({ key: `cat:${key}`, label: `bez: ${label}` });
    }
  }
  if (f.mainOnly) chips.push({ key: "mainOnly", label: "jen hlavní budovy" });
  for (const [key, label] of services) {
    if (f.services.has(key)) chips.push({ key: `svc:${key}`, label });
  }
  return chips;
}

// Vrátí nový objekt filtrů bez daného filtru; categoryKeys = všechny typy (plná sada = bez filtru).
export function clearFilter(f, key, categoryKeys) {
  const next = { ...f, categories: new Set(f.categories), services: new Set(f.services) };
  if (key === "region") Object.assign(next, { region: "", district: "" });
  else if (key === "district") next.district = "";
  else if (key === "openNow" || key === "weekend" || key === "mainOnly") next[key] = false;
  else if (key === "unknown") next.includeUnknown = true;
  else if (key.startsWith("svc:")) next.services.delete(key.slice(4));
  else if (key.startsWith("cat:")) {
    next.categories.delete("__none__");
    next.categories.add(key.slice(4));
    if (categoryKeys.every((k) => next.categories.has(k))) next.categories = new Set();
  }
  return next;
}

export function parseHash(hash) {
  const m = /^#([A-Za-z0-9-]{3,40})$/.exec(hash || "");
  return m ? m[1] : null;
}

export const hashFor = (id) => `#${id}`;

// Úvodní obrazovka, dokud návštěvník nic nehledal, nefiltroval ani nepřiblížil mapu nad úroveň kraje.
export function shouldShowStart({ dismissed, point, filtersActive, zoom }) {
  return !dismissed && !point && !filtersActive && zoom < 9;
}

export function page(list, size, pages) {
  const n = size * pages;
  return { items: list.slice(0, n), hasMore: list.length > n };
}
