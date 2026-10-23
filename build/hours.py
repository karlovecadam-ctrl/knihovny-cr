"""Převod otevírací doby z pole OTD (podpole 1–7 = Po–Ne, p = poznámka) na intervaly.

Převádí se jen jednoznačné zápisy časů. Cokoli dalšího (poznámky v textu dne,
sudé týdny, „po dohodě“) znamená, že den nejde převést, a celý týden se pak
zobrazí jako původní text se stavem „nelze určit“.
"""

import re
import unicodedata

CLOSED = {"", "-", "zavřeno", "zavreno"}

# Poznámky, které rozvrh omezují (návrh 5.3: „otevřeno“ nikdy na základě odhadu).
# „summer“ = platí jen o prázdninách (stránka pak v červenci a srpnu ukáže „nelze určit“),
# „always“ = rozvrh neplatí každý týden nebo je knihovna zavřená.
SUMMER = re.compile(r"cerven|cervn|srpen|srpn|prazdnin|letni|\blet[eaou]\b")
ALWAYS = re.compile(r"\bsud|\blich|\d+\.\s*(a\s*\d+\.\s*)?(sobot|nedel|pondel|uter|stred|ctvrt|patek|patk|tyd)|v mesici|"
                    r"kazd\w*\s+(prvn|druh|tret|ctvrt|posledn)|jednou za|\d\s*x\s*(za|mesic|tyd)|mimo provoz|"
                    r"rekonstrukc|uzavren|zavren|docasn|zimni|\bzim[ea]\b|vanoc")
HOLIDAY = re.compile(r"svat")


def _plain(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)).lower()


def qualify(note: str | None) -> str | None:
    if not note:
        return None
    found = None
    # věta končí interpunkcí a další začíná velkým písmenem (ne „1. sobotu“)
    sentences = re.split(r"(?<=[.!?;])\s+(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ])|\n", note)
    for sentence in map(_plain, sentences):
        if HOLIDAY.search(sentence):
            continue  # státní svátky řeší stránka sama
        if SUMMER.search(sentence):
            found = found or "summer"
        elif ALWAYS.search(sentence):
            return "always"
    return found


def merge_otd(occurrences: list[dict[str, list[str]]]) -> dict[str, list[str]] | None:
    """Spojí opakovaná pole OTD; když se pro stejný den liší, den nepůjde převést."""
    merged: dict[str, list[str]] = {}
    for occ in occurrences:
        for code, values in occ.items():
            if code == "p":
                merged.setdefault("p", []).extend(values)
            elif code in merged and merged[code] != values:
                merged[code] = [" / ".join(merged[code] + values)]
            else:
                merged[code] = list(values)
    if "p" in merged:
        merged["p"] = [" ".join(merged["p"])]
    return merged or None
SEPARATOR = re.compile(r"\s*(?:;|,|\s+a\s+)\s*")
INTERVAL = re.compile(r"^(\d{1,2})(?:[:.](\d{2}))?\s*-\s*(\d{1,2})(?:[:.](\d{2}))?$")
DAY_CODES = "1234567"


def _time(h: str, m: str | None) -> str | None:
    hour, minute = int(h), int(m or 0)
    if hour > 24 or minute > 59 or (hour == 24 and minute):
        return None
    return f"{hour:02d}:{minute:02d}"


def parse_day(text: str) -> list[tuple[str, str]] | None:
    """Intervaly jednoho dne; [] = zavřeno, None = nejde jednoznačně převést."""
    text = text.replace("–", "-").replace("—", "-").strip()
    if text.lower() in CLOSED:
        return []
    out = []
    for part in SEPARATOR.split(text):
        m = INTERVAL.match(part)
        if not m:
            return None
        start, end = _time(m[1], m[2]), _time(m[3], m[4])
        if not start or not end or start >= end:
            return None
        out.append((start, end))
    return out


def parse_hours(otd: dict[str, list[str]] | None) -> dict | None:
    """Otevírací doba ve tvaru datového kontraktu webu, nebo None, když OTD chybí."""
    if not otd:
        return None
    raw = {code: otd[code][0] for code in DAY_CODES if otd.get(code)}
    note = (otd.get("p") or [None])[0]
    days: list | None = []
    for code in DAY_CODES:
        parsed = parse_day(raw[code]) if code in raw else []
        if parsed is None:
            days = None
            break
        days.append([list(iv) for iv in parsed])
    if not raw:
        days = None
    return {"days": days, "parsed": days is not None, "qualified": qualify(note), "raw": raw, "note": note}
