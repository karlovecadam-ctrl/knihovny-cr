"""Pravidla pro osobní údaje (návrh, kap. 5.4).

Princip: v pochybnostech nezobrazit. Co tyto funkce nevrátí, se do výstupu
webu ani CSV nedostane. Pole PVZ (provozovatel a jeho odpovědná osoba) se
tady vůbec nečte.
"""

import re
import unicodedata
from dataclasses import dataclass, field

from build.marc import Record
from build.select import category

FREE_MAIL = {"seznam.cz", "email.cz", "gmail.com", "centrum.cz", "post.cz", "atlas.cz", "volny.cz",
             "tiscali.cz", "quick.cz", "outlook.com", "hotmail.com", "yahoo.com", "outlook.cz", "icloud.com"}

# Poznámka u telefonu, která ukazuje na konkrétní osobu => číslo nezobrazit.
PERSON_NOTE = re.compile(r"reditel|vedouc|knihovnic|knihovnik|starost|spravc|spravce|mobil|zastup|"
                         r"\bp\.|\bpan|\bpani|\bmgr|\bing|\bbc|\bphdr")
# Poznámka, která označuje instituci nebo pracoviště => číslo i s poznámkou zobrazit.
INSTITUTION_NOTE = re.compile(r"knihovn|obec|urad|\bou\b|\bmu\b|\bmek\b|\bmk\b|ustredn|mvs|studovn|pujcovn|"
                              r"sekretariat|informac|pobock|oddelen|\bodd\b|skol|muze|infocentr|katalog|vypujc|"
                              r"recepc|podatel|central|kancelar|galerie|archiv|badateln|dets|dospel|fax")
PHONE = re.compile(r"(?:(?:\+|00)420[\s/]*)?\d{3}[\s/]*\d{3}[\s/]*\d{3}")


def normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


@dataclass
class NameIndex:
    """Křestní jména a příjmení ze všech osob v ADR (pro osobní e-maily a poznámky) a názvy obcí,
    které se jako příjmení skrývat nemají."""
    first_names: set[str] = field(default_factory=set)
    surnames: set[str] = field(default_factory=set)
    places: set[str] = field(default_factory=set)

    def add(self, rec: Record) -> None:
        for tag, code in (("MES", "a"), ("ADR", "m"), ("POB", "m"), ("POB", "n")):
            for occ in rec.get(tag, []):
                for value in occ.get(code, []):
                    self.places.update(w for w in re.split(r"[^a-z]+", normalize(value)) if len(w) >= 4)
        for occ in rec.get("JMN", []):
            for k in occ.get("k", []):
                for part in normalize(k).split():
                    if len(part) >= 3:
                        self.first_names.add(part)
            for p in occ.get("p", []):
                for part in re.split(r"[\s-]+", normalize(p)):
                    if len(part) >= 4:
                        self.surnames.add(part)

    @classmethod
    def from_records(cls, recs) -> "NameIndex":
        index = cls()
        for rec in recs:
            index.add(rec)
        return index


def _fce(rec: Record) -> set[str]:
    return {v for occ in rec.get("FCE", []) for v in occ.get("a", [])}


def is_legal_entity(rec: Record) -> bool:
    return "právní subjektivita" in _fce(rec)


def director(rec: Record) -> dict | None:
    """Jméno a funkce vedoucího jen u knihoven s právní subjektivitou a u krajských a národních."""
    if not (is_legal_entity(rec) or category(rec) == "krajske"):
        return None
    people = rec.get("JMN", [])
    if not people:
        return None

    def role(occ):
        return normalize((occ.get("r") or [""])[0])

    def pick(word):
        return next((o for o in people if word in role(o) and not role(o).startswith("zastup")), None)

    occ = pick("reditel") or pick("vedouc")
    if occ is None:
        return None
    name = " ".join(v for code in "tkp" for v in occ.get(code, [])[:1])
    if occ.get("c"):
        name += ", " + occ["c"][0]
    return {"name": name, "role": (occ.get("r") or [None])[0]} if name.strip() else None


# Slova, podle kterých se pozná adresa instituce (knihovna.obec@, mvs-knihovna@, obec.lhota@).
GENERIC_WORDS = {"knihovna", "knihovny", "knih", "kniha", "info", "informace", "obec", "obecni", "ou", "mu", "urad",
                 "mestska", "mestsky", "mesto", "mk", "mek", "mvs", "podatelna", "sekretariat", "sekret", "pujcovna",
                 "studovna", "muzeum", "galerie", "archiv", "katalog", "regionalni", "reditel", "reditelka",
                 "vedouci", "lek", "gnr", "oddeleni", "odd", "detske", "deti", "dospeli", "centrum", "ustredna",
                 "skola", "zs", "ms", "kultura", "kulturni", "infocentrum", "tic", "ic", "badatelna", "bibliografie",
                 "citarna", "periodika", "literatura", "nakup", "akvizice", "referent", "digitalizace", "ezdroje",
                 "studijni", "vazba", "vypujcni", "protokol", "ziskej", "mestys", "detske", "dospela", "dospeli"}
OFFICE_PREFIXES = ("obec", "ou", "mu", "mk", "ok", "mesto")


def _letters(text: str) -> str:
    return re.sub(r"[^a-z]", "", normalize(text))


def _personal_email(local: str, names: NameIndex, place: str = "", domain: str = "") -> bool:
    """`place` = písmena z obce a názvu knihovny, `domain` = doména bez koncovky."""
    local = normalize(local)
    tokens = [t for t in re.split(r"[._\-\d]+", local) if t]
    if any(t in names.surnames or t in names.first_names for t in tokens):
        return True
    compact = "".join(tokens)
    # jnovak, jpnovak
    if any(compact[k:] in names.surnames for k in (1, 2)):
        return True
    generic = any(t in GENERIC_WORDS for t in tokens) or any(
        w in compact for w in GENERIC_WORDS if len(w) >= 4)
    if generic:
        return False
    # jmeno.prijmeni bez obecného slova
    if len(tokens) >= 2:
        return True
    # příjmení v ženském tvaru, i s iniciálou nebo jménem (zkouskova@, zkouskovam@, pokusnickai@)
    if "ova" in compact and len(compact) >= 6 or re.search(r"[sc]ka[a-z]?$", compact):
        return True
    # jedno slovo projde jen jako název obce/knihovny (oulhota@, testov@) nebo název domény (ktv@ktv.cz)
    stripped = [compact] + [compact[len(p):] for p in OFFICE_PREFIXES if compact.startswith(p)]
    if any(len(s) >= 3 and (s in place or s in domain) for s in stripped):
        return False
    return True


def public_emails(rec: Record, names: NameIndex | None = None) -> list[str]:
    own = NameIndex()
    own.add(rec)
    if names:
        own.first_names |= names.first_names
        own.surnames |= names.surnames
    legal = is_legal_entity(rec)
    place = _letters(" ".join(v for tag, code in [("MES", "a"), ("ADR", "m"), ("NAZ", "a"), ("NAZ", "b")]
                              for occ in rec.get(tag, []) for v in occ.get(code, [])))
    out = []
    for occ in rec.get("EML", []):
        for value in occ.get("u", []):
            # hodnota bývá doplněná poznámkou, např. „… (OÚ)“; bereme jen samotnou adresu
            found = EMAIL.search(value)
            if not found:
                continue
            email = found[0].rstrip(".")
            local, _, domain = email.partition("@")
            if not domain or _personal_email(local, own, place, _letters(domain.rsplit(".", 1)[0])):
                continue
            if not legal and normalize(domain) in FREE_MAIL:
                continue
            out.append(email)
    return out


EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_UPPER = "A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ"
_WORD = rf"[{_UPPER}][a-záčďéěíňóřšťúůýž]+"
_TITLE = r"(?:Mgr|Ing|Bc|PhDr|RNDr|MUDr|JUDr|PaedDr|Dr|DiS)\.?"
PERSON_MARKER = re.compile(rf"\b(?:p\.|pí\.?|paní|pana|panem|panu|pan|sl\.)\s*(?:{_TITLE}\s*)*{_WORD}(?:\s+{_WORD})?")
TITLED_NAME = re.compile(rf"\b(?:{_TITLE}\s*)+{_WORD}(?:\s+{_WORD})?")
NAME_PAIR = re.compile(rf"\b({_WORD})\s+({_WORD})")
# podpis za datem aktualizace: „12. 3. 2025 Novák“
DATE_SIGNATURE = re.compile(rf"(\d{{1,2}}\.\s*\d{{1,2}}\.\s*\d{{2,4}})\s+{_WORD}(?:\s+{_WORD})?")
# funkce a hned za ní jméno: „knihovnice Nováková“, „odpovědná osoba Novák“
ROLE_NAME = re.compile(rf"\b(knihovni(?:ce|ci|k|ka|kem)|odpovědná osoba|kontaktní osoba|kontakt|vedoucí|správce|správkyně|"
                       rf"domluvě s|dohodě s|domluvit s|dohodnout s)(\s*:?\s*){_WORD}(?:\s+{_WORD})?")
INSTITUTION_STEMS = ("mest", "obec", "knihov", "krajsk", "mistn", "urad", "muze", "skol", "zakladn", "spolek",
                     "farn", "kulturn", "regionaln", "poverene", "poveren")
# velké slovo, které není na začátku věty
MID_SENTENCE_WORD = re.compile(rf"(?<![.!?;:\n]\s)(?<!^)\b{_WORD}\b")


def sanitize_text(text: str | None, names: NameIndex | None = None) -> str | None:
    """Volný text (poznámky): skryje mobilní čísla, e-maily a jména osob."""
    if text is None:
        return None
    names = names or NameIndex()

    def phone(m):
        digits = re.sub(r"\D", "", m[0])[-9:]
        return "[telefon skryt]" if digits[0] in "67" else m[0]

    def pair(m):
        return "[jméno skryto]" if normalize(m[1]) in names.first_names else m[0]

    text = EMAIL.sub("[e-mail skryt]", text)
    text = PHONE.sub(phone, text)
    text = PERSON_MARKER.sub("[jméno skryto]", text)
    text = TITLED_NAME.sub("[jméno skryto]", text)

    def surname(m):
        word = normalize(m[0])
        known = (len(word) >= 4 and word in names.surnames and word not in GENERIC_WORDS
                 and word not in names.places)
        return "[jméno skryto]" if known else m[0]

    text = NAME_PAIR.sub(pair, text)
    text = DATE_SIGNATURE.sub(lambda m: f"{m[1]} [jméno skryto]", text)
    def role_name(m):
        # „vedoucí Městské knihovny“, „po dohodě s Obecním úřadem“ nejsou jména
        word = normalize(m[0][len(m[1]) + len(m[2]):].split()[0])
        institution = word.startswith(INSTITUTION_STEMS) or word in GENERIC_WORDS or word in names.places
        return m[0] if institution else f"{m[1]}{m[2]}[jméno skryto]"

    text = ROLE_NAME.sub(role_name, text)
    return MID_SENTENCE_WORD.sub(surname, text)


def _format_phone(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("00420"):
        digits = digits[5:]
    elif digits.startswith("420") and len(digits) == 12:
        digits = digits[3:]
    if len(digits) != 9 or digits[0] in "67":
        return None
    return f"{digits[:3]} {digits[3:6]} {digits[6:]}"


def public_phones(rec: Record) -> list[str]:
    out = []
    for occ in rec.get("TEL", []):
        for value in occ.get("a", []):
            numbers = PHONE.findall(value)
            note = PHONE.sub("", value)
            note = re.sub(r"[(),;]", " ", note).strip(" -")
            note = re.sub(r"\s+", " ", note)
            norm = normalize(note)
            if note and (PERSON_NOTE.search(norm) and "sekretariat" not in norm or not INSTITUTION_NOTE.search(norm)):
                continue
            suffix = f" ({note})" if note else ""
            for number in numbers:
                formatted = _format_phone(number)
                if formatted:
                    out.append(formatted + suffix)
    return out
