import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from alignment_evaluation import evaluate_anchors, error_metrics

ROOT = Path(__file__).resolve().parents[1]
ALICE = ROOT / 'test-fixtures/alice'


class EvaluationTest(unittest.TestCase):
    def setUp(self):
        self.golden = json.loads((ALICE / 'anchors.json').read_text())
        self.candidate = json.loads((ALICE / 'automatic/whisperx/alignment.json').read_text())

    def test_original_control_and_arbitrary_count(self):
        rows = evaluate_anchors(self.candidate, self.golden)
        old = json.loads((ALICE / 'automatic/whisperx/evaluation.json').read_text())
        self.assertEqual([r['absolute_error_ms'] for r in rows], [r['absolute_error_ms'] for r in old['anchors']])
        for index in range(14):
            anchor = copy.deepcopy(self.golden['anchors'][0])
            anchor['id'] = f'extra-{index}'
            self.golden['anchors'].append(anchor)
        self.assertEqual(len(evaluate_anchors(self.candidate, self.golden)), 24)

    def test_occurrence_ambiguity_and_refusal(self):
        anchor = self.golden['anchors'][0]
        segment = next(s for s in self.candidate['segments'] if s['epub'].get('start') == anchor['epub']['start'])
        repeated = copy.deepcopy(segment)
        repeated['id'] = 'repeat'
        repeated['epub']['href'] = 'another-chapter.xhtml'
        self.candidate['segments'].insert(0, repeated)
        self.assertEqual(evaluate_anchors(self.candidate, self.golden)[0]['segment_id'], segment['id'])
        repeated['epub'] = copy.deepcopy(segment['epub'])
        self.assertEqual(evaluate_anchors(self.candidate, self.golden)[0]['status'], 'ambiguous')
        self.candidate['segments'].remove(repeated)
        segment['highlightable'] = False
        anchor['expected_match'] = False
        self.assertTrue(evaluate_anchors(self.candidate, self.golden)[0]['negative_pass'])
        segment['highlightable'] = True
        self.assertFalse(evaluate_anchors(self.candidate, self.golden)[0]['negative_pass'])

    def test_hashes_offsets_and_whole_elements(self):
        self.candidate['audio_sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'audio_sha256'):
            evaluate_anchors(self.candidate, self.golden)
        self.candidate['audio_sha256'] = self.golden['audio_sha256']
        anchor = self.golden['anchors'][0]
        segment = next(s for s in self.candidate['segments'] if s['epub'].get('start') == anchor['epub']['start'])
        segment['epub']['start']['node_offset'] += 1
        self.assertEqual(evaluate_anchors(self.candidate, self.golden)[0]['status'], 'unresolved')
        segment['epub'] = {'href': anchor['epub']['href'], 'dom_path': anchor['epub']['start']['dom_path'].rsplit('/', 1)[0]}
        self.assertEqual(evaluate_anchors(self.candidate, self.golden)[0]['status'], 'matched')
        anchor['normalized_text'] = anchor['normalized_text'].split()[0]
        self.assertEqual(evaluate_anchors(self.candidate, self.golden)[0]['status'], 'unresolved')
        self.assertIsNone(error_metrics([])['p95_absolute_error_ms'])

    def test_original_onset_cli_and_generalized_count(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'result.json'
            command = ['python3', str(ROOT / 'tools/alignment.py'), 'onset-evaluate', '--manual', str(ALICE / 'anchors.json'), '--onsets', str(ALICE / 'onset-anchors.json'), '--boundaries', str(ALICE / 'automatic/whisperx/boundary-analysis.json'), '--output', str(output)]
            subprocess.run(command, check=True, capture_output=True)
            old = json.loads((ALICE / 'automatic/whisperx/onset-evaluation.json').read_text())
            result = json.loads(output.read_text())
            for name in old['metrics']:
                self.assertEqual(result['metrics'][name]['median_absolute_error_ms'], old['metrics'][name]['median_absolute_error_ms'])
            onsets = json.loads((ALICE / 'onset-anchors.json').read_text())
            self.golden['anchors'] = self.golden['anchors'][:2]
            onsets['anchors'] = onsets['anchors'][:2]
            manual_path = Path(directory) / 'manual.json'
            onset_path = Path(directory) / 'onsets.json'
            manual_path.write_text(json.dumps(self.golden))
            onset_path.write_text(json.dumps(onsets))
            subprocess.run(['python3', str(ROOT / 'tools/alignment.py'), 'onset-evaluate', '--manual', str(manual_path), '--onsets', str(onset_path), '--candidate', str(ALICE / 'automatic/whisperx/alignment.json'), '--output', str(output)], check=True, capture_output=True)
            self.assertEqual(len(json.loads(output.read_text())['rows']), 2)


if __name__ == '__main__':
    unittest.main()
