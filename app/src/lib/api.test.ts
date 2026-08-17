import { afterEach, describe, expect, it, mock } from 'bun:test';

mock.module('react-native', () => ({ Platform: { OS: 'web' } }));
const { api, APIError } = await import('./api');
const { resolveAPIBaseURL } = await import('./api-base');

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('API transport', () => {
  it('uses one normalized API origin for web, simulator, and physical-device configuration', () => {
    expect(resolveAPIBaseURL('http://aldus-dev.local:8080/', 'ios')).toBe(
      'http://aldus-dev.local:8080',
    );
    expect(resolveAPIBaseURL(undefined, 'web')).toBe('');
    expect(resolveAPIBaseURL('http://192.168.86.28:8080', 'web', 'http://localhost:8080')).toBe(
      'http://localhost:8080',
    );
    expect(resolveAPIBaseURL(undefined, 'ios')).toBe('http://localhost:8080');
    expect(resolveAPIBaseURL(undefined, 'ios', undefined, '192.168.86.28:8081')).toBe(
      'http://192.168.86.28:8080',
    );
  });
  it('uses credentialed requests and generated setup fields', async () => {
    let request: RequestInit | undefined;
    globalThis.fetch = (async (_input, init) => {
      request = init;
      return Response.json({ available: true });
    }) as typeof fetch;
    expect(await api.setupStatus()).toEqual({ available: true });
    expect(request?.credentials).toBe('include');
  });

  it('does not persist or attach the web login token', async () => {
    const calls: RequestInit[] = [];
    globalThis.fetch = (async (_input, init) => {
      calls.push(init || {});
      return Response.json(
        calls.length === 1 ? { token: 'secret', expires_at: '', user: { id: 'u' } } : { id: 'u' },
      );
    }) as typeof fetch;
    await api.login({ username: 'reader', password: 'password' });
    await api.me();
    expect(new Headers(calls[1].headers).has('Authorization')).toBe(false);
  });

  it('handles no-content and typed errors', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    await expect(api.updateUser('u', { disabled: true })).resolves.toBeUndefined();
    globalThis.fetch = (async () =>
      new Response('last administrator\n', { status: 409 })) as unknown as typeof fetch;
    await expect(api.updateUser('u', { disabled: true })).rejects.toEqual(
      new APIError(409, 'last administrator'),
    );
  });

  it('includes the server request reference in unexpected errors', async () => {
    globalThis.fetch = (async () =>
      new Response('internal server error\n', {
        status: 500,
        headers: { 'X-Request-ID': 'abc123' },
      })) as unknown as typeof fetch;
    await expect(api.libraries()).rejects.toEqual(
      new APIError(500, 'internal server error', 'abc123'),
    );
  });

  it('does not expose an HTML page as an API error', async () => {
    globalThis.fetch = (async () =>
      new Response('<!DOCTYPE html><html></html>', {
        status: 404,
        headers: { 'Content-Type': 'text/html' },
      })) as unknown as typeof fetch;
    await expect(api.me()).rejects.toEqual(
      new APIError(
        404,
        'Aldus received a web page instead of an API response. Check the server URL.',
      ),
    );
  });

  it('restores Work alignment jobs through the generated contract', async () => {
    let url = '';
    const jobs = [
      {
        id: 'job-1',
        epub_media_id: 'epub-1',
        audio_media_id: 'audio-1',
        state: 'processing',
        attempts: 1,
        worker_version: 'whisperx 3.8.6',
        model: 'base.en',
        created_at: '2026-01-01T00:00:00Z',
      },
    ];
    globalThis.fetch = (async (input) => {
      url = String(input);
      return Response.json(jobs);
    }) as typeof fetch;
    expect(await api.alignmentJobs('work-1')).toEqual(jobs);
    expect(url).toEndWith('/api/works/work-1/alignment-jobs');
  });

  it('builds one bounded server browse request', async () => {
    let url = '';
    globalThis.fetch = (async (input) => {
      url = String(input);
      return Response.json({ items: [], offset: 24, has_more: false });
    }) as typeof fetch;
    await api.browseWorks({
      libraryID: 'library',
      q: 'Alice & Bob',
      sort: 'title',
      availability: 'readable',
      limit: 24,
      offset: 24,
    });
    expect(url).toEndWith(
      '/api/works?library_id=library&q=Alice+%26+Bob&sort=title&availability=readable&limit=24&offset=24',
    );
  });

  it('browses only configured server source roots', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input) => {
      urls.push(String(input));
      return Response.json(
        urls.length === 1
          ? [{ id: 'root', label: 'Media', path: '/library/media', available: true }]
          : {
              root_id: 'root',
              relative_path: 'Books/Classics',
              selected_path: '/library/media/Books/Classics',
              has_parent: true,
              directories: [],
            },
      );
    }) as typeof fetch;
    expect(await api.sourceRoots()).toHaveLength(1);
    expect((await api.sourceDirectories('root', 'Books/Classics')).selected_path).toBe(
      '/library/media/Books/Classics',
    );
    expect(urls[1]).toEndWith('/api/source-roots/root/directories?path=Books%2FClassics');
  });

  it('downloads authenticated EPUB bytes with web credentials', async () => {
    let request: RequestInit | undefined;
    globalThis.fetch = (async (_input, init) => {
      request = init;
      return new Response('epub');
    }) as typeof fetch;
    expect(await (await api.mediaBlob('media-1')).text()).toBe('epub');
    expect(request?.credentials).toBe('include');
  });
});
