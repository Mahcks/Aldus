import { afterEach, expect, mock, test } from 'bun:test';

mock.module('react-native', () => ({ Platform: { OS: 'web' } }));

const { getAPIBaseURL, setAPIBaseURL } = await import('./api-base');
const { activeStorageScope, setStorageUserID } = await import('./storage-scope');
const { saveWorkProgress } = await import('./progress-outbox');
const { api } = await import('./api');
const originalOrigin = getAPIBaseURL();
const originalSave = api.updateWorkProgress;

afterEach(() => {
  setAPIBaseURL(originalOrigin);
  setStorageUserID('');
  api.updateWorkProgress = originalSave;
});

test('same-origin web progress saves retain account and server guards', async () => {
  setAPIBaseURL('');
  setStorageUserID('reader');
  const update = {
    alignment_id: 'alignment',
    segment_id: 'segment',
    offset: 500,
    expected_revision: 1,
    source_device: 'web',
  };
  const saved = { ...update, revision: 2 };
  const write = mock(async () => saved);
  api.updateWorkProgress = write;
  const scope = activeStorageScope();
  expect(await saveWorkProgress('work', update)).toEqual(saved);
  expect(write).toHaveBeenCalledTimes(1);

  setStorageUserID('other-reader');
  await expect(saveWorkProgress('work', update, scope, '')).rejects.toThrow('account changed');
  setStorageUserID('reader');
  setAPIBaseURL('http://another-server:8080');
  await expect(saveWorkProgress('work', update, scope, '')).rejects.toThrow('account changed');
  setAPIBaseURL('');
  setStorageUserID('');
  await expect(saveWorkProgress('work', update)).rejects.toThrow('account changed');
  expect(write).toHaveBeenCalledTimes(1);
});
