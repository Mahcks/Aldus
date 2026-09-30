import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from listening_batch import digest, passage_text, prepare_batch, read_answers, save_answer


class ListeningBatchTest(unittest.TestCase):
    def test_answers_are_bound_atomic_and_unsure_has_no_onset(self):
        manifest = {'id': 'batch', 'sessions': [{'id': 'passage', 'clip_sha256': 'hash', 'source_start_ms': 12000, 'proposed_timestamp_ms': 17000}]}
        answer = {'batch_id': 'batch', 'session_id': 'passage', 'clip_sha256': 'hash', 'boundary_ms': 5100, 'result': 'right'}
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'responses.json'
            result = save_answer(manifest, path, answer)
            self.assertEqual(result['passage']['reviewed_timestamp_ms'], 17100)
            self.assertEqual(result['passage']['correction_ms'], 100)
            self.assertFalse(path.with_suffix('.tmp').exists())
            before = path.read_bytes()
            for field, value in [('batch_id', 'other'), ('clip_sha256', 'other'), ('session_id', 'other'), ('boundary_ms', True), ('boundary_ms', 999), ('boundary_ms', 11001), ('result', 'guessed')]:
                with self.assertRaises(ValueError):
                    save_answer(manifest, path, {**answer, field: value})
                self.assertEqual(before, path.read_bytes())
            save_answer(manifest, path, {**answer, 'result': 'unsure'})
            saved = read_answers(path)['passage']
            self.assertIsNone(saved['reviewed_timestamp_ms'])
            self.assertIsNone(saved['correction_ms'])
            self.assertEqual(saved['annotation_mode'], 'model-assisted-review')

    def test_recheck_keeps_original_candidate_and_creates_separate_evidence(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            text = "Here cried Alice quite forgetting how large she had grown in the last few minutes. " * 2
            href = "OEBPS/book-h-12.htm.xhtml"
            epub = root / "book.epub"
            with zipfile.ZipFile(epub, 'w') as book:
                book.writestr(href, f'<html><body><p>{text}</p></body></html>')
            audio = root / "book.m4b"
            audio.write_bytes(b'frozen source audio')
            candidate = root / "candidate.json"
            candidate.write_text(json.dumps({
                'epub_sha256': digest(epub), 'audio_sha256': digest(audio),
                'segments': [{'id': 's1', 'text': text, 'status': 'aligned', 'highlightable': True,
                              'epub': {'href': href, 'dom_path': 'html[1]/body[1]/p[1]'},
                              'audio': {'start_ms': 10000}}],
            }))
            original = candidate.read_bytes()
            def cut(command, **_kwargs):
                Path(command[-1]).write_bytes(('clip at ' + command[command.index('-ss') + 1]).encode())
            with patch('listening_batch.subprocess.run', side_effect=cut):
                old, old_responses = prepare_batch(root, candidate, epub, audio, root / 'evidence', (12,))
                old_responses.write_text('{"kept": true}')
                new, new_responses = prepare_batch(root, candidate, epub, audio, root / 'evidence', (12,), 20000)
                generic, generic_responses = prepare_batch(
                    root, candidate, epub, audio, root / 'evidence',
                    segment_ids=['s1'], title='Another book',
                )
                self.assertEqual(generic['book_title'], 'Another book')
                self.assertEqual(generic['sessions'][0]['id'], 's1')
                self.assertEqual(generic['sessions'][0]['candidate_timestamp_ms'], 10000)
                self.assertIsNone(generic['sessions'][0]['chapter'])
                self.assertNotEqual(generic_responses, old_responses)
                for ids in ([], ['missing'], ['s1', 's1']):
                    with self.assertRaises(ValueError):
                        prepare_batch(root, candidate, epub, audio, root / 'evidence', segment_ids=ids)

            self.assertNotEqual(old['id'], new['id'])
            self.assertEqual(old_responses.read_text(), '{"kept": true}')
            self.assertFalse(new_responses.exists())
            self.assertEqual(candidate.read_bytes(), original)
            self.assertEqual(new['sessions'][0]['candidate_timestamp_ms'], 10000)
            self.assertEqual(new['sessions'][0]['source_start_ms'], 15000)
            self.assertEqual(new['proposal_origin'], 'experimental-reestimate')
            with self.assertRaises(ValueError):
                prepare_batch(root, candidate, epub, audio, root / 'evidence', (1, 12), 20000)

    def test_dom_location_selects_the_correct_occurrence(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'book.epub'
            with zipfile.ZipFile(path, 'w') as book:
                book.writestr('chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>First passage</p><p>Second <em>passage</em></p></body></html>')
            with zipfile.ZipFile(path) as book:
                self.assertEqual(passage_text(book, {'href': 'chapter.xhtml', 'dom_path': 'html[1]/body[1]/p[2]'}), 'Second passage')


if __name__ == '__main__':
    unittest.main()
