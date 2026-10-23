import gzip
import os
import shutil
import tempfile
import unittest

from build.marc import first, read_records

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "adr-sample.xml")


def by_sigla(records):
    return {first(r, "SGL", "a"): r for r in records}


class ReadRecordsTest(unittest.TestCase):
    def test_reads_all_records(self):
        self.assertEqual(len(list(read_records(FIXTURE))), 5)

    def test_first(self):
        rec = by_sigla(read_records(FIXTURE))["TST001"]
        self.assertEqual(first(rec, "NAZ", "a"), "Městská knihovna Testov")
        self.assertIsNone(first(rec, "STT", "a"))

    def test_repeated_fields(self):
        rec = by_sigla(read_records(FIXTURE))["TST001"]
        self.assertEqual(len(rec["POB"]), 2)

    def test_repeated_subfields(self):
        rec = by_sigla(read_records(FIXTURE))["TST001"]
        self.assertEqual(rec["FCE"][0]["a"], ["profesionální", "právní subjektivita", "pověřená regionální funkcí"])

    def test_gzip(self):
        tmp = tempfile.mkdtemp()
        try:
            gz = os.path.join(tmp, "adr.xml.gz")
            with open(FIXTURE, "rb") as src, gzip.open(gz, "wb") as dst:
                shutil.copyfileobj(src, dst)
            self.assertEqual(list(read_records(gz)), list(read_records(FIXTURE)))
        finally:
            shutil.rmtree(tmp)


if __name__ == "__main__":
    unittest.main()
