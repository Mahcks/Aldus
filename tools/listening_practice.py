#!/usr/bin/env python3
"""Serve listening practice or a source-bound model-assisted review batch."""

import argparse
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading

from listening_batch import CHAPTERS, prepare_batch, read_answers, save_answer

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'test-fixtures/alice'
PORT = 18882


def prepare(directory):
    anchors = json.loads((FIXTURE / 'anchors.json').read_text())
    onsets = json.loads((FIXTURE / 'onset-anchors.json').read_text())
    anchor = anchors['anchors'][0]
    onset = next(item for item in onsets['anchors'] if item['anchor_id'] == anchor['id'])
    source = FIXTURE / 'pinned/alice-chapter-01.mp3'
    if hashlib.sha256(source.read_bytes()).hexdigest() != anchors['audio_sha256']:
        raise ValueError('The pinned Alice audio has changed.')
    start_ms = onset['audible_onset_timestamp_ms'] - 3000
    subprocess.run([
        'ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error',
        '-i', str(source), '-ss', str(start_ms / 1000), '-t', '10',
        '-ac', '1', '-ar', '24000', str(directory / 'clip.wav'),
    ], check=True)
    clip_hash = hashlib.sha256((directory / 'clip.wav').read_bytes()).hexdigest()
    session = {
        'id': 'alice-listening-practice-v1',
        'text': 'Alice was beginning to get very tired of sitting by her sister on the bank…',
        'opening_word': 'Alice', 'start_ms': 3000,
        'clip_sha256': clip_hash,
        'source_audio_sha256': anchors['audio_sha256'],
        'source_start_ms': start_ms,
        'anchor_id': anchor['id'],
    }
    (directory / 'session.json').write_text(json.dumps(session))
    return session


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidate', type=Path)
    parser.add_argument('--epub', type=Path)
    parser.add_argument('--audio', type=Path)
    parser.add_argument('--chapters', type=int, nargs='+', default=CHAPTERS)
    parser.add_argument('--review-start-ms', type=int)
    parser.add_argument('--segment-ids', nargs='+')
    parser.add_argument('--title', default='Alice')
    args = parser.parse_args()
    if args.segment_ids and not args.candidate:
        parser.error('--segment-ids requires --candidate')
    if args.review_start_ms is not None and not args.candidate:
        parser.error('--review-start-ms requires --candidate')
    if args.candidate and (not args.epub or not args.audio):
        parser.error('--candidate requires --epub and --audio')
    if not shutil.which('ffmpeg'):
        raise SystemExit('Install ffmpeg to prepare this listening exercise.')
    with tempfile.TemporaryDirectory(prefix='aldus-listening-') as temporary:
        directory = Path(temporary)
        prepare(directory)
        answers_lock = threading.Lock()
        batch = None
        responses = None
        if args.candidate:
            batch, responses = prepare_batch(directory, args.candidate, args.epub, args.audio, ROOT / 'artifacts/listening-review', args.chapters, args.review_start_ms, segment_ids=args.segment_ids, title=args.title)

        class Handler(SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=str(directory), **kwargs)

            def end_headers(self):
                # Only this public-domain exercise is exposed, on loopback.
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Cache-Control', 'no-store')
                super().end_headers()

            def send_json(self, status, value):
                body = json.dumps(value).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                if self.path == '/batch.json' and batch is not None:
                    with answers_lock:
                        answers = read_answers(responses)
                    self.send_json(200, {**batch, 'answers': answers})
                else:
                    super().do_GET()

            def do_OPTIONS(self):
                if self.headers.get('Origin') not in ('http://localhost:8081', 'http://127.0.0.1:8081'):
                    self.send_error(403)
                    return
                self.send_response(204)
                self.send_header('Access-Control-Allow-Methods', 'POST')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type')
                self.end_headers()

            def do_POST(self):
                if self.path != '/feedback' or batch is None:
                    self.send_error(404)
                    return
                if self.headers.get('Origin') not in ('http://localhost:8081', 'http://127.0.0.1:8081') or self.headers.get_content_type() != 'application/json':
                    self.send_error(403)
                    return
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                    if not 0 < length <= 4096:
                        raise ValueError('Invalid answer size')
                    answer = json.loads(self.rfile.read(length))
                    if not isinstance(answer, dict):
                        raise ValueError('Invalid answer')
                    with answers_lock:
                        answers = save_answer(batch, responses, answer)
                    self.send_json(200, {'answers': answers})
                except (ValueError, KeyError, TypeError) as error:
                    self.send_json(400, {'error': str(error)})
                except OSError:
                    self.send_json(500, {'error': 'Could not save your answer. Please retry.'})

            def log_message(self, *_args):
                pass

        with ThreadingHTTPServer(('127.0.0.1', PORT), Handler) as server:
            print('Open http://localhost:8081/onsets?' + ('review=book' if batch else 'practice=alice'), flush=True)
            print('Keep this terminal open. Ctrl+C stops the exercise.', flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass


if __name__ == '__main__':
    main()
