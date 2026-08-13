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
});
