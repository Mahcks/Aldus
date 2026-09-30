import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import wave

from listening_practice import prepare


class ListeningPracticeTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg is needed to cut the practice clip')
    def test_prepared_clip_has_context_and_uses_the_existing_human_onset(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            session = prepare(directory)
            self.assertEqual(session, json.loads((directory / 'session.json').read_text()))
            self.assertEqual(session['start_ms'], 3000)
            self.assertEqual(session['source_start_ms'] + session['start_ms'], 33195)
            self.assertEqual(session['clip_sha256'], hashlib.sha256((directory / 'clip.wav').read_bytes()).hexdigest())
            with wave.open(str(directory / 'clip.wav')) as clip:
                self.assertEqual(clip.getnchannels(), 1)
                self.assertEqual(clip.getnframes() / clip.getframerate(), 10)


if __name__ == '__main__':
    unittest.main()
