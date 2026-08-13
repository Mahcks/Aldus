import { afterEach, describe, expect, it, mock } from 'bun:test';

mock.module('react-native', () => ({ Platform: { OS: 'web' } }));
const { api, APIError } = await import('./api');

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('API transport', () => {
  it('uses credentialed requests and generated setup fields', async () => {
    let request: RequestInit | undefined;
    globalThis.fetch = (async (_input, init) => { request = init; return Response.json({ available: true }); }) as typeof fetch;
    expect(await api.setupStatus()).toEqual({ available: true });
    expect(request?.credentials).toBe('include');
  });

  it('does not persist or attach the web login token', async () => {
    const calls: RequestInit[] = [];
    globalThis.fetch = (async (_input, init) => {
      calls.push(init || {});
      return Response.json(calls.length === 1 ? { token: 'secret', expires_at: '', user: { id: 'u' } } : { id: 'u' });
    }) as typeof fetch;
    await api.login({ username: 'reader', password: 'password' });
    await api.me();
    expect(new Headers(calls[1].headers).has('Authorization')).toBe(false);
  });

  it('handles no-content and typed errors', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    await expect(api.updateUser('u', { disabled: true })).resolves.toBeUndefined();
    globalThis.fetch = (async () => new Response('last administrator\n', { status: 409 })) as unknown as typeof fetch;
    await expect(api.updateUser('u', { disabled: true })).rejects.toEqual(new APIError(409, 'last administrator'));
  });

  it('restores Work alignment jobs through the generated contract', async () => {
    let url = '';
    const jobs = [{ id: 'job-1', epub_media_id: 'epub-1', audio_media_id: 'audio-1', state: 'processing', attempts: 1, worker_version: 'whisperx 3.8.6', model: 'base.en', created_at: '2026-01-01T00:00:00Z' }];
    globalThis.fetch = (async (input) => { url = String(input); return Response.json(jobs); }) as typeof fetch;
    expect(await api.alignmentJobs('work-1')).toEqual(jobs);
    expect(url).toEndWith('/api/works/work-1/alignment-jobs');
  });
});
