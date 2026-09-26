/** A unique id for a device or a single request. Not a secret; uniqueness is all that matters. */
export function randomID() {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (webCrypto?.randomUUID) return webCrypto.randomUUID();
  const bytes = Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 0xffffffff).toString(16),
  );
  return `${Date.now().toString(16)}-${bytes.join('')}`;
}
