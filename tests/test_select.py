import os
import unittest

from build.marc import first, read_records
from build.select import category, expand_branches, is_public

HERE = os.path.dirname(__file__)
FIXTURE = os.path.join(HERE, "fixtures", "adr-sample.xml")
RAW = os.path.join(HERE, "..", "raw", "adr.xml.gz")

# 14 krajských knihoven (včetně Městské knihovny v Praze)
REGIONAL = {"ABG001", "BOA001", "CBA001", "HBG001", "HKA001", "KLG001", "KVG001",
            "LIA001", "OLA001", "OSA001", "PAG001", "PNA001", "ULG001", "ZLG001"}


def fixture():
    recs = list(read_records(FIXTURE))
    return recs, {first(r, "SGL", "a"): r for r in recs}


def typ(code):
    return {"TYP": [{"a": [code]}]}


class PublicTest(unittest.TestCase):
    def test_public_rules(self):
        _, by = fixture()
        self.assertTrue(is_public(by["TST001"]))
        self.assertTrue(is_public(by["TST010"]))
        self.assertFalse(is_public(by["TST020"]))  # zrušená
        self.assertFalse(is_public(by["TST030"]))  # mimo evidenci MK
        self.assertFalse(is_public(by["TST002"]))  # pobočka bez EMK


class CategoryTest(unittest.TestCase):
    def test_known_codes(self):
        self.assertEqual(category(typ("OK")), "obecni")
        self.assertEqual(category(typ("MK")), "obecni")
        self.assertEqual(category(typ("KK")), "krajske")
        self.assertEqual(category(typ("NK")), "krajske")
        self.assertEqual(category(typ("VŠ")), "vysokoskolske")
        self.assertEqual(category(typ("LK")), "odborne")

    def test_regional_library_typed_as_municipal(self):
        # Krajská knihovna Karlovy Vary má v ADR typ MK
        rec = {"SGL": [{"a": ["KVG001"]}], "TYP": [{"a": ["MK"]}]}
        self.assertEqual(category(rec), "krajske")

    def test_category_unknown_code(self):
        self.assertEqual(category(typ("XX")), "odborne")
        self.assertEqual(category({}), "odborne")


class BranchesTest(unittest.TestCase):
    def test_branches(self):
        recs, by = fixture()
        public = [r for r in recs if is_public(r)]
        branches = expand_branches(public, by)
        self.assertEqual(len(branches), 2)
        own, pob, parent = branches[0]
        self.assertIs(own, by["TST002"])
        self.assertEqual(pob["n"], ["Pobočka Sever"])
        self.assertEqual(parent, "TST001")
        own, pob, parent = branches[1]
        self.assertIsNone(own)
        self.assertEqual(pob["n"], ["Pobočka Jih"])

    def test_branch_link_only_is_skipped(self):
        rec = {"SGL": [{"a": ["TST900"]}], "EMK": [{"a": ["1"]}],
               "POB": [{"u": ["https://knihovna.example/pobocky"]}]}
        self.assertEqual(expand_branches([rec], {}), [])


@unittest.skipUnless(os.path.exists(RAW), "raw/adr.xml.gz chybí")
class RealDataTest(unittest.TestCase):
    def test_national_and_regional_present(self):
        public = [r for r in read_records(RAW) if is_public(r)]
        siglas = {first(r, "SGL", "a") for r in public}
        self.assertIn("ABA000", siglas)  # Národní knihovna ČR
        self.assertTrue(REGIONAL <= siglas, REGIONAL - siglas)
        for r in public:
            if first(r, "SGL", "a") in REGIONAL:
                self.assertEqual(category(r), "krajske")


if __name__ == "__main__":
    unittest.main()
