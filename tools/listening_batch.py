"""Prepare a small, source-bound, model-assisted listening review."""

import hashlib
import json
from pathlib import Path
import re
import subprocess
from xml.etree import ElementTree as ET
import zipfile

CHAPTERS = (1, 4, 7, 10, 12)


def digest(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def passage_text(book, locator):
    node = ET.fromstring(book.read(locator['href']))
    parts = locator['dom_path'].split('/')
    if parts.pop(0) != 'html[1]':
        raise ValueError('Unsupported EPUB root')
    for part in parts:
        match = re.fullmatch(r'([a-zA-Z0-9]+)\[([1-9][0-9]*)\]', part)
        if not match:
            raise ValueError('Unsupported EPUB element path')
        tag, index = match.groups()
        nodes = [child for child in node if child.tag.rsplit('}', 1)[-1] == tag]
        node = nodes[int(index) - 1]
    return ' '.join(''.join(node.itertext()).split())


def prepare_batch(directory, candidate_path, epub_path, audio_path, evidence_root, chapters=CHAPTERS, review_start_ms=None, *, segment_ids=None, title="Alice"):
    if segment_ids is not None:
        if not 1 <= len(segment_ids) <= 12 or len(set(segment_ids)) != len(segment_ids):
            raise ValueError("Choose one to twelve distinct passages")
        if review_start_ms is not None:
            raise ValueError("Re-estimated starts require chapter selection")
    if not chapters or len(set(chapters)) != len(chapters) or any(chapter not in range(1, 13) for chapter in chapters):
        raise ValueError("Choose distinct Alice chapters from 1 through 12")
    if review_start_ms is not None and (len(chapters) != 1 or type(review_start_ms) is not int or review_start_ms < 5000):
        raise ValueError("A re-estimated start requires one chapter and a valid timestamp")
    candidate = json.loads(Path(candidate_path).read_text())
    for field, source in [('epub_sha256', epub_path), ('audio_sha256', audio_path)]:
        if digest(source) != candidate[field]:
            raise ValueError(f'{field}: source does not match the alignment')
    # Explicit passage selection supports other books without guessing their
    # chapter naming. These remain model-assisted reviews, not blind annotations.
    selected = []
    for key in segment_ids if segment_ids is not None else chapters:
        segment = next((item for item in candidate["segments"]
                        if (item["id"] == key if segment_ids is not None
                            else item["epub"]["href"].endswith(f"-h-{key}.htm.xhtml"))
                        and item.get("status") == "aligned"
                        and item.get("highlightable") is True and len(item["text"]) > 110), None)
        if segment is None:
            raise ValueError(f"No eligible passage for {key}")
        selected.append((key, segment))
    sessions = []
    with zipfile.ZipFile(epub_path) as book:
        for key, segment in selected:
            text = passage_text(book, segment['epub'])
            if text != ' '.join(segment['text'].split()):
                raise ValueError(f'Passage {key}: EPUB passage does not match the candidate')
            candidate_start = segment['audio']['start_ms']
            proposed = candidate_start if review_start_ms is None else review_start_ms
            if not isinstance(proposed, int) or isinstance(proposed, bool) or proposed < 5000:
                raise ValueError('Invalid proposed start')
            clip_start = proposed - 5000
            clip_file = f'passage-{len(sessions) + 1}.wav' if segment_ids is not None else f'chapter-{key}.wav'
            subprocess.run([
                'ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error',
                '-ss', str(clip_start / 1000), '-i', str(audio_path),
                '-t', '15', '-ac', '1', '-ar', '24000', str(directory / clip_file),
            ], check=True)
            excerpt = text[:160].rsplit(' ', 1)[0] + '…' if len(text) > 160 else text
            sessions.append({
                'id': segment['id'], 'chapter': key if segment_ids is None else None, 'text': excerpt,
                'source_text': text, 'epub': segment['epub'],
                'opening_word': re.search(r"[^\W\d_]+(?:['’][^\W\d_]+)*", text).group(),
                'start_ms': 5000, 'clip_file': clip_file,
                'clip_sha256': digest(directory / clip_file), 'source_start_ms': clip_start,
                'proposed_timestamp_ms': proposed,
                'candidate_timestamp_ms': candidate_start,
            })
    manifest = {
        'version': 1, 'title': f'{title}: {len(sessions)} passages',
        'annotation_mode': 'model-assisted-review',
        'selection': ('explicit passages: ' + ', '.join(segment_ids) if segment_ids is not None
                      else 'first eligible paragraph in chapters ' + ', '.join(map(str, chapters))),
        'proposal_origin': 'candidate' if review_start_ms is None else 'experimental-reestimate',
        'epub_sha256': candidate['epub_sha256'], 'audio_sha256': candidate['audio_sha256'],
        'candidate_sha256': digest(candidate_path), 'sessions': sessions,
    }
    if segment_ids is not None or title != 'Alice':
        manifest['book_title'] = title
    manifest['id'] = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
    evidence = Path(evidence_root) / manifest['id']
    evidence.mkdir(parents=True, exist_ok=True)
    (evidence / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest, evidence / 'responses.json'


def read_answers(path):
    return json.loads(path.read_text()) if path.exists() else {}


def save_answer(manifest, path, answer):
    if answer.get('batch_id') != manifest['id']:
        raise ValueError('The batch has changed. Reload before saving.')
    session = next((item for item in manifest['sessions'] if item['id'] == answer.get('session_id')), None)
    if session is None or answer.get('clip_sha256') != session['clip_sha256']:
        raise ValueError('The clip has changed. Reload before saving.')
    boundary = answer.get('boundary_ms')
    if type(boundary) is not int or not 1000 <= boundary <= 11000:
        raise ValueError('The reviewed start is outside the clip.')
    if answer.get('result') not in ('right', 'unsure'):
        raise ValueError('Choose Perfect or Not sure.')
    answers = read_answers(path)
    reviewed = session['source_start_ms'] + boundary if answer['result'] == 'right' else None
    answers[session['id']] = {
        'clip_sha256': session['clip_sha256'], 'boundary_ms': boundary,
        'result': answer['result'], 'reviewed_timestamp_ms': reviewed,
        'correction_ms': reviewed - session['proposed_timestamp_ms'] if reviewed is not None else None,
        'annotation_mode': 'model-assisted-review',
    }
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(answers, indent=2) + '\n')
    temporary.replace(path)
    return answers
