import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeFilterChips, clearFilter, defaultSort, hashFor, page, parseHash, shouldShowStart, sortLibraries,
} from "../docs/js/view.js";

const CATEGORIES = [["obecni", "Obecní a městské"], ["krajske", "Krajské"], ["vysokoskolske", "Vysokoškolské"], ["odborne", "Odborné"]];
const SERVICES = [["wifi", "Wi-Fi"], ["bibliobox", "Bibliobox"]];
const empty = () => [[], [], [], [], [], [], []];
const tue = (from, to) => {
  const days = empty();
  days[1] = [[from, to]];
  return { days, parsed: true, raw: {}, note: null };
};
const NOW = new Date("2026-10-20T08:00:00Z"); // Út 10:00
const HOLIDAY = new Date("2026-10-28T08:00:00Z"); // St 28. 10.
const base = {
  region: "", district: "", categories: new Set(), mainOnly: false, openNow: false, weekend: false,
  includeUnknown: true, services: new Set(),
};
const libs = [
  { id: "c", name: "Čáslav", lat: 49.91, lon: 15.39, hours: tue("16:00", "18:00") }, // zavřeno
  { id: "a", name: "Brno", lat: 49.19, lon: 16.61, hours: tue("09:00", "18:00") }, // otevřeno
  { id: "u", name: "Aš", lat: 50.22, lon: 12.19, hours: null }, // nelze určit
  { id: "q", name: "Dobříš", lat: 49.78, lon: 14.17, hours: { ...tue("09:00", "18:00"), qualified: "always" } },
  { id: "n", name: "Bez polohy", lat: null, lon: null, hours: tue("09:00", "18:00") },
];
const ids = (list) => list.map((l) => l.id);
const PRAHA = { lat: 50.08, lon: 14.42 };

test("řazení podle názvu česky", () => {
  assert.deepEqual(ids(sortLibraries(libs, "name", null, NOW)), ["u", "n", "a", "c", "q"]);
});

test("řazení podle vzdálenosti, knihovny bez polohy na konci", () => {
  // Dobříš 38 km, Čáslav 72 km, Aš 159 km, Brno 185 km
  assert.deepEqual(ids(sortLibraries(libs, "distance", PRAHA, NOW)), ["q", "c", "u", "a", "n"]);
});

test("nejdřív otevřené: otevřené, zavřené, nelze určit", () => {
  assert.deepEqual(ids(sortLibraries(libs, "open", null, NOW)), ["n", "a", "c", "u", "q"]);
  assert.deepEqual(ids(sortLibraries(libs, "open", PRAHA, NOW)), ["a", "n", "c", "q", "u"]);
});

test("nejdřív otevřené ve svátek: všechny nelze určit, pak podle názvu", () => {
  assert.deepEqual(ids(sortLibraries(libs, "open", null, HOLIDAY)), ["u", "n", "a", "c", "q"]);
});

test("výchozí řazení", () => {
  assert.equal(defaultSort(null), "name");
  assert.equal(defaultSort(PRAHA), "distance");
});

test("štítky aktivních filtrů", () => {
  const f = {
    ...base, region: "Středočeský", district: "Kolín", categories: new Set(["obecni", "krajske", "odborne"]),
    mainOnly: true, openNow: true, weekend: true, includeUnknown: false, services: new Set(["wifi"]),
  };
  assert.deepEqual(activeFilterChips(f, CATEGORIES, SERVICES).map((c) => c.label), [
    "otevřeno teď", "o víkendu", "bez neuvedené doby", "Středočeský", "okres Kolín", "bez: Vysokoškolské",
    "jen hlavní budovy", "Wi-Fi",
  ]);
  assert.deepEqual(activeFilterChips(base, CATEGORIES, SERVICES), []);
  assert.equal(activeFilterChips({ ...base, district: "Kolín" }, CATEGORIES, SERVICES).length, 0);
});

test("žádný typ = štítky pro všechny typy", () => {
  const f = { ...base, categories: new Set(["__none__"]) };
  assert.equal(activeFilterChips(f, CATEGORIES, SERVICES).length, 4);
});

test("zrušení jednoho filtru", () => {
  const keys = CATEGORIES.map(([k]) => k);
  const f = {
    ...base, region: "Středočeský", district: "Kolín", categories: new Set(["obecni", "krajske", "odborne"]),
    mainOnly: true, openNow: true, weekend: true, includeUnknown: false, services: new Set(["wifi", "bibliobox"]),
  };
  assert.deepEqual([clearFilter(f, "region", keys).region, clearFilter(f, "region", keys).district], ["", ""]);
  assert.equal(clearFilter(f, "district", keys).district, "");
  assert.equal(clearFilter(f, "district", keys).region, "Středočeský");
  assert.equal(clearFilter(f, "cat:vysokoskolske", keys).categories.size, 0); // všechny typy = bez filtru
  assert.equal(clearFilter(f, "openNow", keys).openNow, false);
  assert.equal(clearFilter(f, "weekend", keys).weekend, false);
  assert.equal(clearFilter(f, "mainOnly", keys).mainOnly, false);
  assert.equal(clearFilter(f, "unknown", keys).includeUnknown, true);
  assert.deepEqual([...clearFilter(f, "svc:wifi", keys).services], ["bibliobox"]);
  assert.equal(f.openNow, true, "původní objekt se nemění");
  const none = clearFilter({ ...base, categories: new Set(["__none__"]) }, "cat:obecni", keys);
  assert.deepEqual([...none.categories], ["obecni"]);
});

test("odkaz #id", () => {
  assert.equal(parseHash(""), null);
  assert.equal(parseHash("#"), null);
  assert.equal(parseHash("#ABA000"), "ABA000");
  assert.equal(parseHash("#ABA006-a1b2c3"), "ABA006-a1b2c3");
  assert.equal(parseHash("#<script>"), null);
  assert.equal(parseHash("#a%20b"), null);
  assert.equal(hashFor("KOE001"), "#KOE001");
});

test("úvodní obrazovka", () => {
  const s = { dismissed: false, point: null, filtersActive: false, zoom: 7 };
  assert.equal(shouldShowStart(s), true);
  assert.equal(shouldShowStart({ ...s, dismissed: true }), false);
  assert.equal(shouldShowStart({ ...s, point: PRAHA }), false);
  assert.equal(shouldShowStart({ ...s, filtersActive: true }), false);
  assert.equal(shouldShowStart({ ...s, zoom: 9 }), false);
  assert.equal(shouldShowStart({ ...s, zoom: 8 }), true);
});

test("stránkování", () => {
  const list = Array.from({ length: 120 }, (_, i) => i);
  assert.deepEqual(page(list, 50, 1).items.length, 50);
  assert.equal(page(list, 50, 1).hasMore, true);
  assert.equal(page(list, 50, 3).items.length, 120);
  assert.equal(page(list, 50, 3).hasMore, false);
});
