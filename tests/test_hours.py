import unittest

from build.hours import merge_otd, parse_day, parse_hours


class ParseDayTest(unittest.TestCase):
    def test_regular_formats(self):
        cases = {
            "16:00-18:00": [("16:00", "18:00")],
            "9:00-12:00; 13:00-17:00": [("09:00", "12:00"), ("13:00", "17:00")],
            "9-12, 13-18": [("09:00", "12:00"), ("13:00", "18:00")],
            "9.00-12.00": [("09:00", "12:00")],
            "9:30 – 17:00": [("09:30", "17:00")],
            "8:00–11:30; 12:00–16:00": [("08:00", "11:30"), ("12:00", "16:00")],
            "7:30 - 11:30; 12:00 - 16:00": [("07:30", "11:30"), ("12:00", "16:00")],
            "8:00-11:30; 13.00-16:00": [("08:00", "11:30"), ("13:00", "16:00")],
            "8:00-11:00,12:00-17:00": [("08:00", "11:00"), ("12:00", "17:00")],
            "9-12 a 13-18": [("09:00", "12:00"), ("13:00", "18:00")],
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(parse_day(text), expected)

    def test_closed(self):
        for text in ["zavřeno", "Zavřeno", "-", ""]:
            with self.subTest(text=text):
                self.assertEqual(parse_day(text), [])

    def test_not_parseable(self):
        for text in ["po dohodě", "sudý týden 16-18", "15:00-17:00 (sudý týden)",
                     "8:00-12:00; 13:00-17:00 (dospělí)", "18-9", "8:00-11:000",
                     "1. sobota v měsíci 9:00-12:00", "25:00-26:00", "pouze po telefonické domluvě"]:
            with self.subTest(text=text):
                self.assertIsNone(parse_day(text))


class ParseHoursTest(unittest.TestCase):
    def test_week(self):
        h = parse_hours({"1": ["9:00-12:00; 13:00-18:00"], "3": ["16:00-18:00"], "p": ["V létě zavřeno."]})
        self.assertTrue(h["parsed"])
        self.assertEqual(h["days"][0], [["09:00", "12:00"], ["13:00", "18:00"]])
        self.assertEqual(h["days"][1], [])
        self.assertEqual(h["days"][2], [["16:00", "18:00"]])
        self.assertEqual(len(h["days"]), 7)
        self.assertEqual(h["raw"], {"1": "9:00-12:00; 13:00-18:00", "3": "16:00-18:00"})
        self.assertEqual(h["note"], "V létě zavřeno.")

    def test_unparseable_day_makes_whole_week_unknown(self):
        h = parse_hours({"3": ["13:00-17:00"], "5": ["po dohodě"]})
        self.assertFalse(h["parsed"])
        self.assertIsNone(h["days"])
        self.assertEqual(h["raw"], {"3": "13:00-17:00", "5": "po dohodě"})
        self.assertIsNone(h["note"])

    def test_note_only(self):
        h = parse_hours({"p": ["Otevírací doba na webu obce."]})
        self.assertFalse(h["parsed"])
        self.assertIsNone(h["days"])
        self.assertEqual(h["note"], "Otevírací doba na webu obce.")

    def test_missing(self):
        self.assertIsNone(parse_hours(None))
        self.assertIsNone(parse_hours({}))


class MergeOtdTest(unittest.TestCase):
    def test_week_split_over_occurrences(self):
        merged = merge_otd([{"1": ["9:00-12:00"]}, {"2": ["13:00-18:00"]}, {"p": ["Poznámka."]}])
        self.assertEqual(merged, {"1": ["9:00-12:00"], "2": ["13:00-18:00"], "p": ["Poznámka."]})
        h = parse_hours(merged)
        self.assertTrue(h["parsed"])
        self.assertEqual(h["days"][1], [["13:00", "18:00"]])

    def test_conflicting_day_is_unknown(self):
        h = parse_hours(merge_otd([{"1": ["9:00-12:00"]}, {"1": ["13:00-17:00"]}]))
        self.assertFalse(h["parsed"])

    def test_empty(self):
        self.assertIsNone(merge_otd([]))


class QualifiedNoteTest(unittest.TestCase):
    def qualified(self, note):
        return parse_hours({"2": ["9:00-12:00"], "p": [note]})["qualified"]

    def test_summer(self):
        for note in ["V létě zavřeno.", "V červenci a srpnu zkrácený provoz.",
                     "Prázdninovou provozní dobu naleznete na webu."]:
            with self.subTest(note=note):
                self.assertEqual(self.qualified(note), "summer")

    def test_always(self):
        for note in ["Otevřeno jen 1. a 3. sobotu v měsíci.", "Knihovna je dočasně uzavřena z důvodu rekonstrukce.",
                     "Sudé týdny úterý, liché čtvrtek.", "Mimo provoz.", "Otevřeno každou 1. sobotu.",
                     "V sobotu 2. a 4. týden."]:
            with self.subTest(note=note):
                self.assertEqual(self.qualified(note), "always")

    def test_not_qualified(self):
        for note in ["V době státních svátků zavřeno.", "Výpůjčky i přes bibliobox.", "Pro děti do 15 let.",
                     "Oddělení pro dospělé ve 3. patře."]:
            with self.subTest(note=note):
                self.assertIsNone(self.qualified(note))

    def test_schedule_still_parsed(self):
        h = parse_hours({"2": ["9:00-12:00"], "p": ["V létě zavřeno."]})
        self.assertTrue(h["parsed"])
        self.assertEqual(h["days"][1], [["09:00", "12:00"]])


if __name__ == "__main__":
    unittest.main()
