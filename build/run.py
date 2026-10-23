"""Obnovení snímku dat: python -m build.run (výchozí cesty viz --help)."""

import argparse
import datetime
import os
import sys

from build.export import build_libraries, summary, write_csv, write_json
from build.geocode import Geocoder
from build.marc import first, read_records
from build.privacy import NameIndex

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Zpracuje adresář knihoven NK ČR pro web Knihovny ČR.")
    p.add_argument("--adr", default=os.path.join(ROOT, "raw", "adr.xml.gz"))
    p.add_argument("--json", default=os.path.join(ROOT, "docs", "data", "knihovny.json"))
    p.add_argument("--csv", default=os.path.join(ROOT, "..", "knihovny.csv"))
    p.add_argument("--summary", default=os.path.join(ROOT, "cache", "summary.txt"))
    p.add_argument("--geocode-cache", default=os.path.join(ROOT, "cache", "geocode.json"))
    p.add_argument("--no-geocode", action="store_true", help="nedohledávat chybějící polohu přes Nominatim")
    p.add_argument("--generated", default=datetime.date.today().isoformat())
    args = p.parse_args(argv)

    records = list(read_records(args.adr))
    geocoder = None if args.no_geocode else Geocoder(args.geocode_cache)
    libs = build_libraries(records, geocoder=geocoder, names=NameIndex.from_records(records))

    ids = {lib["id"] for lib in libs}
    used = [r for r in records if first(r, "SGL", "a") in ids]
    raw_counts = {
        "emails": sum(len(o.get("u", [])) for r in used for o in r.get("EML", [])),
        "phones": sum(len(o.get("a", [])) for r in used for o in r.get("TEL", [])),
    }
    text = f"Snímek dat k {args.generated}\n" + summary(libs, raw_counts)
    if geocoder:
        text += f"\nDotazů na Nominatim v tomto běhu: {geocoder.requests}"

    write_json(libs, args.json, args.generated)
    write_csv(libs, args.csv)
    os.makedirs(os.path.dirname(args.summary) or ".", exist_ok=True)
    with open(args.summary, "w", encoding="utf-8") as f:
        f.write(text + "\n")
    sys.stdout.reconfigure(encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
