# Knihovny ČR

Mapa veřejně přístupných knihoven v České republice s otevírací dobou, stavem „otevřeno teď“, filtry a hledáním.
Statický web v `docs/` (GitHub Pages): <https://karlovecadam-ctrl.github.io/knihovny-cr/>

## Data

- **Centrální adresář knihoven a informačních institucí v ČR (ADR)**, Národní knihovna ČR,
  <https://aleph.nkp.cz/data/adr.xml.gz>, licence CC0. Struktura polí:
  [caslin.cz](https://www.caslin.cz/caslin/databaze-pro-vyhledavani/adresar/struktura-baze-adr/struktura-baze-adr-s-podrobnostmi).
- **Podkladová mapa:** © přispěvatelé [OpenStreetMap](https://www.openstreetmap.org/copyright).
- **Hledání adres a dohledání chybějící polohy:** [Nominatim](https://nominatim.org/) (OpenStreetMap).

Do mapy patří knihovny zapsané v evidenci Ministerstva kultury (pole EMK), které nejsou zrušené (pole STT), a jejich pobočky.

### Osobní údaje

Adresář obsahuje osobní údaje. Pravidla se uplatní už při zpracování, takže do `docs/data/knihovny.json` ani do CSV se nedostanou:

- jméno vedoucího jen u knihoven s právní subjektivitou a u krajských a národních knihoven, a jen pokud má funkci ředitel/vedoucí;
- e-mail jen obecné adresy instituce (žádné jmeno.prijmeni@, u menších knihoven žádné adresy na seznam.cz, gmail.com apod.);
- telefon jen pevné linky bez poznámky, která označuje konkrétní osobu;
- provozovatel a jeho odpovědná osoba se nečtou vůbec.

Surová data (`raw/`) a mezivýsledky (`cache/`) nejsou v gitu.

## Obnovení snímku dat

```bash
curl -L -o raw/adr.xml.gz https://aleph.nkp.cz/data/adr.xml.gz
python -m build.run
```

Skript zapíše `docs/data/knihovny.json`, CSV `../knihovny.csv` a souhrn vyplněnosti do `cache/summary.txt`.
Chybějící polohu dohledá přes Nominatim (nejvýš 1 dotaz za sekundu, výsledky ukládá do `cache/geocode.json`).
Volba `--no-geocode` dohledávání vypne.

## Testy

```bash
python -m unittest discover -s tests -t .
node --test "js-tests/*.test.mjs"
```
