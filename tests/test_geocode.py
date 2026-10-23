import os
import shutil
import tempfile
import unittest

from build.geocode import Geocoder, parse_dms


class ParseDmsTest(unittest.TestCase):
    def test_adr_format(self):
        lat, lon = parse_dms("50°5'11.12\"N, 14°24'56.61\"E")
        self.assertAlmostEqual(lat, 50.086422, places=5)
        self.assertAlmostEqual(lon, 14.415725, places=5)

    def test_without_decimals(self):
        self.assertEqual(parse_dms("50°1'30\"N, 15°12'0\"E"), (50.025, 15.2))

    def test_invalid(self):
        self.assertIsNone(parse_dms(""))
        self.assertIsNone(parse_dms("viz mapa"))
        self.assertIsNone(parse_dms("10°0'0\"N, 15°0'0\"E"))  # mimo ČR


class FakeClock:
    def __init__(self):
        self.now = 100.0
        self.slept = []

    def clock(self):
        return self.now

    def sleep(self, seconds):
        self.slept.append(seconds)
        self.now += seconds


class GeocoderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.cache = os.path.join(self.tmp, "geocode.json")
        self.calls = []
        self.clock = FakeClock()

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def geocoder(self, result):
        def fetch(q):
            self.calls.append(q)
            if isinstance(result, Exception):
                raise result
            return result
        return Geocoder(self.cache, fetch=fetch, sleep=self.clock.sleep, clock=self.clock.clock)

    def test_result_is_cached(self):
        g = self.geocoder([{"lat": "50.1", "lon": "15.2"}])
        self.assertEqual(g.locate("Lhota 12, 123 46 Lhota"), (50.1, 15.2))
        self.assertEqual(g.locate("Lhota 12, 123 46 Lhota"), (50.1, 15.2))
        self.assertEqual(len(self.calls), 1)
        again = self.geocoder([{"lat": "0", "lon": "0"}])
        self.assertEqual(again.locate("Lhota 12, 123 46 Lhota"), (50.1, 15.2))
        self.assertEqual(len(self.calls), 1)

    def test_empty_result_cached_as_none(self):
        g = self.geocoder([])
        self.assertIsNone(g.locate("Neexistující 1"))
        self.assertIsNone(g.locate("Neexistující 1"))
        self.assertEqual(len(self.calls), 1)

    def test_network_error_not_cached(self):
        g = self.geocoder(OSError("offline"))
        self.assertIsNone(g.locate("Lhota 12"))
        self.assertIsNone(g.locate("Lhota 12"))
        self.assertEqual(len(self.calls), 2)

    def test_one_request_per_second(self):
        g = self.geocoder([{"lat": "50", "lon": "15"}])
        g.locate("A 1")
        self.clock.now += 0.25
        g.locate("B 2")
        self.assertEqual(len(self.calls), 2)
        self.assertAlmostEqual(sum(self.clock.slept), 0.75)


if __name__ == "__main__":
    unittest.main()
