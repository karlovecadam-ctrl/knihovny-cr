import { test } from "node:test";
import assert from "node:assert/strict";
import { formatFund, formatInterval, mapyUrl, plural, statusText } from "../docs/js/format.js";

test("české tvary počtu", () => {
  const forms = ["knihovna", "knihovny", "knihoven"];
  assert.equal(plural(1, forms), "1 knihovna");
  assert.equal(plural(3, forms), "3 knihovny");
  assert.equal(plural(5, forms), "5 knihoven");
  assert.equal(plural(0, forms), "0 knihoven");
  assert.equal(plural(1234, forms), "1 234 knihoven");
});

test("text stavu", () => {
  assert.equal(statusText({ state: "open", until: "18:00" }, 1), "Otevřeno · do 18:00");
  assert.equal(statusText({ state: "closed", next: { day: 1, time: "13:00" } }, 1), "Zavřeno · otevírá ve 13:00");
  assert.equal(statusText({ state: "closed", next: { day: 2, time: "09:00" } }, 1), "Zavřeno · otevírá zítra v 9:00");
  assert.equal(statusText({ state: "closed", next: { day: 4, time: "16:00" } }, 1), "Zavřeno · otevírá Pá 16:00");
  assert.equal(statusText({ state: "closed", next: { day: 0, time: "08:00" } }, 6), "Zavřeno · otevírá zítra v 8:00");
  assert.equal(statusText({ state: "closed" }, 1), "Zavřeno");
  assert.equal(statusText({ state: "unknown" }, 1, false), "Otevírací doba neuvedena");
  assert.equal(statusText({ state: "unknown" }, 1, true), "Otevírací dobu nelze určit");
  assert.equal(statusText({ state: "unknown", reason: "qualified" }, 1, true), "Otevírací doba má výjimky, viz poznámka");
  assert.equal(statusText({ state: "unknown", reason: "holiday" }, 1, true), "Dnes je státní svátek, otevření ověřte");
});

test("interval bez úvodní nuly", () => {
  assert.equal(formatInterval(["09:00", "12:00"]), "9:00–12:00");
});

test("odkaz na Mapy.cz", () => {
  assert.equal(mapyUrl(50.0864, 14.4157),
    "https://mapy.com/fnc/v1/showmap?mapset=basic&center=14.4157,50.0864&zoom=17&marker=true");
});

test("fond", () => {
  assert.equal(formatFund({ books: 85400, periodicals: 120, year: 2025 }), "85 400 knih · 120 titulů periodik (2025)");
  assert.equal(formatFund({ books: 3200, periodicals: null, year: null }), "3 200 knih");
  assert.equal(formatFund(null), null);
});
