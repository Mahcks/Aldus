import { File, Paths } from 'expo-file-system';
import { getToken } from './auth-token';
import { getAPIBaseURL } from './api-base';
import { productMediaURL } from './media';
import { activeStorageScope, scopedMediaFileName } from './storage-scope';

const downloads = new Map<string, Promise<string>>();

export async function productEPUBSource(id: string, expectedSize?: number) {
  const origin = getAPIBaseURL();
  const scope = activeStorageScope();
  const destination = new File(Paths.document, scopedMediaFileName(id, 'epub', scope));
  if (destination.exists && (!expectedSize || destination.size === expectedSize))
    return destination.uri;
  const pending = downloads.get(destination.uri);
  if (pending) return pending;
  const download = (async () => {
    const token = await getToken(origin);
    const downloaded = await File.downloadFileAsync(productMediaURL(id, origin), destination, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      idempotent: true,
    });
    if (expectedSize && destination.size !== expectedSize) {
      if (destination.exists) destination.delete();
      throw new Error('The ebook download was incomplete. Retry.');
    }
    return downloaded.uri;
  })();
  downloads.set(destination.uri, download);
  try {
    return await download;
  } finally {
    if (downloads.get(destination.uri) === download) downloads.delete(destination.uri);
  }
}
