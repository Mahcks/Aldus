import type { Anchor, AnchorFixture, OnsetAnchor, OnsetFixture } from './anchors.types';

export type AuthoringFixture = {
  id: string;
  label: string;
  prefix: string;
  epub: string;
  audio: string;
  epubSHA: string;
  audioSHA: string;
  koReaderHash: string;
};

// Frozen corpus v1 identities; changing bytes requires a new fixture identity.
export const authoringFixtures: AuthoringFixture[] = [
  {
    id: 'alice-ch01-control',
    label: 'Alice \u00b7 chapter-one control',
    prefix: 'alice-ch01',
    epub: 'alice.epub',
    audio: 'alice-chapter-01.mp3',
    epubSHA: '6b79f2d23b804172816e81c463dbcea689593bbde63ef200d52b6c0da7ef629c',
    audioSHA: '6c58be3679f82e5d20b2c5efea6f377ee0ed985a4e2b4dbd5201ea656312757a',
    koReaderHash: 'abb11be65399f96116fd90ab861dda0e',
  },
  {
    id: 'alice-full',
    label: "Alice's Adventures in Wonderland \u00b7 full book",
    prefix: 'alice-full',
    epub: 'alice/alice.epub',
    audio: 'alice/alices-adventures-in-wonderland-librivox-v8.m4b',
    epubSHA: '6b79f2d23b804172816e81c463dbcea689593bbde63ef200d52b6c0da7ef629c',
    audioSHA: 'a74d661f909a8c11f0a04dbbab387ba00c66464753bba93a3d0393b1195c7e81',
    koReaderHash: '',
  },
  {
    id: 'pride-full',
    label: 'Pride and Prejudice \u00b7 full book',
    prefix: 'pride-full',
    epub: 'pride-and-prejudice/pride-and-prejudice.epub',
    audio: 'pride-and-prejudice/pride-and-prejudice.m4b',
    epubSHA: '2c1a5bce2f7fb394609372442c56c49d87e87b94657ccf90c2b90b571a9dfed6',
    audioSHA: '8551ca09538db88923355e7afda0c848e63fe50101002d5f63722dadfcfc03b9',
    koReaderHash: '',
  },
  {
    id: 'frankenstein-full',
    label: 'Frankenstein \u00b7 full book',
    prefix: 'frankenstein-full',
    epub: 'frankenstein/frankenstein.epub',
    audio: 'frankenstein/frankenstein.m4b',
    epubSHA: 'dd7ec02d2c8db4162bf587aa09a692ed5394ead3dfb12d8cc14b449d89795a6a',
    audioSHA: '08ffa55a81533d44fbdbc4dc67686c7f09f04ab3ea30d47fabba9f85e0f444f4',
    koReaderHash: '',
  },
  {
    id: 'dracula-full',
    label: 'Dracula \u00b7 full book',
    prefix: 'dracula-full',
    epub: 'dracula/dracula.epub',
    audio: 'dracula/dracula.m4b',
    epubSHA: '8a275fd1e858a9a873ca857592b48cca3183ccff7b561fa5cb03a4fabca054dc',
    audioSHA: 'cf57d8379885c8d337c8fddacb4d4844bb141077fb38741f042f6220efd51400',
    koReaderHash: '',
  },
];

export function storageKeys(fixture: AuthoringFixture) {
  if (fixture.id === 'alice-ch01-control') {
    return { anchors: 'aldus:alice:anchors:v3', onsets: 'aldus:alice:onsets:v1' };
  }
  const scope = `aldus:corpus:${fixture.id}:${fixture.epubSHA}:${fixture.audioSHA}`;
  return { anchors: `${scope}:anchors:v3`, onsets: `${scope}:onsets:v1` };
}

export function emptyFixture(fixture: AuthoringFixture): AnchorFixture {
  return {
    version: 1,
    fixture_id: fixture.id,
    epub_sha256: fixture.epubSHA,
    audio_sha256: fixture.audioSHA,
    koreader_document_hash: fixture.koReaderHash,
    anchors: [],
  };
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const milliseconds = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function boundary(value: unknown) {
  return record(value) && nonempty(value.dom_path) && milliseconds(value.node_offset);
}

export function validAnchors(value: unknown, fixture: AuthoringFixture): value is AnchorFixture {
  if (
    !record(value) ||
    value.version !== 1 ||
    value.epub_sha256 !== fixture.epubSHA ||
    value.audio_sha256 !== fixture.audioSHA ||
    (value.fixture_id !== undefined && value.fixture_id !== fixture.id) ||
    !Array.isArray(value.anchors)
  )
    return false;
  const ids = new Set<string>();
  return value.anchors.every((anchor: unknown) => {
    if (
      !record(anchor) ||
      !nonempty(anchor.id) ||
      ids.has(anchor.id) ||
      !nonempty(anchor.text) ||
      !nonempty(anchor.normalized_text) ||
      !record(anchor.epub) ||
      !nonempty(anchor.epub.href) ||
      typeof anchor.epub.cfi !== 'string' ||
      !boundary(anchor.epub.start) ||
      !boundary(anchor.epub.end) ||
      !record(anchor.audio) ||
      anchor.audio.resource !== fixture.audio ||
      !milliseconds(anchor.audio.timestamp_ms) ||
      !record(anchor.audio.seek) ||
      !milliseconds(anchor.audio.seek.requested_ms) ||
      !milliseconds(anchor.audio.seek.reported_ms) ||
      typeof anchor.audio.seek.difference_ms !== 'number' ||
      !Number.isSafeInteger(anchor.audio.seek.difference_ms)
    )
      return false;
    ids.add(anchor.id);
    return true;
  });
}

export function samePassage(left: Anchor['epub'], right: Anchor['epub']) {
  return (
    left.href === right.href &&
    left.start.dom_path === right.start.dom_path &&
    left.start.node_offset === right.start.node_offset &&
    left.end.dom_path === right.end.dom_path &&
    left.end.node_offset === right.end.node_offset
  );
}

export function currentOnsets(
  value: unknown,
  source: AnchorFixture,
  fixture: AuthoringFixture,
): OnsetAnchor[] {
  if (
    !record(value) ||
    value.version !== 1 ||
    value.semantics !== onsetSemantics ||
    value.epub_sha256 !== fixture.epubSHA ||
    value.audio_sha256 !== fixture.audioSHA ||
    (value.fixture_id !== undefined && value.fixture_id !== fixture.id) ||
    !Array.isArray(value.anchors)
  )
    return [];
  const ids = new Set<string>();
  return value.anchors.filter((item: unknown): item is OnsetAnchor => {
    if (!record(item) || !nonempty(item.anchor_id) || ids.has(item.anchor_id)) return false;
    const anchor = source.anchors.find((anchor) => anchor.id === item.anchor_id);
    if (
      !anchor ||
      item.manual_seek_timestamp_ms !== anchor.audio.timestamp_ms ||
      !milliseconds(item.audible_onset_timestamp_ms) ||
      !nonempty(item.annotation_notes) ||
      item.opening_word !== openingWord(anchor.normalized_text) ||
      item.manual_minus_onset_ms !== anchor.audio.timestamp_ms - item.audible_onset_timestamp_ms
    )
      return false;
    if (item.epub !== undefined) {
      if (
        !record(item.epub) ||
        !boundary(item.epub.start) ||
        !boundary(item.epub.end) ||
        !samePassage(anchor.epub, item.epub as Anchor['epub'])
      )
        return false;
    } else if (fixture.id !== 'alice-ch01-control') return false;
    ids.add(item.anchor_id);
    return true;
  });
}

export const onsetSemantics = 'earliest point at which the opening spoken word audibly begins';

export function onsetFixture(fixture: AuthoringFixture, anchors: OnsetAnchor[]): OnsetFixture {
  return {
    version: 1,
    fixture_id: fixture.id,
    semantics: onsetSemantics,
    epub_sha256: fixture.epubSHA,
    audio_sha256: fixture.audioSHA,
    anchors,
  };
}

export function openingWord(text: string) {
  return text.match(/[\p{L}’'-]+/u)?.[0] ?? '';
}

export async function verifyMedia(file: File, expected: string) {
  // ponytail: Web Crypto buffers one corpus file (currently <=624 MB); use
  // incremental hashing if larger authoring inputs need to be supported.
  if (file.size > 1024 * 1024 * 1024) throw new Error('Choose a corpus file smaller than 1 GiB.');
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const actual = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  if (actual !== expected)
    throw new Error('File hash does not match the selected fixture. Choose its pinned file.');
}
