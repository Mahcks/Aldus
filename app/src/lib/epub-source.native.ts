import { File, Paths } from 'expo-file-system';
import { getToken } from './auth-token';
import { getAPIBaseURL } from './api-base';
import { productMediaURL } from './media';
import { activeStorageScope, scopedMediaFileName } from './storage-scope';

export async function productEPUBSource(id: string, expectedSize?: number) {
  const origin = getAPIBaseURL();
  const scope = activeStorageScope();
  const destination = new File(Paths.document, scopedMediaFileName(id, 'epub', scope));
  if (destination.exists && (!expectedSize || destination.size === expectedSize))
    return destination.uri;
  const token = await getToken(origin);
  return (
    await File.downloadFileAsync(productMediaURL(id, origin), destination, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      idempotent: true,
    })
  ).uri;
}
