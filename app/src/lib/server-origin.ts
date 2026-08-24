const privateIPv4 = /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/;

export function normalizeServerOrigin(input: string) {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Enter your Aldus server address.');
  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error('Enter a valid server address, such as demo.aldus.media.');
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname)
  )
    throw new Error('Use only the server address, without a path, credentials, or query.');
  const hostname = url.hostname.toLowerCase();
  const address = hostname.replace(/^\[|\]$/g, '');
  const local =
    address === 'localhost' ||
    address === '::1' ||
    /^(fc|fd|fe[89ab])/i.test(address) ||
    hostname.endsWith('.local') ||
    privateIPv4.test(address);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new Error('Public Aldus servers must use HTTPS.');
  url.hostname = hostname;
  url.pathname = '';
  return url.origin;
}

export function serverStorageScope(origin: string, userID: string) {
  return `${encodeURIComponent(origin)}:${userID}`;
}
