import { afterEach, expect, mock, test } from 'bun:test';

mock.module('react-native', () => ({ Platform: { OS: 'web' } }));

const { inspectServer } = await import('./ServerProvider');
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('server inspection accepts current and legacy v1 setup responses', async () => {
  const responses = [
    { available: false, demo_available: true, server_version: '0.1.0-beta.17', api_version: 'v1' },
    { available: true, demo_available: false },
  ];
  const urls: string[] = [];
  globalThis.fetch = (async (input) => {
    urls.push(String(input));
    return Response.json(responses.shift());
  }) as typeof fetch;

  await expect(inspectServer('https://library.example')).resolves.toMatchObject({
    api_version: 'v1',
  });
  await expect(inspectServer('https://legacy.example')).resolves.toEqual({
    available: true,
    demo_available: false,
  });
  expect(urls).toEqual([
    'https://library.example/api/v1/setup/status',
    'https://legacy.example/api/v1/setup/status',
  ]);
});

test('server inspection rejects a non-Aldus JSON response', async () => {
  globalThis.fetch = (async () => Response.json({ status: 'ok' })) as unknown as typeof fetch;
  await expect(inspectServer('https://example.com')).rejects.toThrow(
    'That server returned an invalid response.',
  );
});
