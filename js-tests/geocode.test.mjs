import { test } from "node:test";
import assert from "node:assert/strict";
import { createGeocoder } from "../docs/js/geocode.js";

function setup(responses) {
  const calls = [];
  const slept = [];
  let clock = 1000;
  const geocode = createGeocoder({
    fetchJson: async (query) => {
      calls.push(query);
      const r = typeof responses === "function" ? responses(query) : responses;
      if (r instanceof Error) throw r;
      return r;
    },
    now: () => clock,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
  });
  return { geocode, calls, slept, tick: (ms) => (clock += ms) };
}

const HIT = [{ lat: "50.08", lon: "14.42", name: "Praha", addresstype: "city" }];

test("opakovaný dotaz jde z mezipaměti", async () => {
  const { geocode, calls } = setup(HIT);
  assert.equal((await geocode("Praha")).name, "Praha");
  assert.equal((await geocode("  praha ")).name, "Praha");
  assert.equal(calls.length, 1);
});

test("dvě odeslání najednou pošlou jeden dotaz", async () => {
  const { geocode, calls } = setup(HIT);
  const [a, b] = await Promise.all([geocode("Brno"), geocode("Brno")]);
  assert.equal(calls.length, 1);
  assert.equal(a, b);
});

test("během běžícího dotazu se jiný dotaz neodešle", async () => {
  const { geocode, calls } = setup(HIT);
  const first = geocode("Brno");
  const second = await geocode("Ostrava");
  assert.equal(second, undefined);
  await first;
  assert.equal(calls.length, 1);
});

test("mezi dotazy aspoň sekunda", async () => {
  const { geocode, slept, tick } = setup(HIT);
  await geocode("Brno");
  tick(250);
  await geocode("Ostrava");
  assert.deepEqual(slept, [750]);
});

test("nenalezeno se pamatuje, chyba sítě ne", async () => {
  let fail = true;
  const { geocode, calls } = setup((q) => (q === "xqzw" ? [] : fail ? new Error("offline") : HIT));
  assert.equal(await geocode("xqzw"), null);
  assert.equal(await geocode("xqzw"), null);
  await assert.rejects(geocode("Plzeň"));
  fail = false;
  assert.equal((await geocode("Plzeň")).name, "Praha");
  assert.equal(calls.length, 3);
});
