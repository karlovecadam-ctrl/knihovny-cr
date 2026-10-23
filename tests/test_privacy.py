import json
import os
import unittest

from build.marc import first, read_records
from build.privacy import NameIndex, director, public_emails, public_phones, sanitize_text

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "adr-sample.xml")


def fixture():
    recs = list(read_records(FIXTURE))
    return recs, {first(r, "SGL", "a"): r for r in recs}


def with_contacts(rec, emails=(), phones=()):
    rec = dict(rec)
    rec["EML"] = [{"u": [e]} for e in emails]
    rec["TEL"] = [{"a": list(phones)}] if phones else []
    return rec


class DirectorTest(unittest.TestCase):
    def test_legal_entity_shows_director(self):
        _, by = fixture()
        self.assertEqual(director(by["TST001"]), {"name": "Ing. Jan Novák", "role": "ředitel"})

    def test_volunteer_library_hides_name(self):
        _, by = fixture()
        self.assertIsNone(director(by["TST010"]))

    def test_regional_library_without_legal_entity_flag(self):
        rec = {"SGL": [{"a": ["ZLG001"]}], "TYP": [{"a": ["KK"]}],
               "FCE": [{"a": ["pověřená regionální funkcí"]}],
               "JMN": [{"k": ["Eva"], "p": ["Testová"], "r": ["zástupkyně ředitele"]},
                       {"t": ["PhDr."], "k": ["Jana"], "p": ["Pokusná"], "r": ["ředitelka"]}]}
        self.assertEqual(director(rec), {"name": "PhDr. Jana Pokusná", "role": "ředitelka"})


    def test_person_without_head_role_hidden(self):
        _, by = fixture()
        rec = dict(by["TST001"])
        rec["JMN"] = [{"k": ["Eva"], "p": ["Zkoušková"], "r": ["knihovnice"]}, {"k": ["Petr"], "p": ["Bezfunkce"]}]
        self.assertIsNone(director(rec))


class EmailTest(unittest.TestCase):
    def test_personal_address_hidden(self):
        _, by = fixture()
        self.assertEqual(public_emails(by["TST001"]), ["info@knihovna-testov.cz"])

    def test_free_mail_hidden_without_legal_entity(self):
        _, by = fixture()
        self.assertEqual(public_emails(by["TST010"]), [])

    def test_initial_and_surname_hidden(self):
        _, by = fixture()
        rec = with_contacts(by["TST001"], emails=["jnovak@knihovna-testov.cz"])
        self.assertEqual(public_emails(rec), [])

    def test_names_from_other_records_hidden(self):
        recs, by = fixture()
        names = NameIndex.from_records(recs)
        rec = with_contacts(by["TST001"], emails=["marie.fiktivni@knihovna-testov.cz", "pujcovna@knihovna-testov.cz"])
        self.assertEqual(public_emails(rec, names), ["pujcovna@knihovna-testov.cz"])

    def test_name_like_address_without_generic_word_hidden(self):
        _, by = fixture()
        rec = with_contacts(by["TST001"], emails=[
            "zdenka.zkouskova@knihovna-testov.cz", "zkouskova@knihovna-testov.cz",
            "knihovna.testov@knihovna-testov.cz", "obec.lhota@lhota-testov.cz", "mvs-testov@knihovna-testov.cz"])
        self.assertEqual(public_emails(rec), [
            "knihovna.testov@knihovna-testov.cz", "obec.lhota@lhota-testov.cz", "mvs-testov@knihovna-testov.cz"])

    def test_concatenated_names_hidden(self):
        _, by = fixture()
        names = NameIndex(first_names={"katerina"}, surnames=set())
        rec = with_contacts(by["TST001"], emails=[
            "pokusovakaterina@seznam.cz", "katerinazkouska@knihovna-testov.cz", "testovknihovna@seznam.cz"])
        self.assertEqual(public_emails(rec, names), ["testovknihovna@seznam.cz"])

    def test_single_word_must_be_generic_or_place(self):
        _, by = fixture()
        rec = with_contacts(by["TST001"], emails=[
            "fiktivmann@knihovna-testov.cz", "zkouskovam@knihovna-testov.cz", "pokusnickai@knihovna-testov.cz",
            "testov@seznam.cz", "citarna@knihovna-testov.cz", "ktv@ktv.cz"])
        self.assertEqual(public_emails(rec), ["testov@seznam.cz", "citarna@knihovna-testov.cz", "ktv@ktv.cz"])

    def test_office_prefix_with_place_kept(self):
        _, by = fixture()
        rec = with_contacts(by["TST010"], emails=["oulhota@lhota-testov.cz"])
        self.assertEqual(public_emails(rec), ["oulhota@lhota-testov.cz"])

    def test_address_with_extra_text(self):
        _, by = fixture()
        small = with_contacts(by["TST010"], emails=["obec.lhota@seznam.cz (OÚ)"])
        self.assertEqual(public_emails(small), [])
        big = with_contacts(by["TST001"], emails=["info@knihovna-testov.cz (sekretariát)."])
        self.assertEqual(public_emails(big), ["info@knihovna-testov.cz"])

    def test_generic_address_kept_for_small_library(self):
        _, by = fixture()
        rec = with_contacts(by["TST010"], emails=["knihovna@lhota-testov.cz"])
        self.assertEqual(public_emails(rec), ["knihovna@lhota-testov.cz"])


class PhoneTest(unittest.TestCase):
    def test_mobile_hidden(self):
        _, by = fixture()
        self.assertEqual(public_phones(by["TST001"]), ["321 000 000"])
        self.assertEqual(public_phones(by["TST010"]), [])

    def test_formats_and_notes(self):
        _, by = fixture()
        rec = with_contacts(by["TST001"], phones=[
            "+420 321 000 001",
            "321 000 002 (obecní úřad)",
            "321 000 003 (ředitelka)",
            "321 000 004 (p. Testová)",
            "321 000 005, 321 000 006",
        ])
        self.assertEqual(public_phones(rec), [
            "321 000 001", "321 000 002 (obecní úřad)", "321 000 005", "321 000 006"])


class SanitizeTextTest(unittest.TestCase):
    def test_redactions(self):
        names = NameIndex(first_names={"jana"}, surnames={"fiktivni"})
        cases = {
            "Po telefonické dohodě na 777 123 456": "Po telefonické dohodě na [telefon skryt]",
            "Dle dohody – zkouskova@muzeum-testov.cz 603 000 000": "Dle dohody – [e-mail skryt] [telefon skryt]",
            "domluvit s p.Pokusným (tel.: 321 000 000)": "domluvit s [jméno skryto] (tel.: 321 000 000)",
            "po dohodě s paní Fiktivní": "po dohodě s [jméno skryto]",
            "kontakt: Mgr. Jana Fiktivní": "kontakt: [jméno skryto]",
            "kontakt Jana Fiktivní, knihovnice": "kontakt [jméno skryto], knihovnice",
            "Malá Skála – v létě zavřeno": "Malá Skála – v létě zavřeno",
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(sanitize_text(text, names), expected)

    def test_lone_surname_and_signature(self):
        names = NameIndex(first_names=set(), surnames={"zkouskova", "knihovna"})
        cases = {
            "Aktualizace 12. 3. 2025 Zkoušková": "Aktualizace 12. 3. 2025 [jméno skryto]",
            "Upraveno 1. 9. 2025 Pokusný": "Upraveno 1. 9. 2025 [jméno skryto]",
            "Informace podá Zkoušková.": "Informace podá [jméno skryto].",
            "Knihovna je v létě zavřena.": "Knihovna je v létě zavřena.",
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(sanitize_text(text, names), expected)

    def test_role_followed_by_name(self):
        cases = {
            "pobočka Testovice, knihovnice Pokusná": "pobočka Testovice, knihovnice [jméno skryto]",
            "odpovědná osoba Pokusný; otevřeno v pondělí": "odpovědná osoba [jméno skryto]; otevřeno v pondělí",
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(sanitize_text(text), expected)

    def test_words_that_only_look_like_surnames_are_kept(self):
        names = NameIndex(first_names=set(), surnames={"kazda", "testovice"}, places={"testovice"})
        cases = ["Každá sudá sobota v měsíci.", "Obecní knihovna – pobočka Testovice otevřena ve čtvrtek.",
                 "Informace podá vedoucí Městské knihovny Testov.", "Po dohodě s Obecním úřadem."]
        for text in cases:
            with self.subTest(text=text):
                self.assertEqual(sanitize_text(text, names), text)

    def test_none(self):
        self.assertIsNone(sanitize_text(None))


class OperatorNeverExposedTest(unittest.TestCase):
    def test_pvz_contact_person_not_in_output(self):
        recs, by = fixture()
        names = NameIndex.from_records(recs)
        for rec in recs:
            out = json.dumps([director(rec), public_emails(rec, names), public_phones(rec)], ensure_ascii=False)
            self.assertNotIn("Starosta", out)
            self.assertNotIn("Vomáčka", out)
            self.assertNotIn("608 111 222", out)


if __name__ == "__main__":
    unittest.main()
