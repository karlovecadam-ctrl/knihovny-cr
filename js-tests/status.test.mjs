import { test } from "node:test";
import assert from "node:assert/strict";
import { isHoliday, openOnWeekend, openStatus, pragueDate, pragueNow } from "../docs/js/status.js";

const week = (days) => ({ days, parsed: true, raw: {}, note: null });
const empty = () => [[], [], [], [], [], [], []];

test("úterý 10:00 SELČ je otevřeno do 18:00", () => {
  const days = empty();
  days[1] = [["09:00", "18:00"]];
  const now = new Date("2026-10-20T08:00:00Z");
  assert.deepEqual(openStatus(week(days), now), { state: "open", until: "18:00" });
});

test("pražský čas nezávisí na časovém pásmu návštěvníka", () => {
  // stejný okamžik zapsaný s posunem pro Tokio
  const tokyo = new Date("2026-10-20T17:00:00+09:00");
  assert.deepEqual(pragueNow(tokyo), { day: 1, minutes: 10 * 60 });
});

test("den přechodu na zimní čas: 02:30 UTC je neděle 03:30 SEČ", () => {
  assert.deepEqual(pragueNow(new Date("2026-10-25T02:30:00Z")), { day: 6, minutes: 3 * 60 + 30 });
  assert.deepEqual(pragueNow(new Date("2026-10-25T00:30:00Z")), { day: 6, minutes: 2 * 60 + 30 });
});

test("polední pauza: zavřeno, otevírá ve 13:00 téhož dne", () => {
  const days = empty();
  days[2] = [["09:00", "12:00"], ["13:00", "18:00"]];
  const now = new Date("2026-10-21T10:30:00Z"); // St 12:30
  assert.deepEqual(openStatus(week(days), now), { state: "closed", next: { day: 2, time: "13:00" } });
});

test("po zavírací době ukáže nejbližší další den", () => {
  const days = empty();
  days[2] = [["16:00", "18:00"]];
  const now = new Date("2026-10-21T17:00:00Z"); // St 19:00
  assert.deepEqual(openStatus(week(days), now), { state: "closed", next: { day: 2, time: "16:00" } });
  const thu = new Date("2026-10-22T08:00:00Z"); // Čt 10:00
  assert.deepEqual(openStatus(week(days), thu), { state: "closed", next: { day: 2, time: "16:00" } });
});

test("v okamžiku zavření je zavřeno", () => {
  const days = empty();
  days[1] = [["09:00", "18:00"]];
  assert.equal(openStatus(week(days), new Date("2026-10-20T16:00:00Z")).state, "closed");
});

test("celý týden zavřeno: zavřeno bez dalšího otevření", () => {
  assert.deepEqual(openStatus(week(empty()), new Date("2026-10-20T08:00:00Z")), { state: "closed" });
});

test("neparsovaná nebo chybějící doba je neznámá", () => {
  const now = new Date("2026-10-20T08:00:00Z");
  assert.deepEqual(openStatus({ days: null, parsed: false, raw: { 1: "po dohodě" } }, now), { state: "unknown" });
  assert.deepEqual(openStatus(null, now), { state: "unknown" });
});

test("poznámka s výjimkami: stav nelze určit", () => {
  const days = empty();
  days[1] = [["09:00", "18:00"]];
  const now = new Date("2026-10-20T08:00:00Z");
  assert.deepEqual(openStatus({ ...week(days), qualified: "always" }, now), { state: "unknown", reason: "qualified" });
});

test("letní výjimka platí jen v červenci a srpnu", () => {
  const days = empty();
  days[1] = [["09:00", "18:00"]];
  days[2] = [["09:00", "18:00"]];
  const h = { ...week(days), qualified: "summer" };
  assert.equal(openStatus(h, new Date("2026-10-20T08:00:00Z")).state, "open");
  assert.deepEqual(openStatus(h, new Date("2026-07-15T08:00:00Z")), { state: "unknown", reason: "qualified" });
});

test("státní svátek: nikdy otevřeno", () => {
  const days = empty();
  days[2] = [["09:00", "18:00"]];
  assert.deepEqual(openStatus(week(days), new Date("2026-10-28T08:00:00Z")), { state: "unknown", reason: "holiday" });
});

test("svátky včetně Velikonoc", () => {
  for (const [y, m, d] of [[2026, 1, 1], [2026, 4, 3], [2026, 4, 6], [2027, 3, 26], [2027, 3, 29], [2026, 5, 8],
                           [2026, 7, 6], [2026, 9, 28], [2026, 11, 17], [2026, 12, 24], [2026, 12, 26]]) {
    assert.equal(isHoliday(y, m, d), true, `${d}. ${m}. ${y}`);
  }
  assert.equal(isHoliday(2026, 4, 5), false); // Velikonoční neděle není otevírací svátek pondělí
  assert.equal(isHoliday(2026, 10, 27), false);
});

test("pražské datum přes půlnoc na Silvestra", () => {
  assert.deepEqual(pragueDate(new Date("2026-12-31T23:30:00Z")), { year: 2027, month: 1, day: 1 });
});

test("otevřeno o víkendu", () => {
  const days = empty();
  assert.equal(openOnWeekend(week(days)), false);
  days[5] = [["09:00", "11:00"]];
  assert.equal(openOnWeekend(week(days)), true);
  assert.equal(openOnWeekend(null), null);
  assert.equal(openOnWeekend({ days: null, parsed: false }), null);
  assert.equal(openOnWeekend({ ...week(days), qualified: "always" }), null);
});
