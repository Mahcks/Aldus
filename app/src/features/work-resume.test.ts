import { expect, test } from 'bun:test';
import { workResumeMode } from './work-resume';

test('resumes only a format that is available, preserving the last mode when possible', () => {
  expect(workResumeMode({ last_mode: 'listen', readable: true, listenable: true })).toBe('listen');
  expect(workResumeMode({ last_mode: 'listen', readable: true, listenable: false })).toBe('read');
  expect(workResumeMode({ last_mode: 'read', readable: false, listenable: true })).toBe('listen');
  expect(workResumeMode({ last_mode: '', readable: true, listenable: true })).toBe('read');
  expect(
    workResumeMode({ last_mode: 'listen', readable: false, listenable: false }),
  ).toBeUndefined();
});
