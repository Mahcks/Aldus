import { expect, test } from 'bun:test';
import { conflictPlaceOptions } from './handoff-places';

test('a missing server place never hides the retained local passage or listening time', () => {
  const local = { alignment_id: 'alignment', segment_id: 'chapter', offset: 42 };
  const options = conflictPlaceOptions(
    { local, remote: null },
    undefined,
    [{ id: 'chapter', text: 'The passage kept on this device.' }],
    'ios',
  );
  expect(options[0].position).toBe('The passage kept on this device.');
  expect(options[1].position).toContain('No saved place');
  expect(options[0].savedLabel).toBe('Kept on this device');
  const audio = conflictPlaceOptions(
    undefined,
    {
      workID: 'book',
      kind: 'audio',
      remote: null,
      local: {
        representation_id: 'audio',
        revision: 1,
        audio_timestamp_ms: 65000,
        updated_at: '2026-09-25T10:00:00Z',
      },
    },
    [],
    'web',
  );
  expect(audio[0].position).toBe('1:05');
  expect(audio[0].savedLabel).toContain(new Date('2026-09-25T10:00:00Z').toLocaleString());
  expect(audio[1].savedLabel).toBe('No server save yet');
});

test('the server copy is not presented as a different phone based on its platform', () => {
  const local = { alignment_id: 'alignment', segment_id: 'local', offset: 0, source_device: 'ios' };
  const remote = { ...local, segment_id: 'remote' };
  const options = conflictPlaceOptions({ local, remote }, undefined, [], 'ios');
  expect(options[0].device).toEqual({ platform: 'ios' });
  expect(options[1].device).toEqual({ label: 'your server', platform: 'other' });
});
