import json
import os
import shutil
import tempfile
import unittest

from build.export import build_libraries, summary, write_csv, write_json
from build.marc import read_records

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "adr-sample.xml")

KEYS = {"id", "name", "category", "typeLabel", "professional", "region", "district", "address", "municipality",
        "lat", "lon", "approx", "hours", "web", "catalog", "emails", "phones", "director", "services",
        "serviceKeys", "parent", "branches", "supervisor", "fund"}


class FakeGeocoder:
    def __init__(self, point):
        self.point = point
        self.queries = []

    def locate(self, address):
        self.queries.append(address)
        return self.point


def libraries(geocoder=None):
    libs = build_libraries(list(read_records(FIXTURE)), geocoder=geocoder)
    return libs, {lib["id"]: lib for lib in libs}


class BuildLibrariesTest(unittest.TestCase):
    def test_only_public_and_branches(self):
        _, by = libraries()
        self.assertEqual(set(by), {"TST001", "TST010", "TST002", "TST001-2"})

    def test_site_record_contract(self):
        _, by = libraries()
        a = by["TST001"]
        self.assertEqual(set(a), KEYS)
        self.assertEqual(a["name"], "Městská knihovna Testov")
        self.assertEqual(a["category"], "obecni")
        self.assertEqual(a["typeLabel"], "Městská knihovna")
        self.assertTrue(a["professional"])
        self.assertEqual((a["region"], a["district"]), ("Středočeský kraj", "Kolín"))
        self.assertEqual(a["address"], "Náměstí 1, 123 45 Testov")
        self.assertEqual(a["municipality"], "Testov")
        self.assertEqual((a["lat"], a["lon"], a["approx"]), (50.025, 15.2, False))
        self.assertTrue(a["hours"]["parsed"])
        self.assertEqual(a["web"], "https://www.knihovna-testov.cz/")
        self.assertEqual(a["catalog"], "https://testov.tritius.cz/")
        self.assertEqual(a["emails"], ["info@knihovna-testov.cz"])
        self.assertEqual(a["phones"], ["321 000 000"])
        self.assertEqual(a["director"], {"name": "Ing. Jan Novák", "role": "ředitel"})
        self.assertEqual(a["serviceKeys"], ["wifi", "bibliobox"])
        self.assertIn("Meziknihovní výpůjční služby", a["services"])
        self.assertIsNone(a["parent"])
        self.assertEqual(a["branches"], ["TST002", "TST001-2"])
        self.assertEqual(a["fund"], {"books": 85400, "periodicals": 120, "year": 2025})

    def test_branch_with_own_record(self):
        _, by = libraries()
        b = by["TST002"]
        self.assertEqual(b["name"], "Městská knihovna Testov – Pobočka Sever")
        self.assertEqual(b["parent"], "TST001")
        self.assertFalse(b["hours"]["parsed"])  # „po dohodě“
        self.assertEqual(b["category"], "obecni")

    def test_branch_without_own_record(self):
        _, by = libraries()
        b = by["TST001-2"]
        self.assertEqual(b["name"], "Městská knihovna Testov – Pobočka Jih")
        self.assertEqual(b["parent"], "TST001")
        self.assertIsNone(b["hours"])
        self.assertEqual(b["address"], "Jižní 7, Testov")
        self.assertAlmostEqual(b["lat"], 50.016667, places=5)
        self.assertEqual(b["web"], "https://www.knihovna-testov.cz/")
        self.assertEqual((b["emails"], b["phones"], b["director"]), ([], [], None))

    def test_missing_gps_uses_geocoder(self):
        geo = FakeGeocoder((50.0, 15.1))
        _, by = libraries(geo)
        b = by["TST010"]
        self.assertEqual((b["lat"], b["lon"], b["approx"]), (50.0, 15.1, True))
        self.assertEqual(geo.queries, ["Lhota 12, 123 46 Lhota"])
        self.assertEqual(b["supervisor"], {"id": "TST001", "name": "Městská knihovna Testov"})
        self.assertFalse(b["professional"])

    def test_branch_record_without_gps_prefers_branch_gps_over_geocoding(self):
        recs = list(read_records(FIXTURE))
        for r in recs:
            if r["SGL"][0]["a"] == ["TST002"]:
                del r["ADR"][0]["g"]
        geo = FakeGeocoder((49.0, 14.0))
        by = {lib["id"]: lib for lib in build_libraries(recs, geocoder=geo)}
        b = by["TST002"]
        self.assertEqual((b["lat"], b["lon"], b["approx"]), (50.033333, 15.2, False))
        self.assertNotIn("Severní 5, 123 45 Testov", geo.queries)

    def test_hours_note_is_sanitized(self):
        recs = list(read_records(FIXTURE))
        for r in recs:
            if r["SGL"][0]["a"] == ["TST001"]:
                r["OTD"][0]["p"] = ["Mimo otevírací dobu volejte 777 123 456."]
        by = {lib["id"]: lib for lib in build_libraries(recs)}
        self.assertEqual(by["TST001"]["hours"]["note"], "Mimo otevírací dobu volejte [telefon skryt].")

    def test_opening_hours_from_all_otd_occurrences(self):
        recs = list(read_records(FIXTURE))
        for r in recs:
            if r["SGL"][0]["a"] == ["TST001"]:
                r["OTD"] = [{"1": ["9:00-12:00"]}, {"4": ["9:00-18:00"]}]
        by = {lib["id"]: lib for lib in build_libraries(recs)}
        self.assertEqual(by["TST001"]["hours"]["days"][3], [["09:00", "18:00"]])

    def test_facebook_used_when_no_other_web(self):
        recs = list(read_records(FIXTURE))
        for r in recs:
            if r["SGL"][0]["a"] == ["TST001"]:
                r["URL"] = [{"u": ["https://www.facebook.com/knihovnatestov"], "z": ["facebook"]}]
            if r["SGL"][0]["a"] == ["TST010"]:
                r["URL"] = [{"u": ["https://www.facebook.com/lhota"]}, {"u": ["https://www.lhota-testov.cz/"]}]
        by = {lib["id"]: lib for lib in build_libraries(recs)}
        self.assertEqual(by["TST001"]["web"], "https://www.facebook.com/knihovnatestov")
        self.assertEqual(by["TST010"]["web"], "https://www.lhota-testov.cz/")

    def test_only_http_links(self):
        recs = list(read_records(FIXTURE))
        for r in recs:
            if r["SGL"][0]["a"] == ["TST001"]:
                r["URL"] = [{"u": ["javascript:alert(1)"]}, {"u": ["ftp://testov.cz/katalog"], "z": ["online katalog"]}]
        by = {lib["id"]: lib for lib in build_libraries(recs)}
        self.assertIsNone(by["TST001"]["web"])
        self.assertIsNone(by["TST001"]["catalog"])

    def test_missing_gps_without_geocoder(self):
        _, by = libraries()
        self.assertEqual((by["TST010"]["lat"], by["TST010"]["lon"]), (None, None))


class OutputTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_no_personal_data_in_outputs(self):
        libs, _ = libraries()
        jpath = os.path.join(self.tmp, "k.json")
        cpath = os.path.join(self.tmp, "k.csv")
        write_json(libs, jpath, generated="2026-10-23")
        write_csv(libs, cpath)
        for path in (jpath, cpath):
            with open(path, encoding="utf-8-sig") as f:
                text = f.read()
            for secret in ["jan.novak", "777 000 000", "603 000 000", "608 111 222", "Starosta", "Vomáčka",
                           "Fiktivní", "Eva Zkoušková", "knihovna.lhota@seznam.cz"]:
                self.assertNotIn(secret, text, f"{secret} v {os.path.basename(path)}")

    def test_json_shape(self):
        libs, _ = libraries()
        path = os.path.join(self.tmp, "k.json")
        write_json(libs, path, generated="2026-10-23")
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        self.assertEqual(data["generated"], "2026-10-23")
        self.assertEqual(len(data["libraries"]), 4)

    def test_csv_has_bom_and_header(self):
        libs, _ = libraries()
        path = os.path.join(self.tmp, "k.csv")
        write_csv(libs, path)
        with open(path, "rb") as f:
            raw = f.read()
        self.assertTrue(raw.startswith(b"\xef\xbb\xbf"))
        header = raw[3:].decode("utf-8").splitlines()[0]
        self.assertTrue(header.startswith("id;název;kategorie;typ;kraj;okres;adresa;obec"))

    def test_cli_writes_outputs(self):
        from build.run import main
        jpath = os.path.join(self.tmp, "docs", "data", "knihovny.json")
        cpath = os.path.join(self.tmp, "knihovny.csv")
        spath = os.path.join(self.tmp, "summary.txt")
        main(["--adr", FIXTURE, "--json", jpath, "--csv", cpath, "--summary", spath, "--no-geocode",
              "--generated", "2026-10-23"])
        for path in (jpath, cpath, spath):
            self.assertTrue(os.path.exists(path), path)
        with open(spath, encoding="utf-8") as f:
            self.assertIn("Skryté jako možné osobní údaje: e-maily 2 z 3, telefonní čísla 2 z 3", f.read())

    def test_summary_counts(self):
        libs, _ = libraries()
        text = summary(libs)
        self.assertIn("Knihoven celkem: 4", text)
        self.assertIn("z toho pobočky: 2", text)


if __name__ == "__main__":
    unittest.main()
