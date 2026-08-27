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
    const temporary = new File(Paths.document, scopedMediaFileName(id, 'epub.part', scope));
    if (temporary.exists) temporary.delete();
    const token = await getToken(origin);
    try {
      await File.downloadFileAsync(productMediaURL(id, origin), temporary, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        idempotent: false,
      });
      if (expectedSize && temporary.size !== expectedSize) {
        throw new Error('The ebook download was incomplete. Retry.');
      }
      if (destination.exists) destination.delete();
      await temporary.move(destination);
      return destination.uri;
    } finally {
      if (temporary.exists) temporary.delete();
    }
  })();
  downloads.set(destination.uri, download);
  try {
    return await download;
  } finally {
    if (downloads.get(destination.uri) === download) downloads.delete(destination.uri);
  }
}
