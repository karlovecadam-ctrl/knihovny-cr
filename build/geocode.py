"""Souřadnice: převod GPS z ADR a dohledání chybějící polohy přes Nominatim."""

import json
import os
import re
import time
import urllib.parse
import urllib.request
from typing import Callable

DMS = re.compile(r"(\d+)°\s*(\d+)'\s*([\d.]+)\"?\s*([NS])\s*,?\s*(\d+)°\s*(\d+)'\s*([\d.]+)\"?\s*([EW])")
# Hrubý obdélník kolem ČR, aby se chybné souřadnice neukázaly jinde v Evropě.
CZ_BOUNDS = (48.5, 51.1, 12.0, 18.9)

NOMINATIM = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "knihovny-cr/1.0 (+https://github.com/karlovecadam-ctrl/knihovny-cr)"


def in_cz(lat: float, lon: float) -> bool:
    return CZ_BOUNDS[0] <= lat <= CZ_BOUNDS[1] and CZ_BOUNDS[2] <= lon <= CZ_BOUNDS[3]


def parse_dms(text: str) -> tuple[float, float] | None:
    m = DMS.search(text or "")
    if not m:
        return None
    lat = int(m[1]) + int(m[2]) / 60 + float(m[3]) / 3600
    lon = int(m[5]) + int(m[6]) / 60 + float(m[7]) / 3600
    if m[4] == "S":
        lat = -lat
    if m[8] == "W":
        lon = -lon
    lat, lon = round(lat, 6), round(lon, 6)
    return (lat, lon) if in_cz(lat, lon) else None


def http_fetch(query: str) -> list[dict]:
    params = urllib.parse.urlencode({"format": "jsonv2", "countrycodes": "cz", "limit": 1, "q": query})
    req = urllib.request.Request(f"{NOMINATIM}?{params}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)


class Geocoder:
    """Nominatim s mezipamětí v JSON a nejvýš jedním dotazem za `min_interval` sekund."""

    def __init__(self, cache_path: str, fetch: Callable[[str], list[dict]] = http_fetch,
                 min_interval: float = 1.0, sleep: Callable[[float], None] = time.sleep,
                 clock: Callable[[], float] = time.monotonic):
        self.cache_path = cache_path
        self.fetch = fetch
        self.min_interval = min_interval
        self.sleep = sleep
        self.clock = clock
        self.last: float | None = None
        self.requests = 0
        try:
            with open(cache_path, encoding="utf-8") as f:
                self.cache = json.load(f)
        except FileNotFoundError:
            self.cache = {}

    def _save(self) -> None:
        os.makedirs(os.path.dirname(self.cache_path) or ".", exist_ok=True)
        with open(self.cache_path, "w", encoding="utf-8") as f:
            json.dump(self.cache, f, ensure_ascii=False, indent=0)

    def locate(self, address: str) -> tuple[float, float] | None:
        if address in self.cache:
            hit = self.cache[address]
            return tuple(hit) if hit else None
        if self.last is not None:
            wait = self.min_interval - (self.clock() - self.last)
            if wait > 0:
                self.sleep(wait)
        self.last = self.clock()
        self.requests += 1
        try:
            results = self.fetch(address)
        except (OSError, ValueError):
            return None
        point = None
        if results:
            lat, lon = round(float(results[0]["lat"]), 6), round(float(results[0]["lon"]), 6)
            point = (lat, lon) if in_cz(lat, lon) else None
        self.cache[address] = list(point) if point else None
        self._save()
        return point
