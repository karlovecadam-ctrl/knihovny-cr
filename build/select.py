"""Výběr veřejně přístupných knihoven, jejich kategorie a pobočky."""

from build.marc import Record, first

CATEGORY_BY_TYP = {
    "OK": "obecni",
    "MK": "obecni",
    "KK": "krajske",
    "NK": "krajske",
    "VŠ": "vysokoskolske",
}


def is_public(rec: Record) -> bool:
    """Zapsaná v evidenci MK (EMK) a není zrušená ani nezvěstná (STT)."""
    return first(rec, "EMK", "a") is not None and not rec.get("STT")


# Krajské knihovny podle sigly; Karlovy Vary (KVG001) a Pardubice (PAG001) mají v ADR typ MK.
REGIONAL_SIGLAS = {"ABG001", "BOA001", "CBA001", "HBG001", "HKA001", "KLG001", "KVG001",
                   "LIA001", "OLA001", "OSA001", "PAG001", "PNA001", "ULG001", "ZLG001"}


def category(rec: Record) -> str:
    if first(rec, "SGL", "a") in REGIONAL_SIGLAS:
        return "krajske"
    return CATEGORY_BY_TYP.get(first(rec, "TYP", "a"), "odborne")


def expand_branches(public: list[Record], by_sigla: dict[str, Record]) -> list[tuple[Record | None, dict, str]]:
    """Pobočky (POB) veřejných knihoven jako (vlastní záznam nebo None, podpole POB, sigla mateřské knihovny).

    POB, které obsahuje jen odkaz na seznam poboček (bez názvu i adresy), se přeskočí.
    """
    out = []
    for rec in public:
        parent = first(rec, "SGL", "a")
        for pob in rec.get("POB", []):
            if not pob.get("n") and not pob.get("a"):
                continue
            sigla = (pob.get("s") or [None])[0]
            out.append((by_sigla.get(sigla) if sigla else None, pob, parent))
    return out
