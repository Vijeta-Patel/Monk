import unittest

from textkit import paginate, parse_duration, slugify


class SlugifyTest(unittest.TestCase):
    def test_single_word(self):
        self.assertEqual(slugify("Hello"), "hello")

    def test_two_words(self):
        self.assertEqual(slugify("Hello World"), "hello-world")


class ParseDurationTest(unittest.TestCase):
    def test_seconds(self):
        self.assertEqual(parse_duration("90s"), 90)

    def test_hours(self):
        self.assertEqual(parse_duration("2h"), 7200)

    def test_rejects_garbage(self):
        with self.assertRaises(ValueError):
            parse_duration("soon")


class PaginateTest(unittest.TestCase):
    def test_rejects_page_zero(self):
        with self.assertRaises(ValueError):
            paginate([1, 2, 3], 0)


if __name__ == "__main__":
    unittest.main()
