import { describe, expect, it } from 'bun:test';
import { normalizeServerOrigin } from './server-origin';

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
