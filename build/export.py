"""Sestavení záznamů pro web (datový kontrakt v plánu), zápis JSON a CSV a souhrn vyplněnosti."""

import collections
import hashlib
import csv
import json
import os
import re

from build.geocode import parse_dms
from build.hours import merge_otd, parse_hours
from build.marc import Record, first
from build.privacy import NameIndex, director, normalize, public_emails, public_phones, sanitize_text
from build.select import category, expand_branches, is_public

CATALOG_HINTS = ("katalog", "opac", "tritius", "clavius", "koha", "verbis", "aleph", "primo", "carmen")
SERVICE_KEYS = {"wifi": "wifi", "bibliobox": "bibliobox"}

CSV_COLUMNS = ["id", "název", "kategorie", "typ", "kraj", "okres", "adresa", "obec", "lat", "lon",
               "poloha přibližná", "web", "e-maily", "telefony", "ředitel", "otevírací doba", "mateřská knihovna"]
DAY_NAMES = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"]


def _join(*parts) -> str:
    return " – ".join(p for p in parts if p)


def _name(rec: Record) -> str:
    return _join(*(first(rec, "NAZ", c) for c in "abc"))


def _address(street: str | None, zip_code: str | None, town: str | None) -> str:
    return ", ".join(p for p in [street, " ".join(x for x in [zip_code, town] if x)] if p)


def _urls(rec: Record) -> tuple[str | None, str | None]:
    web = catalog = facebook = None
    for occ in rec.get("URL", []):
        url = (occ.get("u") or [None])[0]
        # do odkazu na stránce smí jen http(s)
        if not url or not re.match(r"https?://", url, re.IGNORECASE):
            continue
        hint = (url + " " + " ".join(occ.get("z", []))).lower()
        if any(h in hint for h in CATALOG_HINTS):
            catalog = catalog or url
        elif "facebook" in hint:
            facebook = facebook or url
        else:
            web = web or url
    # stránka na Facebooku jen tehdy, když knihovna jiný web nemá
    return web or facebook, catalog


def _services(rec: Record) -> tuple[list[str], list[str]]:
    labels = [v for occ in rec.get("SLU", []) for v in occ.get("a", [])]
    keys = [key for key, needle in SERVICE_KEYS.items() if any(needle in v.lower() for v in labels)]
    return labels, keys


def _number(text: str | None) -> int | None:
    m = re.match(r"\s*(\d+)", text or "")
    return int(m[1]) if m else None


def _fund(rec: Record) -> dict | None:
    if not rec.get("FND"):
        return None
    year = _number(first(rec, "FND", "r"))
    fund = {"books": _number(first(rec, "FND", "k")), "periodicals": _number(first(rec, "FND", "p")),
            "year": year if year and year > 1900 else None}
    return fund if fund["books"] or fund["periodicals"] else None


def _professional(rec: Record) -> bool | None:
    values = {v for occ in rec.get("FCE", []) for v in occ.get("a", [])}
    if "profesionální" in values:
        return True
    if "neprofesionální" in values:
        return False
    return None


def _locate(gps: str | None, address: str, geocoder) -> tuple[float | None, float | None, bool]:
    point = parse_dms(gps) if gps else None
    if point:
        return point[0], point[1], False
    if geocoder and address:
        point = geocoder.locate(address)
        if point:
            return point[0], point[1], True
    return None, None, False


def to_site_record(rec: Record, names: NameIndex | None = None, geocoder=None, fallback_gps: str | None = None) -> dict:
    """`fallback_gps` (např. GPS pobočky ze záznamu mateřské knihovny) má přednost před dohledáním z adresy."""
    address = _address(first(rec, "ADR", "u"), first(rec, "ADR", "c"), first(rec, "ADR", "m"))
    gps = first(rec, "ADR", "g")
    if not parse_dms(gps or ""):
        gps = fallback_gps
    lat, lon, approx = _locate(gps, address, geocoder)
    web, catalog = _urls(rec)
    services, keys = _services(rec)
    type_label = first(rec, "TYP", "b") or ""
    pvk = first(rec, "PVK", "s")
    hours = parse_hours(merge_otd(rec.get("OTD", [])))
    if hours:
        hours["note"] = sanitize_text(hours["note"], names)
        hours["raw"] = {code: sanitize_text(text, names) for code, text in hours["raw"].items()}
    return {
        "id": first(rec, "SGL", "a"),
        "name": _name(rec),
        "category": category(rec),
        "typeLabel": type_label[:1].upper() + type_label[1:],
        "professional": _professional(rec),
        "region": first(rec, "KRJ", "a"),
        "district": first(rec, "KRJ", "b"),
        "address": address,
        "municipality": first(rec, "MES", "a") or first(rec, "ADR", "m"),
        "lat": lat, "lon": lon, "approx": approx,
        "hours": hours,
        "web": web, "catalog": catalog,
        "emails": public_emails(rec, names),
        "phones": public_phones(rec),
        "director": director(rec),
        "services": services, "serviceKeys": keys,
        "parent": None, "branches": [],
        "supervisor": {"id": pvk, "name": first(rec, "PVK", "n")} if pvk else None,
        "fund": _fund(rec),
    }


def branch_id(parent_id: str, name: str | None, address: str) -> str:
    """Stabilní ID pobočky bez vlastního záznamu: nezávisí na pořadí poboček v ADR,
    takže odkaz `#id` vede po obnovení dat na stejnou pobočku."""
    key = re.sub(r"\s+", " ", normalize(f"{name or ''}|{address}")).strip()
    return f"{parent_id}-{hashlib.sha1(key.encode('utf-8')).hexdigest()[:6]}"


def _branch_without_record(pob: dict, parent: dict, branch_id: str, geocoder) -> dict:
    get = lambda code: (pob.get(code) or [None])[0]  # noqa: E731
    address = _address(get("a"), None, get("m"))
    lat, lon, approx = _locate(get("g"), address, geocoder)
    return {
        "id": branch_id,
        "name": _join(parent["name"], get("n")),
        "category": parent["category"], "typeLabel": parent["typeLabel"], "professional": parent["professional"],
        "region": parent["region"], "district": parent["district"],
        "address": address, "municipality": get("m"),
        "lat": lat, "lon": lon, "approx": approx,
        "hours": None, "web": parent["web"], "catalog": parent["catalog"],
        "emails": [], "phones": [], "director": None, "services": [], "serviceKeys": [],
        "parent": None, "branches": [], "supervisor": None, "fund": None,
    }


def build_libraries(records: list[Record], geocoder=None, names: NameIndex | None = None) -> list[dict]:
    """Veřejně přístupné knihovny a jejich pobočky ve tvaru datového kontraktu."""
    if names is None:
        names = NameIndex.from_records(records)
    by_sigla = {first(r, "SGL", "a"): r for r in records}
    public = [r for r in records if is_public(r)]
    libs = [to_site_record(r, names, geocoder) for r in public]
    by_id = {lib["id"]: lib for lib in libs}
    for own, pob, parent_id in expand_branches(public, by_sigla):
        parent = by_id[parent_id]
        if own is not None and own.get("STT"):
            continue
        if own is not None:
            sigla = first(own, "SGL", "a")
            branch = by_id.get(sigla)
            if branch is None:
                branch = to_site_record(own, names, geocoder, fallback_gps=(pob.get("g") or [None])[0])
                libs.append(branch)
                by_id[sigla] = branch
        else:
            get = lambda code: (pob.get(code) or [""])[0]  # noqa: E731
            new_id = base = branch_id(parent_id, get("n"), _address(get("a"), None, get("m")))
            n = 1
            while new_id in by_id:  # dvě pobočky se stejným názvem i adresou
                n += 1
                new_id = f"{base}-{n}"
            branch = _branch_without_record(pob, parent, new_id, geocoder)
            libs.append(branch)
            by_id[new_id] = branch
        if branch["id"] != parent_id and branch["parent"] is None:
            branch["parent"] = parent_id
            parent["branches"].append(branch["id"])
    return libs


def write_json(libs: list[dict], path: str, generated: str) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"generated": generated, "libraries": libs}, f, ensure_ascii=False, separators=(",", ":"))


def _hours_text(hours: dict | None) -> str:
    if not hours:
        return ""
    raw = hours.get("raw") or {}
    return "; ".join(f"{DAY_NAMES[int(code) - 1]} {text}" for code, text in sorted(raw.items()))


def write_csv(libs: list[dict], path: str) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(CSV_COLUMNS)
        for lib in libs:
            w.writerow([
                lib["id"], lib["name"], lib["category"], lib["typeLabel"], lib["region"] or "",
                lib["district"] or "", lib["address"], lib["municipality"] or "",
                lib["lat"] if lib["lat"] is not None else "", lib["lon"] if lib["lon"] is not None else "",
                "ano" if lib["approx"] else "", lib["web"] or "", ", ".join(lib["emails"]),
                ", ".join(lib["phones"]), lib["director"]["name"] if lib["director"] else "",
                _hours_text(lib["hours"]), lib["parent"] or "",
            ])


def summary(libs: list[dict], raw_counts: dict | None = None) -> str:
    total = len(libs)
    branches = sum(1 for lib in libs if lib["parent"])
    cats = collections.Counter(lib["category"] for lib in libs)
    exact = sum(1 for lib in libs if lib["lat"] is not None and not lib["approx"])
    approx = sum(1 for lib in libs if lib["approx"])
    hours = [lib["hours"] for lib in libs if lib["hours"]]
    parsed = sum(1 for h in hours if h["parsed"])
    pct = lambda n: f"{n / total:.0%}" if total else "–"  # noqa: E731
    lines = [
        f"Knihoven celkem: {total}",
        f"  z toho pobočky: {branches}",
        "  podle kategorie: " + ", ".join(f"{k} {v}" for k, v in cats.most_common()),
        f"Poloha přesná (GPS z adresáře): {exact} ({pct(exact)})",
        f"Poloha přibližná (dohledaná z adresy): {approx} ({pct(approx)})",
        f"Bez polohy (nebudou na mapě): {total - exact - approx}",
        f"Otevírací doba vyplněná: {len(hours)} ({pct(len(hours))})",
        f"  z toho převedená (stav otevřeno/zavřeno): {parsed} ({pct(parsed)})",
        f"  jen jako text (stav nelze určit): {len(hours) - parsed}",
        f"Bez otevírací doby: {total - len(hours)}",
        f"Web: {sum(1 for lib in libs if lib['web'])} · katalog: {sum(1 for lib in libs if lib['catalog'])}",
        f"S aspoň jedním e-mailem: {sum(1 for lib in libs if lib['emails'])}"
        f" · s telefonem: {sum(1 for lib in libs if lib['phones'])}",
        f"Jméno ředitele/vedoucího zobrazeno: {sum(1 for lib in libs if lib['director'])}",
        f"Služby vyplněné: {sum(1 for lib in libs if lib['services'])}"
        f" · Wi-Fi: {sum(1 for lib in libs if 'wifi' in lib['serviceKeys'])}"
        f" · bibliobox: {sum(1 for lib in libs if 'bibliobox' in lib['serviceKeys'])}",
    ]
    if raw_counts:
        shown_e = sum(len(lib["emails"]) for lib in libs)
        shown_t = sum(len(lib["phones"]) for lib in libs)
        lines.append(f"Skryté jako možné osobní údaje: e-maily {raw_counts['emails'] - shown_e} z {raw_counts['emails']},"
                     f" telefonní čísla {raw_counts['phones'] - shown_t} z {raw_counts['phones']}")
    return "\n".join(lines)
