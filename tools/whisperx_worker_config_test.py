import os
import unittest
from unittest.mock import patch

from whisperx_worker_config import load


class ConfigTest(unittest.TestCase):
    def test_defaults_and_cuda_image(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(load(), ("cpu", "int8", 4))
        with patch.dict(os.environ, {"ALDUS_ALIGNMENT_ACCELERATOR": "cuda"}, clear=True):
            self.assertEqual(load(), ("cuda", "float16", 4))

    def test_rejects_unknown_accelerator(self):
        with patch.dict(os.environ, {"ALDUS_ALIGNMENT_ACCELERATOR": "magic"}, clear=True):
            with self.assertRaisesRegex(ValueError, "cpu or cuda"):
                load()

    def test_rejects_invalid_batch_size(self):
        for value in ("nope", "0", "-1"):
            with self.subTest(value=value), patch.dict(os.environ, {"ALDUS_ALIGNMENT_BATCH_SIZE": value}, clear=True):
                with self.assertRaisesRegex(ValueError, "positive integer"):
                    load()


if __name__ == "__main__":
    unittest.main()
