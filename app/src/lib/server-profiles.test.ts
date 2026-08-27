import { expect, it } from 'bun:test';
import { removeInactiveServerProfile, type ServerProfile } from './server-profile-types';

const profiles: ServerProfile[] = [
  { origin: 'https://current.example', last_connected_at: '2026-08-26T00:00:00Z' },
  { origin: 'https://old.example', last_connected_at: '2026-08-25T00:00:00Z' },
];

it('forgets only inactive server profiles', () => {
  expect(
    removeInactiveServerProfile(profiles, 'https://current.example', 'https://old.example'),
  ).toEqual([profiles[0]]);
  expect(() =>
    removeInactiveServerProfile(profiles, 'https://current.example', 'https://current.example'),
  ).toThrow('Switch libraries');
});
