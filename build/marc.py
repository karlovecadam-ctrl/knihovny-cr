"""Čtení exportu ADR (MARC21 slim XML, případně gzip) do jednoduchých slovníků."""

import gzip
import xml.etree.ElementTree as ET
from typing import Iterator

NS = "{http://www.loc.gov/MARC21/slim}"

# tag -> výskyty pole -> kód podpole -> hodnoty
Record = dict[str, list[dict[str, list[str]]]]


def _open(path: str):
    if path.endswith(".gz"):
        return gzip.open(path, "rb")
    return open(path, "rb")


def read_records(path: str) -> Iterator[Record]:
    with _open(path) as f:
        for _, el in ET.iterparse(f, events=("end",)):
            if el.tag != NS + "record":
                continue
            rec: Record = {}
            for df in el.iter(NS + "datafield"):
                occ: dict[str, list[str]] = {}
                for sf in df.iter(NS + "subfield"):
                    text = (sf.text or "").strip()
                    if text:
                        occ.setdefault(sf.get("code"), []).append(text)
                rec.setdefault(df.get("tag"), []).append(occ)
            el.clear()
            yield rec


def first(rec: Record, tag: str, code: str) -> str | None:
    for occ in rec.get(tag, []):
        values = occ.get(code)
        if values:
            return values[0]
    return None
