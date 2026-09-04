import math
import unittest

from whisperx_worker import canonical_words


class WordTimingTest(unittest.TestCase):
    def test_maps_whisperx_words_without_reordering_them(self):
        self.assertEqual(
            canonical_words(
                [
                    {"word": "one", "start": 1.0, "end": 1.4, "score": 0.8},
                    {"word": "two", "start": 1.5, "end": 1.5},
                ]
            ),
            [
                {"text": "one", "startTime": 1.0, "endTime": 1.4, "confidence": 0.8},
                {"text": "two", "startTime": 1.5, "endTime": 1.5},
            ],
        )

    def test_rejects_incomplete_or_invalid_words(self):
        invalid = [
            {"start": 1.0, "end": 1.4},
            {"word": "one", "end": 1.4},
            {"word": "one", "start": 1.0},
            {"word": "", "start": 1.0, "end": 1.4},
            {"word": "one", "start": 1.0, "end": 0.9},
            {"word": "one", "start": math.inf, "end": math.inf},
            {"word": "one", "start": 1.0, "end": 1.4, "score": math.inf},
        ]
        for word in invalid:
            with self.subTest(word=word), self.assertRaises(ValueError):
                canonical_words([word])


if __name__ == "__main__":
    unittest.main()
