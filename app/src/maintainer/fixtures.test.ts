import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  authoringFixtures,
  currentOnsets,
  emptyFixture,
  onsetFixture,
  storageKeys,
  validAnchors,
  verifyMedia,
} from './fixtures';
import type { AnchorFixture } from './anchors.types';

const golden = JSON.parse(
  readFileSync(new URL('../../../test-fixtures/alice/anchors.json', import.meta.url), 'utf8'),
) as AnchorFixture;
const oldOnsets: unknown = JSON.parse(
  readFileSync(new URL('../../../test-fixtures/alice/onset-anchors.json', import.meta.url), 'utf8'),
);

test('fixture identity, arbitrary counts, and stale passage annotations', async () => {
  const control = authoringFixtures[0];
  expect(storageKeys(control).anchors).toBe('aldus:alice:anchors:v3');
  expect(new Set(authoringFixtures.map((fixture) => storageKeys(fixture).anchors)).size).toBe(5);
  expect(validAnchors(golden, control)).toBe(true);
  expect(validAnchors(golden, authoringFixtures[1])).toBe(false);
  const source = structuredClone(golden) as AnchorFixture;
  source.anchors = Array.from({ length: 24 }, (_, index) => ({
    ...structuredClone(golden.anchors[0]),
    id: `anchor-${index}`,
  }));
  expect(validAnchors(source, control)).toBe(true);
  source.anchors[1].id = source.anchors[0].id;
  expect(validAnchors(source, control)).toBe(false);
  const annotations = currentOnsets(oldOnsets, golden as AnchorFixture, control);
  expect(annotations.length).toBe(10);
  const full = authoringFixtures[1];
  const fullSource = emptyFixture(full);
  fullSource.anchors = [
    {
      ...structuredClone(golden.anchors[0]),
      audio: { ...golden.anchors[0].audio, resource: full.audio },
    },
  ];
  const annotation = { ...annotations[0], epub: structuredClone(fullSource.anchors[0].epub) };
  const saved = onsetFixture(full, [annotation]);
  expect(currentOnsets(saved, fullSource, full).length).toBe(1);
  fullSource.anchors[0].epub.start.node_offset += 1;
  expect(currentOnsets(saved, fullSource, full).length).toBe(0);
  await verifyMedia(
    new File(['abc'], 'sample'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  await expect(verifyMedia(new File(['wrong'], 'sample'), full.audioSHA)).rejects.toThrow('hash');
});
