import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFilters, buildPlaces, distanceKm, normalize, searchLocal, sortForList } from "../docs/js/filters.js";

const empty = () => [[], [], [], [], [], [], []];
const tue = (from, to) => {
  const days = empty();
  days[1] = [[from, to]];
  return { days, parsed: true, raw: {}, note: null };
};
const lib = (over) => ({
  id: "X", name: "Knihovna", category: "obecni", region: "Středočeský", district: "Kolín",
  municipality: "Kolín", lat: 50, lon: 15, parent: null, serviceKeys: [], hours: null, ...over,
});
const NOW = new Date("2026-10-20T08:00:00Z"); // Út 10:00
const base = {
  region: "", district: "", categories: new Set(), mainOnly: false, openNow: false, weekend: false,
  includeUnknown: true, services: new Set(),
};

const libs = [
  lib({ id: "open", name: "Otevřená", hours: tue("09:00", "18:00") }),
  lib({ id: "closed", name: "Zavřená", hours: tue("16:00", "18:00") }),
  lib({ id: "unknown", name: "Neznámá", hours: null }),
  lib({ id: "branch", name: "Pobočka", parent: "open", hours: tue("09:00", "12:00"), serviceKeys: ["wifi"] }),
  lib({ id: "brno", name: "Brněnská", region: "Jihomoravský", district: "Brno-město", category: "krajske",
        hours: tue("09:00", "18:00") }),
];
const ids = (list) => list.map((l) => l.id).sort();

test("normalize odstraní diakritiku a velká písmena", () => {
  assert.equal(normalize("Frýdek-Místek"), "frydek-mistek");
});

test("searchLocal najde obec i knihovnu bez diakritiky", () => {
  const places = [{ name: "Plzeň", lat: 49.74, lon: 13.37 }, { name: "Kolín", lat: 50.03, lon: 15.2 }];
  const found = searchLocal(libs, places, "plzen");
  assert.deepEqual(found, [{ kind: "place", item: places[0] }]);
  const both = searchLocal(libs, places, "zavr");
  assert.deepEqual(both.map((r) => r.item.id), ["closed"]);
  assert.deepEqual(searchLocal(libs, places, " "), []);
});

test("obce stejného jména jsou oddělené podle okresu", () => {
  const places = buildPlaces([
    lib({ municipality: "Mikulov", district: "Břeclav", lat: 48.80, lon: 16.64 }),
    lib({ municipality: "Mikulov", district: "Břeclav", lat: 48.82, lon: 16.66 }),
    lib({ municipality: "Mikulov", district: "Teplice", lat: 50.69, lon: 13.72 }),
    lib({ municipality: "Bez polohy", district: "Kolín", lat: null, lon: null }),
  ]);
  const mikulov = places.filter((p) => p.name === "Mikulov").sort((a, b) => a.lat - b.lat);
  assert.equal(mikulov.length, 2);
  assert.equal(mikulov[0].district, "Břeclav");
  assert.ok(Math.abs(mikulov[0].lat - 48.81) < 1e-9);
  assert.equal(mikulov[1].district, "Teplice");
  assert.ok(!places.some((p) => p.name === "Bez polohy"));
});

test("otevřeno teď s neznámými: otevřené zvlášť, neznámé zvlášť, zavřené nikde", () => {
  const r = applyFilters(libs, { ...base, openNow: true }, NOW);
  assert.deepEqual(ids(r.matching), ["branch", "brno", "open"]);
  assert.deepEqual(ids(r.unknownHours), ["unknown"]);
});

test("bez neznámých je skupina neznámých prázdná", () => {
  const r = applyFilters(libs, { ...base, openNow: true, includeUnknown: false }, NOW);
  assert.deepEqual(r.unknownHours, []);
  const all = applyFilters(libs, { ...base, includeUnknown: false }, NOW);
  assert.ok(!ids(all.matching).includes("unknown"));
});

test("bez časového filtru jsou všechny v jednom seznamu", () => {
  const r = applyFilters(libs, base, NOW);
  assert.equal(r.matching.length, 5);
  assert.deepEqual(r.unknownHours, []);
});

test("jen hlavní budovy vyřadí pobočky", () => {
  assert.ok(!ids(applyFilters(libs, { ...base, mainOnly: true }, NOW).matching).includes("branch"));
});

test("kraj, okres, kategorie a služby", () => {
  assert.deepEqual(ids(applyFilters(libs, { ...base, region: "Jihomoravský" }, NOW).matching), ["brno"]);
  // okres bez kraje se ignoruje
  assert.equal(applyFilters(libs, { ...base, district: "Brno-město" }, NOW).matching.length, 5);
  assert.deepEqual(ids(applyFilters(libs, { ...base, categories: new Set(["krajske"]) }, NOW).matching), ["brno"]);
  assert.deepEqual(ids(applyFilters(libs, { ...base, services: new Set(["wifi"]) }, NOW).matching), ["branch"]);
});

test("vzdálenost Praha–Brno je asi 185 km", () => {
  const d = distanceKm({ lat: 50.0755, lon: 14.4378 }, { lat: 49.1951, lon: 16.6068 });
  assert.ok(Math.abs(d - 185) < 5, String(d));
});

test("řazení podle vzdálenosti, bez bodu podle názvu česky", () => {
  const near = [lib({ id: "a", name: "Čáslav", lat: 49.9, lon: 15.4 }), lib({ id: "b", name: "Cerhenice", lat: 50.07, lon: 15.07 })];
  assert.deepEqual(sortForList(near, { lat: 50.07, lon: 15.07 }).map((l) => l.id), ["b", "a"]);
  assert.deepEqual(sortForList(near, null).map((l) => l.name), ["Cerhenice", "Čáslav"]);
});
