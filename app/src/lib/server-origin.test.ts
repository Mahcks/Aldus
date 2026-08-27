import { describe, expect, it } from 'bun:test';
import { normalizeServerOrigin, serverStoragePrefixes } from './server-origin';

describe('normalizeServerOrigin', () => {
  it('defaults public hosts to HTTPS', () => {
    expect(normalizeServerOrigin(' demo.aldus.media/ ')).toBe('https://demo.aldus.media');
  });

  it('allows explicit HTTP only for local servers', () => {
    expect(normalizeServerOrigin('http://192.168.1.20:8080')).toBe('http://192.168.1.20:8080');
    expect(normalizeServerOrigin('http://[fd00::20]:8080')).toBe('http://[fd00::20]:8080');
    expect(() => normalizeServerOrigin('http://example.com')).toThrow('must use HTTPS');
  });

  it('rejects non-origin input', () => {
    expect(() => normalizeServerOrigin('https://example.com/api')).toThrow(
      'only the server address',
    );
    expect(() => normalizeServerOrigin('https://user:pass@example.com')).toThrow(
      'only the server address',
    );
  });
});

it('builds prefixes that match every local account for one server', () => {
  expect(serverStoragePrefixes('https://books.example.com')).toEqual({
    storage: 'aldus:https%3A%2F%2Fbooks.example.com:',
    file: 'aldus-https%253A%252F%252Fbooks.example.com%3A',
  });
});
