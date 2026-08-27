import { afterEach, beforeEach, expect, mock, test } from 'bun:test';

const files = new Map<string, number>();
let downloadSize = 12;

class FakeFile {
  uri: string;

  constructor(...parts: unknown[]) {
    const values = parts.map(String);
    this.uri =
      values.length === 1
        ? values[0]
        : `${values[0].replace(/\/?$/, '/')}${values.slice(1).join('/')}`;
  }

  get exists() {
    return files.has(this.uri);
  }

  get size() {
    return files.get(this.uri) ?? 0;
  }

  delete() {
    files.delete(this.uri);
  }

  async move(destination: FakeFile) {
    const size = files.get(this.uri);
    if (size == null) throw new Error('source does not exist');
    files.delete(this.uri);
    files.set(destination.uri, size);
    this.uri = destination.uri;
  }

  static async downloadFileAsync(_url: string, destination: FakeFile) {
    files.set(destination.uri, downloadSize);
    return destination;
  }
}

mock.module('react-native', () => ({ Platform: { OS: 'web' } }));
mock.module('expo-file-system', () => ({
  File: FakeFile,
  Paths: { document: 'file:///documents/' },
}));

const { getAPIBaseURL, setAPIBaseURL } = await import('./api-base');
const { productEPUBSource } = await import('./epub-source.native');
const { downloadProductAudio } = await import('./media.native');
const { setStorageUserID } = await import('./storage-scope');
const originalAPIBaseURL = getAPIBaseURL();

beforeEach(() => {
  files.clear();
  downloadSize = 12;
  setAPIBaseURL('http://localhost:8080');
  setStorageUserID('reader');
});

afterEach(() => {
  setAPIBaseURL(originalAPIBaseURL);
  setStorageUserID('');
});

test('native downloads retain finalized EPUB and audio files after move mutates the source URI', async () => {
  const epub = await productEPUBSource('epub-success', downloadSize);
  const audio = await downloadProductAudio('audio-success', downloadSize);

  expect(files.has(epub)).toBe(true);
  expect(files.has(audio)).toBe(true);
  expect([...files.keys()].some((uri) => uri.includes('.part'))).toBe(false);
});

test('native downloads remove incomplete files without publishing them', async () => {
  downloadSize = 11;

  await expect(productEPUBSource('epub-incomplete', 12)).rejects.toThrow('incomplete');
  await expect(downloadProductAudio('audio-incomplete', 12)).rejects.toThrow('incomplete');

  expect([...files.keys()].some((uri) => uri.includes('epub-incomplete'))).toBe(false);
  expect([...files.keys()].some((uri) => uri.includes('audio-incomplete'))).toBe(false);
});
