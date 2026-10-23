// Hledání adres přes Nominatim podle jeho pravidel: nejvýš 1 dotaz za sekundu, výsledky v mezipaměti,
// během běžícího dotazu se další neodešle (vrátí undefined).
import { normalize } from "./filters.js";

export function createGeocoder({
  fetchJson,
  minInterval = 1000,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const cache = new Map();
  let inflight = null;
  let last = -Infinity;

  return function geocode(query) {
    const key = normalize(query).replace(/\s+/g, " ");
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (inflight) return inflight.key === key ? inflight.promise : Promise.resolve(undefined);
    const promise = (async () => {
      const wait = minInterval - (now() - last);
      if (wait > 0) await sleep(wait);
      last = now();
      const results = await fetchJson(query.trim());
      const hit = results && results.length ? results[0] : null;
      cache.set(key, hit); // i „nenalezeno“; chyba sítě se neukládá
      return hit;
    })().finally(() => {
      inflight = null;
    });
    inflight = { key, promise };
    return promise;
  };
}
